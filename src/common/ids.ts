import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A uniformly random base62 string (CSPRNG, no modulo bias). */
export const randomBase62 = (length: number): string => {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
};

/**
 * Immutable public identifier for an API resource: `link_…` / `tag_…` with 24
 * base62 chars (~143 bits). Internal bigserial ids never leave the server.
 */
export const newPublicId = (prefix: "link" | "tag"): string => `${prefix}_${randomBase62(24)}`;
