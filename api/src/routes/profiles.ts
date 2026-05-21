import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireAuth } from '../auth/middleware.js';
import { withUid } from '../db/rpc.js';

const router = new Hono();

const updateSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  slug: z.string().min(1).max(80).optional().nullable(),
  status: z.enum(['unverified', 'verified']).optional(),
  access: z.enum(['active', 'disabled']).optional(),
  tier: z.enum(['free', 'pro']).optional(),
  tier_expires_at: z.string().nullable().optional(),
});

function rowOut(row: typeof profiles.$inferSelect) {
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

router.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const [row] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  if (!row) return c.json({ data: null });
  return c.json({ data: rowOut(row) });
});

router.get('/by-slug/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.slug, slug), eq(profiles.role, 'owner')))
    .limit(1);
  if (!row) return c.json({ data: null });
  return c.json({ data: rowOut(row) });
});

router.get('/staff/of/:ownerId', requireAuth, async (c) => {
  const ownerId = c.req.param('ownerId');
  const claims = c.get('auth');
  // staff can only request their own owner's staff list
  if (claims.role === 'staff' && claims.ownerId !== ownerId) {
    return c.json({ data: [] });
  }
  if (claims.role === 'owner' && claims.sub !== ownerId) {
    return c.json({ data: [] });
  }
  const rows = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.ownerId, ownerId), eq(profiles.role, 'staff')));
  return c.json({ data: rows.map(rowOut) });
});

router.patch('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  // Owner can update self + own staff. Staff can update self only.
  if (claims.role === 'owner') {
    if (id !== claims.sub) {
      // check the target is staff under this owner
      const [target] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
      if (!target || target.ownerId !== claims.sub) {
        return c.json({ error: 'Not authorized to update this profile.' }, 403);
      }
    }
  } else {
    if (id !== claims.sub) {
      return c.json({ error: 'Not authorized to update this profile.' }, 403);
    }
  }

  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid profile update.' }, 400);

  const updates: Partial<typeof profiles.$inferInsert> = {};
  if (parsed.data.business_name) updates.businessName = parsed.data.business_name;
  if (parsed.data.email) updates.email = parsed.data.email.trim().toLowerCase();
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug?.toLowerCase() ?? null;
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.access) updates.access = parsed.data.access;
  if (parsed.data.tier) updates.tier = parsed.data.tier;
  if (parsed.data.tier_expires_at !== undefined) {
    updates.tierExpiresAt = parsed.data.tier_expires_at ? new Date(parsed.data.tier_expires_at) : null;
  }

  try {
    await db.update(profiles).set(updates).where(eq(profiles.id, id));
  } catch (err) {
    console.error('[profiles/update] failed', err);
    return c.json({ error: 'Unable to update this profile right now. Please try again.' }, 500);
  }
  const [updated] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  return c.json({ data: updated ? rowOut(updated) : null });
});

router.post('/rpc/is_slug_available', async (c) => {
  const { slug } = (await c.req.json().catch(() => ({}))) as { slug?: string };
  if (!slug) return c.json({ data: false });
  const result = await withUid(null, async (sql) => {
    const { rows } = await sql('select public.is_slug_available($1) as available', [slug]);
    return rows[0]?.available ?? false;
  });
  return c.json({ data: result });
});

export default router;
