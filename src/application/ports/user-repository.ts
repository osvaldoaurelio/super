export type UserCredentials = { id: string; passwordHash: string };

export interface UserRepository {
  findByEmail(email: string): Promise<UserCredentials | null>;
  create(email: string, passwordHash: string): Promise<{ id: string }>;
}
