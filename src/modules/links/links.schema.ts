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

const titleSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(1000);
const redirectTypeSchema = z.union([z.literal(301), z.literal(302)]);
const utmValue = z.string().trim().min(1).max(200).nullable().optional();

/** Campaign params merged into the destination URL; `null` removes one. */
export const utmSchema = z
  .object({
    source: utmValue,
    medium: utmValue,
    campaign: utmValue,
    term: utmValue,
    content: utmValue,
  })
  .strict();

/** POST /api/v1/links. Unknown keys are rejected so typos fail loudly. */
export const createLinkSchema = z
  .object({
    url: destinationUrlSchema,
    code: codeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    expiresAt: futureDateSchema.optional(),
    redirectType: redirectTypeSchema.optional(),
    utm: utmSchema.optional(),
    autoUtm: z.boolean().optional(),
  })
  .strict();

/**
 * PATCH /api/v1/links/:id — JSON merge: omitted = unchanged, null = cleared.
 * `expiresAt` checks null before coercing (z.coerce.date turns null into 1970).
 */
export const updateLinkSchema = z
  .object({
    url: destinationUrlSchema.optional(),
    code: codeSchema.optional(),
    title: titleSchema.nullable().optional(),
    description: descriptionSchema.nullable().optional(),
    expiresAt: z.union([z.null(), futureDateSchema]).optional(),
    redirectType: redirectTypeSchema.optional(),
    utm: utmSchema.optional(),
    autoUtm: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "body: at least one field is required");

/** GET /api/v1/links: keyset pagination, sort, search and creator filter. */
export const listLinksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  sort: z.enum(["createdAt", "clicks"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().min(1).max(100).optional(),
  userId: z.string().min(1).max(64).optional(),
});

export type CreateLinkBody = z.infer<typeof createLinkSchema>;
export type UpdateLinkBody = z.infer<typeof updateLinkSchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
