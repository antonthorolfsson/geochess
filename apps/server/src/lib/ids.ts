import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Lowercase letters and digits without the easily confused l, o, 0 and 1. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomString(length: number, alphabet = ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newId = () => randomString(12);
export const newInviteCode = () => randomString(10);

/** 256-bit secret for session cookies, sign-in links and OAuth state. */
export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Uniform float in [0, 1) from the CSPRNG, for draft order shuffles. */
export const cryptoRandom = () => randomInt(2 ** 47) / 2 ** 47;
