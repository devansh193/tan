import { z } from "zod";
import { BadRequestError } from "./errors";

/** Keyset position: the last row's sort key plus its public id as tiebreaker. */
export interface Cursor {
  k: string | number;
  id: string;
}

const cursorSchema = z.object({
  k: z.union([z.string().max(64), z.number()]),
  // A prefixed public id (`link_…`); anything else (NUL bytes, free text) would
  // reach Postgres as a bound parameter and fail there with a 500.
  id: z.string().regex(/^[a-z]+_[0-9A-Za-z]{1,32}$/),
});

/** Opaque, URL-safe cursor for `?cursor=`. */
export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c)).toString("base64url");

/** Parses a client-supplied cursor; anything malformed is a 400, never a 500. */
export const decodeCursor = (raw: string): Cursor => {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw new BadRequestError("cursor: invalid");
  }
};
