import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

// These paths never touch the database (validation / auth guards / routing).
const app = createApp();

describe("app routing & guards", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated request to a protected route", async () => {
    const res = await request(app).get("/api/urls");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects sign-up with an invalid email / short password", async () => {
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "x", email: "not-an-email", password: "short" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("404s an unknown route", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/urls")
      .set("Content-Type", "application/json")
      .send('{"url": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
