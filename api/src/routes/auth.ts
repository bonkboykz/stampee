import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { profiles, staffCredentials, users } from '../db/schema.js';
import { hashSecret, verifySecret } from '../auth/passwords.js';
import { issueToken } from '../auth/jwt.js';
import { requireAuth, requireOwner } from '../auth/middleware.js';
import { withUid } from '../db/rpc.js';
import { isPgUniqueViolation } from '../lib/errors.js';

const router = new Hono();

const signupSchema = z.object({
  businessName: z.string().min(1).max(200),
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
  slug: z.string().min(1).max(80),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const staffLoginSchema = z.object({
  email: z.string().email(),
  pin: z.string().min(4).max(6),
  orgId: z.string().uuid(),
});

const createStaffSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  pin: z.string().regex(/^\d{4,6}$/),
});

const updatePinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });
const updatePasswordSchema = z.object({ password: z.string().min(6).max(200) });

function profileRow(row: typeof profiles.$inferSelect) {
  return {
    id: row.id,
    business_name: row.businessName,
    email: row.email,
    slug: row.slug,
    role: row.role,
    owner_id: row.ownerId,
    status: row.status,
    access: row.access,
    tier: row.tier,
    tier_expires_at: row.tierExpiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

router.post('/signup', async (c) => {
  const parsed = signupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid signup payload.' }, 400);
  }
  const { businessName, email, password, slug } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedSlug = slug.trim().toLowerCase();

  try {
    const result = await db.transaction(async (tx) => {
      const passwordHash = await hashSecret(password);
      const [user] = await tx
        .insert(users)
        .values({ email: normalizedEmail, passwordHash, emailVerified: true })
        .returning();
      const [profile] = await tx
        .insert(profiles)
        .values({
          id: user.id,
          businessName: businessName.trim(),
          email: normalizedEmail,
          slug: normalizedSlug,
          role: 'owner',
          status: 'verified',
          access: 'active',
          tier: 'free',
        })
        .returning();
      return { user, profile };
    });
    const token = await issueToken({
      sub: result.user.id,
      role: 'owner',
      ownerId: null,
    });
    return c.json({ token, profile: profileRow(result.profile) });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      const msg = (err as Error).message.toLowerCase();
      if (msg.includes('email')) {
        return c.json({ error: 'An account with this email already exists. Please log in instead.' }, 409);
      }
      if (msg.includes('slug')) {
        return c.json({ error: 'This URL is already taken. Please choose another.' }, 409);
      }
    }
    console.error('[auth/signup] failed', err);
    return c.json({ error: 'Unable to create your account right now. Please try again.' }, 500);
  }
});

router.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid login payload.' }, 400);
  const email = parsed.data.email.trim().toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return c.json({ error: 'Unable to sign in. Please check your credentials and try again.' }, 401);
  const ok = await verifySecret(parsed.data.password, user.passwordHash);
  if (!ok) return c.json({ error: 'Unable to sign in. Please check your credentials and try again.' }, 401);

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  if (!profile) {
    return c.json({ error: "We couldn't finish setting up your account. Please try again." }, 500);
  }
  if (profile.role === 'staff') {
    // owner password login is for owners only; staff use PIN endpoint.
    return c.json({ error: 'This is a staff account. Use staff login.' }, 401);
  }
  const token = await issueToken({ sub: profile.id, role: 'owner', ownerId: null });
  return c.json({ token, profile: profileRow(profile) });
});

router.post('/staff-login', async (c) => {
  const parsed = staffLoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email or PIN is incorrect.' }, 400);
  const email = parsed.data.email.trim().toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return c.json({ error: 'Email or PIN is incorrect.' }, 401);
  const [cred] = await db
    .select()
    .from(staffCredentials)
    .where(eq(staffCredentials.userId, user.id))
    .limit(1);
  if (!cred) return c.json({ error: 'Email or PIN is incorrect.' }, 401);
  const ok = await verifySecret(parsed.data.pin, cred.pinHash);
  if (!ok) return c.json({ error: 'Email or PIN is incorrect.' }, 401);

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  if (!profile || profile.role !== 'staff') {
    return c.json({ error: 'This is not a staff account.' }, 401);
  }
  if (profile.access === 'disabled') {
    return c.json({ error: 'This account is disabled. Ask the owner to re-enable it.' }, 403);
  }
  if (profile.ownerId !== parsed.data.orgId) {
    return c.json({ error: "Org ID doesn't match this staff account." }, 401);
  }
  const token = await issueToken({ sub: profile.id, role: 'staff', ownerId: profile.ownerId });
  return c.json({ token, profile: profileRow(profile) });
});

