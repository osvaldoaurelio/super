import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../types.ts';
import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/database/client.ts';
import { users } from '../../infrastructure/database/schema.ts';
import { hashPassword, verifyPassword } from '../../infrastructure/auth/password.ts';
import { signAccessToken } from '../../infrastructure/auth/jwt.ts';

const Credentials = z
  .object({ email: z.string().email().max(320), password: z.string().min(12).max(128) })
  .openapi('Credentials');
const AuthResponse = z
  .object({ accessToken: z.string(), tokenType: z.literal('Bearer'), expiresIn: z.number() })
  .openapi('AuthResponse');
const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Auth'],
  request: { body: { content: { 'application/json': { schema: Credentials } } } },
  responses: {
    201: {
      description: 'Conta criada.',
      content: { 'application/json': { schema: AuthResponse } },
    },
    409: {
      description: 'E-mail já cadastrado.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Limite de requisições excedido.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  request: { body: { content: { 'application/json': { schema: Credentials } } } },
  responses: {
    200: { description: 'Autenticado.', content: { 'application/json': { schema: AuthResponse } } },
    401: {
      description: 'Credenciais inválidas.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Limite de requisições excedido.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export const authRoutes = new OpenAPIHono<AppEnv>();
authRoutes.openapi(registerRoute, async (context) => {
  const input = context.req.valid('json');
  const email = input.email.trim().toLowerCase();
  try {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(input.password) })
      .returning({ id: users.id });
    if (!user) throw new Error('Falha ao criar a conta.');
    return context.json(
      { accessToken: await signAccessToken(user.id), tokenType: 'Bearer' as const, expiresIn: 900 },
      201,
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      return context.json(
        { error: { code: 'EMAIL_EXISTS', message: 'E-mail já cadastrado.' } },
        409,
      );
    throw error;
  }
});
authRoutes.openapi(loginRoute, async (context) => {
  const input = context.req.valid('json');
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!user || !(await verifyPassword(input.password, user.passwordHash)))
    return context.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' } },
      401,
    );
  return context.json(
    { accessToken: await signAccessToken(user.id), tokenType: 'Bearer' as const, expiresIn: 900 },
    200,
  );
});
