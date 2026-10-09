import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { member, urls } from "../src/db/schema";
import { clickRecorder } from "../src/modules/analytics/click-recorder";
import { analyticsRepository } from "../src/modules/analytics/analytics.repository";

/** Signs up + signs in a fresh user; returns its bearer header and user id. */
async function newUser(app: ReturnType<typeof createApp>, prefix: string) {
  const creds = {
    email: `${prefix}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "password123",
  };
  const signUp = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ name: prefix, ...creds });
  expect(signUp.status).toBe(200);
  // Sign in again: the sign-up session predates the personal org.
  const signIn = await request(app).post("/api/auth/sign-in/email").send(creds);
  const token = signIn.headers["set-auth-token"] ?? signIn.body.token;
  expect(token).toBeTruthy();
  return {
    auth: { Authorization: `Bearer ${token}` },
    userId: signUp.body.user.id as string,
    creds,
  };
}

// Full stack against a migrated Postgres: RUN_DB_TESTS=1 DATABASE_URL=... bun run test
describe.skipIf(!process.env.RUN_DB_TESTS)("integration (Postgres)", () => {
  const app = createApp();
  let auth: { Authorization: string };

  afterAll(async () => {
    await clickRecorder.stop();
    await pool.end();
  });

  it("signs up and gets a bearer token", async () => {
    ({ auth } = await newUser(app, "owner"));
  });

  it("creates a link, reads it by id, redirects, and counts clicks", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://example.com/landing" });
    expect(created.status).toBe(201);
    const { id, code } = created.body as { id: string; code: string };
    expect(id).toMatch(/^link_[0-9A-Za-z]{24}$/);
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(created.headers.location).toBe(`/api/v1/links/${id}`);

    const hit = await request(app).get(`/${code}`).set("User-Agent", "Mozilla/5.0");
    expect(hit.status).toBe(302);
    expect(hit.headers.location).toBe("https://example.com/landing");

    await clickRecorder.stop(); // drain buffered clicks
    const read = await request(app).get(`/api/v1/links/${id}`).set(auth);
    expect(read.status).toBe(200);
    expect(read.body.clicks).toBe(1);
  });

  it("attributes one link's clicks per platform and ignores preview bots", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://c.com" });
    const { id, code, shareUrls } = created.body as {
      id: string;
      code: string;
      shareUrls: Record<string, string>;
    };
    const path = (u: string) => new URL(u).pathname;
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";
    const hits = [
      [path(shareUrls.instagram), iphone],
      [path(shareUrls.instagram), iphone],
      [path(shareUrls.linkedin), iphone],
      [`/${code}`, "Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 312.0.0.32.112"],
      [`/${code}`, "Twitterbot/1.0"],
      [path(shareUrls.x), "facebookexternalhit/1.1"],
    ];
    for (const [p, ua] of hits) {
      const res = await request(app).get(p).set("User-Agent", ua);
      expect(res.status).toBe(302);
    }

    await clickRecorder.stop();
    expect((await request(app).get(`/api/v1/links/${id}`).set(auth)).body.clicks).toBe(4);
    const [row] = await db.select({ id: urls.id }).from(urls).where(eq(urls.publicId, id));
    expect(await analyticsRepository.sourceBreakdown(row.id)).toEqual([
      { source: "instagram", method: "channel", clicks: 2 },
      { source: "instagram", method: "ua", clicks: 1 },
      { source: "linkedin", method: "channel", clicks: 1 },
    ]);
  });

  it("serves org-scoped analytics: time series and per-source breakdown", async () => {
    const { auth: other } = await newUser(app, "analytics");
    const created = await request(app)
      .post("/api/v1/links")
      .set(other)
      .send({ url: "https://example.com/analytics" });
    const { id, shareUrls } = created.body as { id: string; shareUrls: Record<string, string> };
    for (const u of [shareUrls.instagram, shareUrls.instagram, shareUrls.linkedin])
      await request(app).get(new URL(u).pathname).set("User-Agent", "Mozilla/5.0");
    await clickRecorder.stop();

    const sources = await request(app).get("/api/v1/analytics?groupBy=sources").set(other);
    expect(sources.status).toBe(200);
    expect(sources.body.data).toEqual([
      { value: "instagram", method: "channel", clicks: 2, uniques: 1 },
      { value: "linkedin", method: "channel", clicks: 1, uniques: 1 },
    ]);

    const series = await request(app).get(`/api/v1/analytics?linkId=${id}`).set(other);
    const buckets = series.body.data as { clicks: number }[];
    expect(buckets).toHaveLength(31); // 30 days, both ends' buckets
    expect(buckets.reduce((n, r) => n + r.clicks, 0)).toBe(3);

    // Another org's analytics never include these clicks.
    const theirs = await request(app)
      .get(`/api/v1/analytics?groupBy=sources&linkId=${id}`)
      .set(auth);
    expect(theirs.body.data).toEqual([]);
  });

  it("refuses a code equal to an existing link's code (no hijack)", async () => {
    const victim = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://a.com" });
    const squat = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://evil.com", code: victim.body.code });
    expect(squat.status).toBe(409);
    expect((await request(app).get(`/${victim.body.code}`)).headers.location).toBe("https://a.com");
  });

  it("rejects the legacy customAlias field", async () => {
    const res = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://a.com", customAlias: "legacy" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("customAlias");
  });

  it("pages through every link exactly once, even with identical created_at", async () => {
    const { auth: solo } = await newUser(app, "pager");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/links")
        .set(solo)
        .send({ url: `https://p${i}.com` });
      ids.push(res.body.id as string);
    }
    // Force a tie on the sort key: the tiebreaker must still order and page them.
    const tie = new Date("2026-01-01T00:00:00.000Z");
    for (const id of ids.slice(1, 4)) {
      await db.update(urls).set({ createdAt: tie }).where(eq(urls.publicId, id));
    }

    for (const order of ["desc", "asc"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await request(app)
          .get("/api/v1/links")
          .query({ limit: 1, order, ...(cursor ? { cursor } : {}) })
          .set(solo);
        expect(res.status).toBe(200);
        seen.push(...(res.body.data as { id: string }[]).map((l) => l.id));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    }
  });

  it("400s a garbage cursor instead of erroring in Postgres", async () => {
    const res = await request(app).get("/api/v1/links").query({ cursor: "garbage" }).set(auth);
    expect(res.status).toBe(400);
  });

  it("404s another organization's link and malformed ids", async () => {
    const { auth: other } = await newUser(app, "other");
    const mine = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://mine.com" });
    expect((await request(app).get(`/api/v1/links/${mine.body.id}`).set(other)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/links/${mine.body.id}`).set(other)).status).toBe(
      404,
    );
    expect((await request(app).get("/api/v1/links/abc").set(auth)).status).toBe(404);
  });

  it("enforces membership on every request and member/admin delete rights", async () => {
    const session = await request(app).get("/api/auth/get-session").set(auth);
    const orgId = session.body.session.activeOrganizationId as string;
    const ownerLink = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://o.com" });

    // Second user joins the owner's org as a plain member and switches to it.
    const m = await newUser(app, "member");
    await db.insert(member).values({
      id: `mem-${Date.now()}`,
      organizationId: orgId,
      userId: m.userId,
      role: "member",
      createdAt: new Date(),
    });
    await request(app)
      .post("/api/auth/organization/set-active")
      .set(m.auth)
      .send({ organizationId: orgId })
      .expect(200);

    expect((await request(app).get("/api/v1/links").set(m.auth)).status).toBe(200);
    const denied = await request(app).delete(`/api/v1/links/${ownerLink.body.id}`).set(m.auth);
    expect(denied.status).toBe(403);
    const editDenied = await request(app)
      .patch(`/api/v1/links/${ownerLink.body.id}`)
      .set(m.auth)
      .send({ title: "hijack" });
    expect(editDenied.status).toBe(403);
    const own = await request(app).post("/api/v1/links").set(m.auth).send({ url: "https://m.com" });
    expect((await request(app).delete(`/api/v1/links/${own.body.id}`).set(m.auth)).status).toBe(
      204,
    );

    // Admin removes the member: their still-valid session loses access at once.
    await request(app)
      .post("/api/auth/organization/remove-member")
      .set(auth)
      .send({ memberIdOrEmail: m.creds.email, organizationId: orgId })
      .expect(200);
    expect((await request(app).get("/api/v1/links").set(m.auth)).status).toBe(403);
    const write = await request(app)
      .post("/api/v1/links")
      .set(m.auth)
      .send({ url: "https://z.com" });
    expect(write.status).toBe(403);
  });

  it("stops redirecting after delete", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://b.com", code: `gone-${Date.now()}` });
    const { id, code } = created.body as { id: string; code: string };
    expect((await request(app).get(`/${code}`)).status).toBe(302);
    expect((await request(app).delete(`/api/v1/links/${id}`).set(auth)).status).toBe(204);
    expect((await request(app).get(`/${code}`)).status).toBe(404);
  });
  it("creates with extras and redirects with the link's status and headers", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({
        url: "https://dest.com/p?a=b%20c",
        title: "Launch",
        redirectType: 301,
        utm: { source: "news", campaign: "launch day" },
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: "Launch",
      description: null,
      redirectType: 301,
      url: "https://dest.com/p?a=b%20c&utm_source=news&utm_campaign=launch%20day",
      utm: { source: "news", medium: null, campaign: "launch day", term: null, content: null },
    });

    const hit = await request(app).get(`/${created.body.code}`).set("User-Agent", "Mozilla/5.0");
    expect(hit.status).toBe(301);
    expect(hit.headers.location).toBe(created.body.url);
    expect(hit.headers["cache-control"]).toBe("private, max-age=3600");
    expect(hit.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("applies edits to redirects immediately, frees old codes, and clears with null", async () => {
    const code = `edit-${Date.now()}`;
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://first.com", code, expiresAt: "2099-01-01T00:00:00Z", title: "T" });
    const id = created.body.id as string;
    expect((await request(app).get(`/${code}`)).headers.location).toBe("https://first.com"); // warm caches

    const moved = await request(app)
      .patch(`/api/v1/links/${id}`)
      .set(auth)
      .send({ url: "https://second.com" });
    expect(moved.status).toBe(200);
    expect(moved.body.updatedAt).not.toBe(created.body.updatedAt);
    const after = await request(app).get(`/${code}`);
    expect(after.headers.location).toBe("https://second.com");
    expect(after.headers["cache-control"]).toBe("private, max-age=0");

    const renamed = await request(app)
      .patch(`/api/v1/links/${id}`)
      .set(auth)
      .send({ code: `${code}-b` });
    expect(renamed.body.code).toBe(`${code}-b`);
    expect((await request(app).get(`/${code}`)).status).toBe(404);
    expect((await request(app).get(`/${code}-b`)).status).toBe(302);

    const cleared = await request(app)
      .patch(`/api/v1/links/${id}`)
      .set(auth)
      .send({ expiresAt: null, title: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ expiresAt: null, title: null });

    expect((await request(app).patch(`/api/v1/links/${id}`).set(auth).send({})).status).toBe(400);
  });

  it("resolves a code at once even if it was requested before it existed", async () => {
    const code = `soon-${Date.now()}`;
    expect((await request(app).get(`/${code}`)).status).toBe(404); // cached as a miss
    await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://now.com", code })
      .expect(201);
    expect((await request(app).get(`/${code}`)).headers.location).toBe("https://now.com");
  });

  it("searches code, title and URL literally, and filters by creator", async () => {
    const { auth: solo, userId } = await newUser(app, "search");
    const mk = (body: object) =>
      request(app).post("/api/v1/links").set(solo).send(body).expect(201);
    const a = await mk({ url: "https://alpha.example/x", title: "Summer sale" });
    const b = await mk({ url: "https://beta.example/100%25-off" });
    const c = await mk({ url: "https://gamma.example", code: `zeta_${Date.now()}` });
    const ids = (res: request.Response) =>
      (res.body.data as { id: string }[]).map((l) => l.id).sort();
    const search = (q: string) => request(app).get("/api/v1/links").query({ q }).set(solo);

    expect(ids(await search("SUMMER"))).toEqual([a.body.id]);
    expect(ids(await search("beta.example"))).toEqual([b.body.id]);
    expect(ids(await search("zeta_"))).toEqual([c.body.id]);
    expect(ids(await search("%"))).toEqual([b.body.id]); // only the URL with a literal %
    expect(ids(await search("nomatch"))).toEqual([]);

    const mine = await request(app).get("/api/v1/links").query({ userId }).set(solo);
    expect(ids(mine)).toEqual([a.body.id, b.body.id, c.body.id].sort());
    const nobody = await request(app)
      .get("/api/v1/links")
      .query({ userId: "someone-else" })
      .set(solo);
    expect(nobody.body.data).toEqual([]);
  });

  it("autoUtm: share tags tell the destination which platform sent the visitor", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({
        url: "https://brewly.example/cold-brew?ref=launch",
        utm: { campaign: "coldbrew_launch" },
        autoUtm: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.autoUtm).toBe(true);
    const { id, code } = created.body as { id: string; code: string };
    const dest = (path: string) =>
      request(app)
        .get(path)
        .set("User-Agent", "Mozilla/5.0")
        .then((r) => r.headers.location);

    expect(await dest(`/${code}/ig`)).toBe(
      "https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch&utm_source=instagram&utm_medium=social",
    );
    expect(await dest(`/${code}/em`)).toBe(
      "https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch&utm_source=email&utm_medium=email",
    );
    // Plain short URL: the stored destination, untouched.
    expect(await dest(`/${code}`)).toBe(
      "https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch",
    );

    // Turning it off applies to redirects immediately.
    const off = await request(app).patch(`/api/v1/links/${id}`).set(auth).send({ autoUtm: false });
    expect(off.body.autoUtm).toBe(false);
    expect(await dest(`/${code}/ig`)).toBe(
      "https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch",
    );

    // tan's own attribution still uses the tag.
    await clickRecorder.stop();
    const [row] = await db.select({ id: urls.id }).from(urls).where(eq(urls.publicId, id));
    const sources = await analyticsRepository.sourceBreakdown(row.id);
    expect(sources).toEqual(
      expect.arrayContaining([
        { source: "instagram", method: "channel", clicks: 2 },
        { source: "email", method: "channel", clicks: 1 },
      ]),
    );
  });
});
