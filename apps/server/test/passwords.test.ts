import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/passwords';

describe('password hashes', () => {
  it('salts every hash and checks passwords against it', async () => {
    const [a, b] = await Promise.all([hashPassword('correct horse'), hashPassword('correct horse')]);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horse', b)).toBe(true);
    expect(await verifyPassword('Correct horse', a)).toBe(false);
    expect(await verifyPassword('correct horse', null)).toBe(false);
  });

  it('takes an accented letter typed either way as the same password', async () => {
    const composed = await hashPassword('café au lait');
    expect(await verifyPassword('café au lait', composed)).toBe(true);
  });

  it('refuses stored hashes it cannot read', async () => {
    await expect(verifyPassword('anything', 'md5$abc')).rejects.toThrow('Unreadable password hash');
    await expect(verifyPassword('anything', 'scrypt$1000$8$1$c2FsdA$a2V5')).rejects.toThrow('Unreadable password hash');
  });
});
