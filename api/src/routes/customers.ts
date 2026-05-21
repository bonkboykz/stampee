import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customers, issuedCards, transactions } from '../db/schema.js';
import { requireAuth, effectiveOwnerId } from '../auth/middleware.js';

const router = new Hono();

const upsertSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email().or(z.literal('')),
  mobile: z.string().optional(),
  status: z.enum(['Active', 'Inactive']),
});

function customerRow(row: typeof customers.$inferSelect) {
  return {
    id: row.id,
    owner_id: row.ownerId,
    name: row.name,
    email: row.email,
    mobile: row.mobile,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

function cardRow(row: typeof issuedCards.$inferSelect) {
  return {
    id: row.id,
    unique_id: row.uniqueId,
    customer_id: row.customerId,
    campaign_id: row.campaignId,
    owner_id: row.ownerId,
    campaign_name: row.campaignName,
    stamps: row.stamps,
    last_visit: row.lastVisit,
    status: row.status,
    completed_date: row.completedDate,
    template_snapshot: row.templateSnapshot,
    created_at: row.createdAt.toISOString(),
  };
}

function txRow(row: typeof transactions.$inferSelect) {
  return {
    id: row.id,
    card_id: row.cardId,
    type: row.type,
    amount: row.amount,
    date: row.date,
    timestamp: row.timestamp,
    title: row.title,
    remarks: row.remarks,
    actor_id: row.actorId,
    actor_name: row.actorName,
    actor_role: row.actorRole,
  };
}

router.get('/', requireAuth, async (c) => {
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ customers: [], cards: [], transactions: [] });

  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.ownerId, ownerId))
    .orderBy(asc(customers.createdAt));

  const customerIds = customerRows.map((r) => r.id);
  let cardRows: (typeof issuedCards.$inferSelect)[] = [];
  let txRows: (typeof transactions.$inferSelect)[] = [];
  if (customerIds.length > 0) {
    cardRows = await db
      .select()
      .from(issuedCards)
      .where(inArray(issuedCards.customerId, customerIds));
    const cardIds = cardRows.map((c) => c.id);
    if (cardIds.length > 0) {
      txRows = await db
        .select()
        .from(transactions)
        .where(inArray(transactions.cardId, cardIds))
        .orderBy(asc(transactions.timestamp));
    }
  }

  return c.json({
    customers: customerRows.map(customerRow),
    cards: cardRows.map(cardRow),
    transactions: txRows.map(txRow),
  });
});

router.post('/', requireAuth, async (c) => {
  const parsed = upsertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid customer payload.' }, 400);
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ error: 'No owner scope.' }, 403);

  const c0 = parsed.data;
  await db
    .insert(customers)
    .values({
      id: c0.id,
      ownerId,
      name: c0.name,
      email: c0.email,
      mobile: c0.mobile ?? null,
      status: c0.status,
    })
    .onConflictDoUpdate({
      target: customers.id,
      set: {
        name: c0.name,
        email: c0.email,
        mobile: c0.mobile ?? null,
        status: c0.status,
      },
    });
  return c.json({ ok: true, id: c0.id });
});

router.patch('/:id/status', requireAuth, async (c) => {
  const id = c.req.param('id');
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ error: 'No owner scope.' }, 403);
  const { status } = (await c.req.json().catch(() => ({}))) as { status?: string };
  if (status !== 'Active' && status !== 'Inactive') {
    return c.json({ error: 'Invalid status.' }, 400);
  }
  await db
    .update(customers)
    .set({ status })
    .where(and(eq(customers.id, id), eq(customers.ownerId, ownerId)));
  return c.json({ ok: true });
});

export default router;
