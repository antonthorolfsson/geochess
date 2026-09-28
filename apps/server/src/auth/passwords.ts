import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { KeyedMutex } from '../lib/mutex';

interface Cost {
  N: number;
  r: number;
  p: number;
}

/**
 * scrypt settings for new hashes: 32 MiB and about 40 ms on a laptop core; a Render free instance,
 * with a tenth of a CPU, takes several times that. Each hash records its settings, so they can be
 * raised later without breaking the hashes already stored.
 */
const COST: Cost = { N: 2 ** 15, r: 8, p: 1 };
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** Node's default cap of 32 MiB is just short of what N = 2^15 needs. */
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = randomBytes(SALT_BYTES);

/** One hash at a time, so a burst of sign-ins can't take the memory and threads the games need. */
const queue = new KeyedMutex();

function derive(password: string, salt: Buffer, cost: Cost, bytes: number): Promise<Buffer> {
  return queue.run('scrypt', () => {
    return new Promise<Buffer>((resolve, reject) => {
      // The same password typed on different keyboards can reach us in different Unicode forms.
      scrypt(password.normalize('NFKC'), salt, bytes, { ...cost, maxmem: MAX_MEMORY }, (err, key) =>
        err ? reject(err) : resolve(key),
      );
    });
  });
}

/** A new hash of `password`, stored as `scrypt$N$r$p$salt$key` with the salt and key in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, KEY_BYTES);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Whether `password` matches the `stored` hash. Without a stored hash it still does the work of
 * checking one before saying no, so the time taken doesn't reveal which emails have a password.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    await derive(password, DUMMY_SALT, COST, KEY_BYTES);
    return false;
  }
  const { cost, salt, key } = readHash(stored);
  const candidate = await derive(password, salt, cost, key.length);
  return timingSafeEqual(candidate, key);
}

function readHash(stored: string): { cost: Cost; salt: Buffer; key: Buffer } {
  const [scheme, N, r, p, salt, key] = stored.split('$');
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  const valid =
    scheme === 'scrypt' &&
    cost.N >= 2 &&
    cost.N <= 2 ** 20 &&
    Number.isInteger(Math.log2(cost.N)) &&
    [cost.r, cost.p].every((n) => Number.isInteger(n) && n >= 1 && n <= 16) &&
    salt &&
    key;
  if (!valid) throw new Error('Unreadable password hash');
  return { cost, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}
