import { Hono } from 'hono';
import { z } from 'zod';
import { withUid } from '../db/rpc.js';

const router = new Hono();

const registerSchema = z.object({
  slug: z.string().min(1),
  campaign_id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().or(z.literal('')).optional(),
  mobile: z.string().optional(),
});

router.post('/context', async (c) => {
  const { slug, campaign_id } = (await c.req.json().catch(() => ({}))) as { slug?: string; campaign_id?: string };
  if (!slug || !campaign_id) return c.json({ data: null });
  const result = await withUid(null, async (sql) => {
    const { rows } = await sql(
      'select public.get_public_campaign_signup_context($1, $2) as result',
      [slug, campaign_id]
    );
    return rows[0]?.result ?? null;
  });
  return c.json({ data: result });
});

router.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ data: { outcome: 'error', error: 'Invalid signup payload.' } });
  const result = await withUid(null, async (sql) => {
    const { rows } = await sql(
      'select public.register_public_campaign_signup($1, $2, $3, $4, $5) as result',
      [
        parsed.data.slug,
        parsed.data.campaign_id,
        parsed.data.name,
        parsed.data.email ?? '',
        parsed.data.mobile ?? '',
      ]
    );
    return rows[0]?.result ?? { outcome: 'error', error: 'Unable to complete signup right now. Please try again.' };
  });
  return c.json({ data: result });
});

router.post('/public-card', async (c) => {
  const { slug, card_unique_id } = (await c.req.json().catch(() => ({}))) as { slug?: string; card_unique_id?: string };
  if (!slug || !card_unique_id) return c.json({ data: null });
  const result = await withUid(null, async (sql) => {
    const { rows } = await sql(
      'select public.get_public_card($1, $2::uuid) as result',
      [slug, card_unique_id]
    );
    return rows[0]?.result ?? null;
  });
  return c.json({ data: result });
});

export default router;
