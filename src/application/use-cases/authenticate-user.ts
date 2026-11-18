import { DomainError } from '../../domain/errors.ts';
import type { UserRepository } from '../ports/user-repository.ts';

type AuthToken = { accessToken: string; tokenType: 'Bearer'; expiresIn: number };

export class AuthenticateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly verify: (password: string, hash: string) => Promise<boolean>,
    private readonly sign: (userId: string) => Promise<string>,
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthToken> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user || !(await this.verify(input.password, user.passwordHash))) {
      throw new DomainError('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
    }
    return { accessToken: await this.sign(user.id), tokenType: 'Bearer', expiresIn: 900 };
  }
}
