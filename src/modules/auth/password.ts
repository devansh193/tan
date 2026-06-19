import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Hashes a plaintext password for storage. */
export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, SALT_ROUNDS);

/** Verifies a plaintext password against a stored hash. */
export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
