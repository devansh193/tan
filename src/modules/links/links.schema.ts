import { z } from "zod";
import { env } from "../../config/env";
import { CODE_PATTERN } from "./codes";

const ownHost = new URL(env.BASE_URL).host.toLowerCase();

/** A redirect target: http(s), bounded, no credentials, not this shortener. */
export const destinationUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL")
  // "https://bank.com@evil.com" is a classic phishing disguise.
  .refine((u) => {
    const { username, password } = new URL(u);
    return !username && !password;
  }, "must not contain credentials")
  // Pointing at ourselves enables redirect loops and chain obfuscation.
  .refine((u) => new URL(u).host.toLowerCase() !== ownHost, "must not point to this shortener");

export const codeSchema = z.string().regex(CODE_PATTERN, "3-32 chars: letters, digits, - or _");

export const futureDateSchema = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now(), "must be in the future");

/** POST /api/v1/links. Unknown keys are rejected so typos fail loudly. */
export const createLinkSchema = z
  .object({
    url: destinationUrlSchema,
    code: codeSchema.optional(),
    expiresAt: futureDateSchema.optional(),
  })
  .strict();

/** GET /api/v1/links: keyset pagination and sort. */
export const listLinksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  sort: z.enum(["createdAt", "clicks"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateLinkBody = z.infer<typeof createLinkSchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
