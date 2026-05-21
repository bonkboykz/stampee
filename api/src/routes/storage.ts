import { Hono } from 'hono';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { bucketName, publicUrlFor, s3, s3Configured } from '../lib/s3.js';
import { requireAuth, effectiveOwnerId } from '../auth/middleware.js';

const router = new Hono();

const LOGO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);
const BG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

router.post('/campaign-assets', requireAuth, async (c) => {
  if (!s3 || !s3Configured) {
    return c.json({ error: 'Storage is not configured on the server.' }, 503);
  }
  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ error: 'No owner scope.' }, 403);

  const form = await c.req.formData();
  const file = form.get('file');
  const kind = String(form.get('kind') ?? '');
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
  if (kind !== 'logo' && kind !== 'background') return c.json({ error: 'kind must be logo or background' }, 400);

  const maxBytes = kind === 'logo' ? 2 * 1024 * 1024 : 6 * 1024 * 1024;
  if (file.size > maxBytes) {
    return c.json({ error: kind === 'logo' ? 'Logo must be 2MB or smaller.' : 'Background must be 6MB or smaller.' }, 400);
  }
  const allowed = kind === 'logo' ? LOGO_EXT : BG_EXT;
  const nameExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeExt = MIME_TO_EXT[file.type] ?? '';
  const ext = allowed.has(nameExt) ? nameExt : allowed.has(mimeExt) ? mimeExt : '';
  if (!ext) {
    return c.json({
      error: kind === 'logo'
        ? 'Logo must be a JPG, PNG, WebP, or SVG file.'
        : 'Background must be a JPG, PNG, or WebP file.',
    }, 400);
  }

  const path = `${ownerId}/${kind}/${crypto.randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: path,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type || undefined,
    ACL: 'public-read',
  }));

  const publicUrl = publicUrlFor(path);
  if (!publicUrl) return c.json({ error: 'Image uploaded, but public URL could not be resolved.' }, 500);
  return c.json({ publicUrl, path });
});

router.post('/campaign-assets/delete', requireAuth, async (c) => {
  if (!s3 || !s3Configured) return c.json({ managed: false, deleted: false });
  const { path } = (await c.req.json().catch(() => ({}))) as { path?: string };
  if (!path || path.includes('..')) return c.json({ managed: false, deleted: false });

  const claims = c.get('auth');
  const ownerId = effectiveOwnerId(claims);
  if (!ownerId) return c.json({ managed: false, deleted: false });
  if (!path.startsWith(`${ownerId}/`)) return c.json({ managed: false, deleted: false });

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: path }));
    return c.json({ managed: true, deleted: true });
  } catch (err) {
    console.error('[storage/delete] failed', err);
    return c.json({ managed: true, deleted: false, error: 'Unable to remove previous image from storage.' });
  }
});

export default router;
