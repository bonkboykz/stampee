import { api, ApiError } from '../api';

export type CampaignAssetKind = 'logo' | 'background';

type UploadCampaignAssetInput = {
  file: File;
  ownerId: string;
  kind: CampaignAssetKind;
};

type UploadedCampaignAsset = {
  publicUrl: string;
  path: string;
};

type DeleteCampaignAssetResult = {
  managed: boolean;
  deleted: boolean;
  error?: string;
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BACKGROUND_MAX_BYTES = 6 * 1024 * 1024;
const LOGO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);
const BACKGROUND_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const LOGO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
const BACKGROUND_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const getExtensionFromName = (filename: string) => {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
};

const resolveAllowedRules = (kind: CampaignAssetKind) => {
  if (kind === 'logo') {
    return {
      maxBytes: LOGO_MAX_BYTES,
      allowedExtensions: LOGO_EXTENSIONS,
      allowedMimeTypes: LOGO_MIME_TYPES,
      typeError: 'Logo must be a JPG, PNG, WebP, or SVG file.',
      sizeError: 'Logo must be 2MB or smaller.',
    };
  }
  return {
    maxBytes: BACKGROUND_MAX_BYTES,
    allowedExtensions: BACKGROUND_EXTENSIONS,
    allowedMimeTypes: BACKGROUND_MIME_TYPES,
    typeError: 'Background must be a JPG, PNG, or WebP file.',
    sizeError: 'Background must be 6MB or smaller.',
  };
};

const validateUploadFile = (kind: CampaignAssetKind, file: File) => {
  const rules = resolveAllowedRules(kind);
  if (file.size > rules.maxBytes) throw new Error(rules.sizeError);
  const extension = getExtensionFromName(file.name);
  const extensionAllowed = Boolean(extension) && rules.allowedExtensions.has(extension);
  const mimeAllowed = Boolean(file.type) && rules.allowedMimeTypes.has(file.type);
  if (!extensionAllowed && !mimeAllowed) throw new Error(rules.typeError);
};

// Only manage URLs that look like our own bucket. Anything else (legacy
// Supabase URLs, external CDN) is left untouched.
const getManagedCampaignAssetPath = (url: string): string | null => {
  const base = import.meta.env.VITE_BUCKET_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base) return null;
  try {
    if (!url.startsWith(base + '/')) return null;
    const path = url.slice(base.length + 1);
    if (!path || path.includes('..')) return null;
    return decodeURIComponent(path);
  } catch {
    return null;
  }
};

export async function uploadCampaignAsset({
  file,
  ownerId: _ownerId,
  kind,
}: UploadCampaignAssetInput): Promise<UploadedCampaignAsset> {
  validateUploadFile(kind, file);
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  try {
    const result = await api.upload<UploadedCampaignAsset>('/storage/campaign-assets', form);
    if (!result.publicUrl) throw new Error('Image uploaded, but public URL could not be resolved.');
    return result;
  } catch (err) {
    if (err instanceof ApiError) throw new Error(err.message);
    throw new Error('Unable to upload image right now. Please try again.');
  }
}

export async function deleteCampaignAssetByUrl(url: string): Promise<DeleteCampaignAssetResult> {
  const managedPath = getManagedCampaignAssetPath(url);
  if (!managedPath) return { managed: false, deleted: false };
  try {
    return await api.post<DeleteCampaignAssetResult>('/storage/campaign-assets/delete', { path: managedPath });
  } catch {
    return { managed: true, deleted: false, error: 'Unable to remove previous image from storage. You can continue editing.' };
  }
}
