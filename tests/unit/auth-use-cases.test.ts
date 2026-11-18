import { describe, expect, it, vi } from 'vitest';
import type { UserRepository } from '../../src/application/ports/user-repository.ts';
import { AuthenticateUser } from '../../src/application/use-cases/authenticate-user.ts';
import { RegisterUser } from '../../src/application/use-cases/register-user.ts';

describe('user authentication use cases', () => {
  it('canonicalizes email, hashes the password, creates the user, and signs a token', async () => {
    const users: UserRepository = {
      findByEmail: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const hashPassword = vi.fn().mockResolvedValue('hash');
    const signAccessToken = vi.fn().mockResolvedValue('token');
    const useCase = new RegisterUser(users, hashPassword, signAccessToken);

    await expect(
      useCase.execute({ email: '  USER@Example.COM ', password: 'long-password' }),
    ).resolves.toEqual({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 900 });

    expect(hashPassword).toHaveBeenCalledWith('long-password');
    expect(users.create).toHaveBeenCalledWith('user@example.com', 'hash');
    expect(signAccessToken).toHaveBeenCalledWith('user-1');
  });

  it('returns the same invalid-credentials error for unknown users and wrong passwords', async () => {
    const users: UserRepository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    };
    const verifyPassword = vi.fn().mockResolvedValue(false);
    const signAccessToken = vi.fn().mockResolvedValue('token');
    const useCase = new AuthenticateUser(users, verifyPassword, signAccessToken);

    await expect(
      useCase.execute({ email: 'MISSING@example.com', password: 'long-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(users.findByEmail).toHaveBeenCalledWith('missing@example.com');
    expect(verifyPassword).not.toHaveBeenCalled();

    users.findByEmail = vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: 'hash' });
    await expect(
      useCase.execute({ email: 'user@example.com', password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(signAccessToken).not.toHaveBeenCalled();
  });
});
