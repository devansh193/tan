import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * 62^7 ≈ 3.5 trillion codes. At 10M links a random guess hits ~1 in 350k, and
 * an insert collides ~1 in 350k (retried by the service).
 */
export const CODE_LENGTH = 7;

/** A uniformly random, unguessable short code (CSPRNG, no modulo bias). */
export const generateCode = (): string => {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
};
