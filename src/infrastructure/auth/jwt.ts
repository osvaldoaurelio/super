import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.ts';

const key = new TextEncoder().encode(env.JWT_SECRET);
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}
export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, key, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: ['HS256'],
  });
  if (!payload.sub) throw new Error('Token sem subject.');
  return { userId: payload.sub };
}
