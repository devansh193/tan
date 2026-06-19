import Sqids from "sqids";
import { env } from "../../config/env";

/**
 * Shared Sqids instance — the bijective function that maps the URL counter
 * (a bigserial id) to a short code and back.
 *
 *  encode([id]) -> "Ab3xK"   (short code)
 *  decode("Ab3xK") -> [id]   (original counter value)
 */
const sqids = new Sqids({
  minLength: env.SQIDS_MIN_LENGTH,
  ...(env.SQIDS_ALPHABET ? { alphabet: env.SQIDS_ALPHABET } : {}),
});

/** Encodes a counter value into its short code. */
export const encodeId = (id: number): string => sqids.encode([id]);

/**
 * Decodes a short code back to its counter value.
 * Returns null for malformed input. Sqids decoding is not guaranteed to reject
 * every arbitrary string, so we re-encode and compare to enforce a single
 * canonical code per id.
 */
export const decodeId = (code: string): number | null => {
  const numbers = sqids.decode(code);
  if (numbers.length !== 1) return null;

  const id = numbers[0];
  if (encodeId(id) !== code) return null;
  return id;
};
