import { env } from "../config/env";
import { logger } from "../common/logger";

export type SendEmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** Sends via Resend in production; logs the payload in dev/test. */
export async function sendEmail({ to, subject, text, html }: SendEmailOptions): Promise<void> {
  if (env.NODE_ENV !== "production") {
    logger.info({ to, subject, text }, "Email (dev mock — not sent)");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM!,
      to: [to],
      subject,
      text,
      html: html ?? `<p>${text.replace(/\n/g, "<br>")}</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body, to, subject }, "Failed to send email");
    throw new Error("Failed to send email");
  }
}
