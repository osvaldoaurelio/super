import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/infrastructure/auth/password.ts';
import { signAccessToken, verifyAccessToken } from '../../src/infrastructure/auth/jwt.ts';

describe('authentication primitives', () => {
  it('hashes passwords and verifies without storing plaintext', async () => {
    const hash = await hashPassword('a-long-and-secure-password');
    expect(hash).not.toContain('a-long-and-secure-password');
    await expect(verifyPassword('a-long-and-secure-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('another-password-value', hash)).resolves.toBe(false);
  });

  it('rejects weak passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });

  it('signs and verifies short-lived access tokens', async () => {
    const token = await signAccessToken('user-123');
    await expect(verifyAccessToken(token)).resolves.toEqual({ userId: 'user-123' });
    await expect(verifyAccessToken(`${token}invalid`)).rejects.toThrow();
  });
});
