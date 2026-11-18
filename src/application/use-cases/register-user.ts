import type { UserRepository } from '../ports/user-repository.ts';

type AuthToken = { accessToken: string; tokenType: 'Bearer'; expiresIn: number };

export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hash: (password: string) => Promise<string>,
    private readonly sign: (userId: string) => Promise<string>,
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthToken> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.hash(input.password);
    const user = await this.users.create(email, passwordHash);
    return { accessToken: await this.sign(user.id), tokenType: 'Bearer', expiresIn: 900 };
  }
}
