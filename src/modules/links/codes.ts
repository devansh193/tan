import { randomBase62 } from "../../common/ids";

/**
 * 62^7 ≈ 3.5 trillion codes. At 10M links a random guess hits ~1 in 350k, and
 * an insert collides ~1 in 350k (retried by the service).
 */
export const CODE_LENGTH = 7;

/** A uniformly random, unguessable short code. */
export const generateCode = (): string => randomBase62(CODE_LENGTH);

/** Every code (custom or generated) has this shape; anything else can't exist. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Codes that would collide with real routes and are therefore disallowed. */
const RESERVED_CODES = new Set(["api", "health", "ready", "favicon.ico", "robots.txt"]);

export const isReservedCode = (code: string): boolean => RESERVED_CODES.has(code.toLowerCase());

/** True when `code` could name a link: right shape and not a route. */
export const isPossibleCode = (code: string): boolean =>
  CODE_PATTERN.test(code) && !isReservedCode(code);
