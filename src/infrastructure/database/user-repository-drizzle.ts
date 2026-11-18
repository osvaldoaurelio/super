import { eq } from 'drizzle-orm';
import { DomainError } from '../../domain/errors.ts';
import type { UserRepository } from '../../application/ports/user-repository.ts';
import { db } from './client.ts';
import { users } from './schema.ts';

export class DrizzleUserRepository implements UserRepository {
  async findByEmail(email: string) {
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user ?? null;
  }

  async create(email: string, passwordHash: string): Promise<{ id: string }> {
    try {
      const [user] = await db
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id });
      if (!user) throw new Error('Falha ao criar a conta.');
      return user;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new DomainError('E-mail já cadastrado.', 'EMAIL_EXISTS');
      }
      throw error;
    }
  }
}