router.get('/me', requireAuth, async (c) => {
  const claims = c.get('auth');
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, claims.sub)).limit(1);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ profile: profileRow(profile) });
});

router.post('/logout', requireAuth, async (c) => {
  // Client discards token. We could maintain a Redis blocklist; not needed for MVP.
  return c.json({ ok: true });
});

router.post('/password', requireAuth, async (c) => {
  const parsed = updatePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'New password must be at least 6 characters.' }, 400);
  }
  const claims = c.get('auth');
  const hash = await hashSecret(parsed.data.password);
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, claims.sub));
  return c.json({ ok: true });
});

router.post('/staff', requireAuth, requireOwner, async (c) => {
  const parsed = createStaffSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid staff payload.' }, 400);
  }
  const ownerId = c.get('auth').sub;
  const email = parsed.data.email.trim().toLowerCase();

  try {
    const result = await db.transaction(async (tx) => {
      const placeholderPasswordHash = await hashSecret(crypto.randomUUID());
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash: placeholderPasswordHash, emailVerified: true })
        .returning();
      const pinHash = await hashSecret(parsed.data.pin);
      const [profile] = await tx
        .insert(profiles)
        .values({
          id: user.id,
          businessName: parsed.data.name.trim(),
          email,
          slug: null,
          role: 'staff',
          ownerId,
          status: 'verified',
          access: 'active',
          tier: 'free',
        })
        .returning();
      await tx.insert(staffCredentials).values({ userId: user.id, pinHash, ownerId });
      return { profile };
    });
    return c.json({ profile: profileRow(result.profile) });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return c.json({ error: 'Email already in use.' }, 409);
    }
    console.error('[auth/staff create] failed', err);
    return c.json({ error: 'Unable to complete this staff action right now. Please try again.' }, 500);
  }
});

router.patch('/staff/:id/pin', requireAuth, requireOwner, async (c) => {
  const parsed = updatePinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'PIN should be 4-6 digits.' }, 400);
  const staffId = c.req.param('id');
  const ownerId = c.get('auth').sub;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, staffId), eq(profiles.role, 'staff'), eq(profiles.ownerId, ownerId)))
    .limit(1);
  if (!profile) return c.json({ error: 'Not your staff member.' }, 404);

  const pinHash = await hashSecret(parsed.data.pin);
  await db
    .insert(staffCredentials)
    .values({ userId: staffId, pinHash, ownerId })
    .onConflictDoUpdate({
      target: staffCredentials.userId,
      set: { pinHash, updatedAt: new Date() },
    });
  return c.json({ ok: true });
});

router.delete('/staff/:id', requireAuth, requireOwner, async (c) => {
  const staffId = c.req.param('id');
  const ownerId = c.get('auth').sub;
  const [profile] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, staffId), eq(profiles.role, 'staff'), eq(profiles.ownerId, ownerId)))
    .limit(1);
  if (!profile) return c.json({ error: 'Not your staff member.' }, 404);
  await db.delete(users).where(eq(users.id, staffId));
  return c.json({ ok: true });
});

router.delete('/account', requireAuth, requireOwner, async (c) => {
  const ownerId = c.get('auth').sub;
  await db.transaction(async (tx) => {
    // Cascade from users → profiles → all owned data
    await tx.delete(users).where(eq(users.id, ownerId));
    // Staff users (profiles.owner_id is set with ON DELETE CASCADE on profiles, but users row also needs deleting)
    // Their profiles cascade away when the owner profile is gone (handled by FK).
  });
  return c.json({ ok: true });
});

// Email-dependent flows: explicitly no-op while email is disabled.
router.post('/resend-verification', requireAuth, async (c) => {
  return c.json({
    ok: true,
    message: 'Email verification is currently disabled. Your account is already active.',
  });
});

router.post('/reset-password', async (c) => {
  return c.json({
    ok: false,
    error: 'Password reset by email is currently disabled. Contact support.',
  }, 501);
});

export default router;
