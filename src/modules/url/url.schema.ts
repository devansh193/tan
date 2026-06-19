import { z } from "zod";

/** Allowed characters and length for a user-chosen alias. */
const aliasPattern = /^[A-Za-z0-9_-]{3,32}$/;

export const createUrlSchema = z.object({
  // Only http/https URLs are accepted as redirect targets; capped in length.
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL"),
  // Optional user-chosen short code.
  customAlias: z.string().regex(aliasPattern, "3-32 chars: letters, digits, - or _").optional(),
  // Optional expiry; must be in the future if provided.
  expiresAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), "must be in the future")
    .optional(),
});

/** Pagination for listing a user's URLs. */
export const listUrlsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateUrlInput = z.infer<typeof createUrlSchema>;
export type ListUrlsQuery = z.infer<typeof listUrlsQuerySchema>;
