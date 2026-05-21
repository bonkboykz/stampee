import { api, ApiError } from '../api';
import type { StoredTemplate } from '../../types';

interface CampaignRow {
  id: string;
  owner_id: string;
  name: string;
  is_enabled: boolean;
  description: string;
  reward_name: string;
  tagline: string | null;
  background_image: string | null;
  background_opacity: number;
  logo_image: string | null;
  show_logo: boolean;
  title_size: string | null;
  icon_key: string;
  colors: Record<string, string>;
  total_stamps: number;
  social: Record<string, string> | null;
}

export function rowToStoredTemplate(row: CampaignRow): StoredTemplate {
  return {
    id: row.id,
    name: row.name,
    isEnabled: row.is_enabled,
    description: row.description,
    rewardName: row.reward_name,
    tagline: row.tagline ?? undefined,
    backgroundImage: row.background_image ?? undefined,
    backgroundOpacity: row.background_opacity,
    logoImage: row.logo_image ?? undefined,
    showLogo: row.show_logo,
    titleSize: row.title_size ?? undefined,
    iconKey: row.icon_key,
    colors: row.colors as StoredTemplate['colors'],
    totalStamps: row.total_stamps,
    social: row.social as StoredTemplate['social'],
  };
}

function templateToRow(t: StoredTemplate) {
  return {
    id: t.id,
    name: t.name,
    is_enabled: t.isEnabled ?? true,
    description: t.description,
    reward_name: t.rewardName,
    tagline: t.tagline ?? null,
    background_image: t.backgroundImage ?? null,
    background_opacity: t.backgroundOpacity ?? 100,
    logo_image: t.logoImage ?? null,
    show_logo: t.showLogo ?? true,
    title_size: t.titleSize ?? null,
    icon_key: t.iconKey,
    colors: t.colors,
    total_stamps: t.totalStamps,
    social: t.social ?? null,
  };
}

export async function fetchCampaigns(_ownerId: string): Promise<StoredTemplate[]> {
  try {
    const { data } = await api.get<{ data: CampaignRow[] }>('/campaigns');
    return (data ?? []).map(rowToStoredTemplate);
  } catch {
    return [];
  }
}

export async function upsertCampaign(template: StoredTemplate, _ownerId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post('/campaigns', templateToRow(template));
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to save this campaign right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function setCampaignEnabled(
  campaignId: string,
  _ownerId: string,
  isEnabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/campaigns/${encodeURIComponent(campaignId)}/enabled`, { is_enabled: isEnabled });
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to update this campaign status right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function deleteCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await api.delete<{ data?: { success?: boolean } }>(`/campaigns/${encodeURIComponent(campaignId)}`);
    if (result.data && result.data.success === false) {
      return { ok: false, error: 'Unable to delete this campaign right now. Please try again.' };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to delete this campaign right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function countCampaigns(_ownerId: string): Promise<number> {
  try {
    const { count } = await api.get<{ count: number }>('/campaigns/count');
    return count ?? 0;
  } catch {
    return 0;
  }
}
