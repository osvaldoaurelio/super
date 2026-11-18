import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { UserRepository } from '../../application/ports/user-repository.ts';
import { AuthenticateUser } from '../../application/use-cases/authenticate-user.ts';
import { RegisterUser } from '../../application/use-cases/register-user.ts';
import { DomainError } from '../../domain/errors.ts';
import type { AppEnv } from '../types.ts';

const Credentials = z
  .object({ email: z.email().max(320), password: z.string().min(12).max(128) })
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

export function createAuthRoutes(dependencies: {
  users: UserRepository;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  signAccessToken: (userId: string) => Promise<string>;
}) {
  const register = new RegisterUser(
    dependencies.users,
    dependencies.hashPassword,
    dependencies.signAccessToken,
  );
  const authenticate = new AuthenticateUser(
    dependencies.users,
    dependencies.verifyPassword,
    dependencies.signAccessToken,
  );
  const routes = new OpenAPIHono<AppEnv>();

  routes.openapi(registerRoute, async (context) => {
    const input = context.req.valid('json');
    try {
      return context.json(await register.execute(input), 201);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'EMAIL_EXISTS') {
        return context.json({ error: { code: error.code, message: error.message } }, 409);
      }
      throw error;
    }
  });
  routes.openapi(loginRoute, async (context) => {
    try {
      return context.json(await authenticate.execute(context.req.valid('json')), 200);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_CREDENTIALS') {
        return context.json({ error: { code: error.code, message: error.message } }, 401);
      }
      throw error;
    }
  });

  return routes;
}
