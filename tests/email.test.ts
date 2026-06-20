import { describe, it, expect, vi, beforeEach } from "vitest";

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("logs instead of sending when NODE_ENV is not production", async () => {
    vi.doMock("../src/config/env", () => ({
      env: { NODE_ENV: "test", RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
    }));

    const info = vi.fn();
    vi.doMock("../src/common/logger", () => ({ logger: { info, error: vi.fn() } }));

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendEmail } = await import("../src/lib/email");

    await sendEmail({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(info).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
