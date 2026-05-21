import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { withUid } from '../db/rpc.js';

const router = new Hono();

const activateSchema = z.object({ key: z.string().min(1) });

router.post('/activate', requireAuth, async (c) => {
  const parsed = activateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: 'Invalid key.' }, 400);
  const claims = c.get('auth');
  const result = await withUid(claims.sub, async (sql) => {
    const { rows } = await sql('select public.activate_license_key($1) as result', [parsed.data.key]);
    return rows[0]?.result ?? { success: false, error: 'Unable to activate this key right now. Please try again.' };
  });
  return c.json(result);
});

export default router;
