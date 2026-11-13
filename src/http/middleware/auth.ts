import type { MiddlewareHandler } from 'hono';
import { verifyAccessToken } from '../../infrastructure/auth/jwt.ts';
import { logger } from '../../infrastructure/observability/logger.ts';
import type { AppEnv } from '../types.ts';

export const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
  const token = context.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token)
    return context.json(
      { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
      401,
    );
  try {
    const { userId } = await verifyAccessToken(token);
    context.set('userId', userId);
    await next();
  } catch (error) {
    logger.debug({ err: error }, 'jwt_rejected');
    return context.json(
      { error: { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' } },
      401,
    );
  }
};
