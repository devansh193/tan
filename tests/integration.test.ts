import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db/client";
import { clickRecorder } from "../src/modules/url/url.service";

// Full stack against a migrated Postgres: RUN_DB_TESTS=1 DATABASE_URL=... bun run test
describe.skipIf(!process.env.RUN_DB_TESTS)("integration (Postgres)", () => {
  const app = createApp();
  let token = "";
  const auth = () => ({ Authorization: `Bearer ${token}` });

  afterAll(async () => {
    await clickRecorder.stop();
    await pool.end();
  });

  it("signs up and gets a bearer token", async () => {
    const creds = { email: `t${Date.now()}@example.com`, password: "password123" };
    const signUp = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "T", ...creds });
    expect(signUp.status).toBe(200);
    // Sign in again: the sign-up session predates the personal org.
    const res = await request(app).post("/api/auth/sign-in/email").send(creds);
    token = res.headers["set-auth-token"] ?? res.body.token;
    expect(token).toBeTruthy();
  });

  it("creates a random-code link, redirects, and counts clicks", async () => {
    const created = await request(app)
      .post("/api/urls")
      .set(auth())
      .send({ url: "https://example.com/landing" });
    expect(created.status).toBe(201);
    const { code } = created.body as { code: string };
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);

    const hit = await request(app).get(`/${code}`).set("User-Agent", "Mozilla/5.0");
    expect(hit.status).toBe(302);
    expect(hit.headers.location).toBe("https://example.com/landing");

    await clickRecorder.stop(); // drain buffered clicks
    const stats = await request(app).get(`/api/urls/${code}/stats`).set(auth());
    expect(stats.body.clickCount).toBe(1);
    expect(stats.body.recentClicks).toHaveLength(1);
  });

  it("attributes one link's clicks per platform and ignores preview bots", async () => {
    const created = await request(app).post("/api/urls").set(auth()).send({ url: "https://c.com" });
    const { code, shareUrls } = created.body as { code: string; shareUrls: Record<string, string> };
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
      expect(res.headers.location).toBe("https://c.com");
    }

    await clickRecorder.stop();
    const stats = await request(app).get(`/api/urls/${code}/stats`).set(auth());
    expect(stats.body.clickCount).toBe(4);
    expect(stats.body.sources).toEqual([
      { source: "instagram", method: "channel", clicks: 2 },
      { source: "instagram", method: "ua", clicks: 1 },
      { source: "linkedin", method: "channel", clicks: 1 },
    ]);
  });

  it("refuses an alias equal to an existing link's code (no hijack)", async () => {
    const victim = await request(app).post("/api/urls").set(auth()).send({ url: "https://a.com" });
    const squat = await request(app)
      .post("/api/urls")
      .set(auth())
      .send({ url: "https://evil.com", customAlias: victim.body.code });
    expect(squat.status).toBe(409);

    const hit = await request(app).get(`/${victim.body.code}`);
    expect(hit.headers.location).toBe("https://a.com");
  });

  it("stops redirecting after delete", async () => {
    const created = await request(app)
      .post("/api/urls")
      .set(auth())
      .send({ url: "https://b.com", customAlias: `gone-${Date.now()}` });
    const code = created.body.code as string;
    expect((await request(app).get(`/${code}`)).status).toBe(302);
    expect((await request(app).delete(`/api/urls/${code}`).set(auth())).status).toBe(204);
    expect((await request(app).get(`/${code}`)).status).toBe(404);
  });
});
