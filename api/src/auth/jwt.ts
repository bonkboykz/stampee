import { SignJWT, jwtVerify } from 'jose';

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error('JWT_SECRET is required');
}
const key = new TextEncoder().encode(secret);

export type TokenClaims = {
  sub: string;
  role: 'owner' | 'staff';
  ownerId: string | null;
};

export async function issueToken(claims: TokenClaims, ttlSeconds = 60 * 60 * 24 * 30): Promise<string> {
  return new SignJWT({ role: claims.role, ownerId: claims.ownerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key);
    if (typeof payload.sub !== 'string') return null;
    const role = payload.role === 'staff' ? 'staff' : 'owner';
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : null;
    return { sub: payload.sub, role, ownerId };
  } catch {
    return null;
  }
}
