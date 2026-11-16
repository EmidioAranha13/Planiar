import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to Argon2id when algorithm is omitted.
function options() {
  if (process.env.VITEST) {
    return { memoryCost: 8192, timeCost: 1, parallelism: 1 };
  }
  return { memoryCost: 19456, timeCost: 2, parallelism: 1 };
}

let dummyHash: Promise<string> | null = null;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, options());
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password, options());
}

export async function verifyPasswordOrDummy(password: string, passwordHash: string | null): Promise<boolean> {
  if (!dummyHash) dummyHash = hash('planiar-timing-pad', options());
  const hashToCheck = passwordHash ?? (await dummyHash);
  const valid = await verify(hashToCheck, password, options());
  return passwordHash != null && valid;
}
