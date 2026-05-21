import type { Context, MiddlewareHandler } from 'hono';
import { verifyToken, type TokenClaims } from './jwt.js';

declare module 'hono' {
  interface ContextVariableMap {
    auth: TokenClaims;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = header.slice(7).trim();
  const claims = await verifyToken(token);
  if (!claims) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('auth', claims);
  await next();
};

export const requireOwner: MiddlewareHandler = async (c, next) => {
  const auth = c.get('auth');
  if (!auth || auth.role !== 'owner') {
    return c.json({ error: 'Owner role required' }, 403);
  }
  await next();
};

export function effectiveOwnerId(claims: TokenClaims): string | null {
  return claims.role === 'owner' ? claims.sub : claims.ownerId;
}

export function ensureOwnerScope(c: Context, ownerIdFromBody: string | undefined): string | null {
  const claims = c.get('auth');
  if (!claims) return null;
  const effective = effectiveOwnerId(claims);
  if (!effective) return null;
  if (ownerIdFromBody && ownerIdFromBody !== effective) return null;
  return effective;
}
