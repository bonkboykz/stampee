import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { issuedCards, transactions } from '../db/schema.js';
import { requireAuth, effectiveOwnerId } from '../auth/middleware.js';
import { withUid } from '../db/rpc.js';

const router = new Hono();

const insertCardSchema = z.object({
  id: z.string(),
  unique_id: z.string().uuid(),
  customer_id: z.string(),
  campaign_id: z.string(),
  campaign_name: z.string(),
  template_snapshot: z.any().optional().nullable(),
});

const updateCardSchema = z.object({
  stamps: z.number().int().optional(),
  status: z.enum(['Active', 'Redeemed']).optional(),
  completed_date: z.string().nullable().optional(),
  last_visit: z.string().optional(),
});

const insertTxSchema = z.object({
  id: z.string(),
  type: z.enum(['stamp_add', 'stamp_remove', 'redeem', 'issued']),
  amount: z.number().int(),
  date: z.string(),
  timestamp: z.number(),
  title: z.string(),
  remarks: z.string().optional().nullable(),
  actor_id: z.string().optional().nullable(),
  actor_name: z.string().optional().nullable(),
  actor_role: z.string().optional().nullable(),
});

router.post('/', requireAuth, async (c) => {
  const parsed = insertCardSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid card payload.' }, 400);
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ ok: false, error: 'No owner scope.' }, 403);

  try {
    await db.insert(issuedCards).values({
      id: parsed.data.id,
      uniqueId: parsed.data.unique_id,
      customerId: parsed.data.customer_id,
      campaignId: parsed.data.campaign_id,
      ownerId,
      campaignName: parsed.data.campaign_name,
      stamps: 0,
      lastVisit: new Date().toISOString().split('T')[0],
      status: 'Active',
      templateSnapshot: parsed.data.template_snapshot ?? null,
    });
    return c.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('CAMPAIGN_DISABLED')) {
      return c.json({ ok: false, error: 'This campaign is disabled and cannot issue new cards.' }, 400);
    }
    console.error('[issued-cards/insert] failed', err);
    return c.json({ ok: false, error: 'Unable to issue this card right now. Please try again.' }, 500);
  }
});

router.patch('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ ok: false, error: 'No owner scope.' }, 403);

  const parsed = updateCardSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid update.' }, 400);

  const updates: Partial<typeof issuedCards.$inferInsert> = {};
  if (parsed.data.stamps !== undefined) updates.stamps = parsed.data.stamps;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.completed_date !== undefined) updates.completedDate = parsed.data.completed_date;
  if (parsed.data.last_visit !== undefined) updates.lastVisit = parsed.data.last_visit;

  await db
    .update(issuedCards)
    .set(updates)
    .where(and(eq(issuedCards.id, id), eq(issuedCards.ownerId, ownerId)));
  return c.json({ ok: true });
});

router.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId || claims.role !== 'owner') {
    return c.json({ ok: false, error: 'Only owners can revoke cards.' }, 403);
  }
  await db
    .delete(issuedCards)
    .where(and(eq(issuedCards.id, id), eq(issuedCards.ownerId, ownerId)));
  return c.json({ ok: true });
});

router.get('/count', requireAuth, async (c) => {
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ count: 0 });
  const [{ count }] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(issuedCards)
    .where(eq(issuedCards.ownerId, ownerId));
  return c.json({ count });
});

router.post('/:id/transactions', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ ok: false, error: 'No owner scope.' }, 403);

  // verify card belongs to caller's owner
  const [card] = await db
    .select({ id: issuedCards.id, ownerId: issuedCards.ownerId })
    .from(issuedCards)
    .where(eq(issuedCards.id, id))
    .limit(1);
  if (!card || card.ownerId !== ownerId) {
    return c.json({ ok: false, error: 'Card not found.' }, 404);
  }

  const parsed = insertTxSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid transaction.' }, 400);

  const t = parsed.data;
  await db.insert(transactions).values({
    id: t.id,
    cardId: id,
    type: t.type,
    amount: t.amount,
    date: t.date,
    timestamp: t.timestamp,
    title: t.title,
    remarks: t.remarks ?? null,
    actorId: t.actor_id ?? null,
    actorName: t.actor_name ?? null,
    actorRole: t.actor_role ?? null,
  });
  return c.json({ ok: true });
});

router.post('/rpc/inspect_scanned_card', requireAuth, async (c) => {
  const { card_unique_id } = (await c.req.json().catch(() => ({}))) as { card_unique_id?: string };
  if (!card_unique_id) return c.json({ data: { status: 'missing' } });
  const claims = c.get('auth');
  const result = await withUid(claims.sub, async (sql) => {
    const { rows } = await sql('select public.inspect_scanned_card($1::uuid) as result', [card_unique_id]);
    return rows[0]?.result ?? { status: 'missing' };
  });
  return c.json({ data: result });
});

router.post('/rpc/get_scan_entry_context', async (c) => {
  const { slug, card_unique_id } = (await c.req.json().catch(() => ({}))) as { slug?: string; card_unique_id?: string };
  if (!slug || !card_unique_id) return c.json({ data: null });
  const result = await withUid(null, async (sql) => {
    const { rows } = await sql('select public.get_scan_entry_context($1, $2::uuid) as result', [slug, card_unique_id]);
    return rows[0]?.result ?? null;
  });
  return c.json({ data: result });
});

export default router;
