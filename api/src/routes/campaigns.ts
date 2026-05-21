import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns } from '../db/schema.js';
import { requireAuth, effectiveOwnerId } from '../auth/middleware.js';
import { withUid } from '../db/rpc.js';

const router = new Hono();

const upsertSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  is_enabled: z.boolean().optional(),
  description: z.string().default(''),
  reward_name: z.string().default(''),
  tagline: z.string().nullable().optional(),
  background_image: z.string().nullable().optional(),
  background_opacity: z.number().int().min(0).max(100).optional(),
  logo_image: z.string().nullable().optional(),
  show_logo: z.boolean().optional(),
  title_size: z.string().nullable().optional(),
  icon_key: z.string().default('Coffee'),
  colors: z.record(z.string()),
  total_stamps: z.number().int().min(1),
  social: z.record(z.string()).nullable().optional(),
});

function rowOut(row: typeof campaigns.$inferSelect) {
  return {
    id: row.id,
    owner_id: row.ownerId,
    name: row.name,
    is_enabled: row.isEnabled,
    description: row.description,
    reward_name: row.rewardName,
    tagline: row.tagline,
    background_image: row.backgroundImage,
    background_opacity: row.backgroundOpacity,
    logo_image: row.logoImage,
    show_logo: row.showLogo,
    title_size: row.titleSize,
    icon_key: row.iconKey,
    colors: row.colors,
    total_stamps: row.totalStamps,
    social: row.social,
    created_at: row.createdAt.toISOString(),
  };
}

router.get('/', requireAuth, async (c) => {
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ data: [] });
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.ownerId, ownerId))
    .orderBy(asc(campaigns.createdAt));
  return c.json({ data: rows.map(rowOut) });
});

router.get('/count', requireAuth, async (c) => {
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ count: 0 });
  const [{ count }] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(campaigns)
    .where(eq(campaigns.ownerId, ownerId));
  return c.json({ count });
});

router.post('/', requireAuth, async (c) => {
  const parsed = upsertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid campaign payload.' }, 400);
  const claims = c.get('auth');
  if (claims.role !== 'owner') return c.json({ error: 'Only owners can edit campaigns.' }, 403);

  const t = parsed.data;
  const values = {
    id: t.id,
    ownerId: claims.sub,
    name: t.name,
    isEnabled: t.is_enabled ?? true,
    description: t.description,
    rewardName: t.reward_name,
    tagline: t.tagline ?? null,
    backgroundImage: t.background_image ?? null,
    backgroundOpacity: t.background_opacity ?? 100,
    logoImage: t.logo_image ?? null,
    showLogo: t.show_logo ?? true,
    titleSize: t.title_size ?? null,
    iconKey: t.icon_key,
    colors: t.colors,
    totalStamps: t.total_stamps,
    social: t.social ?? null,
  };
  await db
    .insert(campaigns)
    .values(values)
    .onConflictDoUpdate({
      target: campaigns.id,
      set: {
        name: values.name,
        isEnabled: values.isEnabled,
        description: values.description,
        rewardName: values.rewardName,
        tagline: values.tagline,
        backgroundImage: values.backgroundImage,
        backgroundOpacity: values.backgroundOpacity,
        logoImage: values.logoImage,
        showLogo: values.showLogo,
        titleSize: values.titleSize,
        iconKey: values.iconKey,
        colors: values.colors,
        totalStamps: values.totalStamps,
        social: values.social,
      },
    });
  return c.json({ ok: true });
});

router.patch('/:id/enabled', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  if (claims.role !== 'owner') return c.json({ error: 'Only owners can toggle campaigns.' }, 403);
  const { is_enabled } = (await c.req.json().catch(() => ({}))) as { is_enabled?: boolean };
  if (typeof is_enabled !== 'boolean') return c.json({ error: 'is_enabled required.' }, 400);
  await db
    .update(campaigns)
    .set({ isEnabled: is_enabled })
    .where(and(eq(campaigns.id, id), eq(campaigns.ownerId, claims.sub)));
  return c.json({ ok: true });
});

router.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  if (claims.role !== 'owner') return c.json({ error: 'Only owners can delete campaigns.' }, 403);
  try {
    const result = await withUid(claims.sub, async (sql) => {
      const { rows } = await sql('select public.delete_campaign_preserve_cards($1) as result', [id]);
      return rows[0]?.result;
    });
    return c.json({ data: result });
  } catch (err) {
    console.error('[campaigns/delete] failed', err);
    return c.json({ error: 'Unable to delete this campaign right now. Please try again.' }, 500);
  }
});

export default router;
