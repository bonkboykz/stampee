import { api, ApiError } from '../api';
import type { User } from '../../types';

export const profileToUser = (row: Record<string, unknown>): User => ({
  id: row.id as string,
  businessName: row.business_name as string,
  email: row.email as string,
  slug: row.slug as string | undefined,
  role: row.role as 'owner' | 'staff',
  ownerId: (row.owner_id as string | null) ?? undefined,
  status: row.status as 'unverified' | 'verified',
  access: row.access as 'active' | 'disabled',
  tier: (row.tier as 'free' | 'pro') ?? 'free',
  tierExpiresAt: (row.tier_expires_at as string | null) ?? undefined,
  createdAt: row.created_at as string,
});

export type ProfileFetchResult = {
  user: User | null;
  error: string | null;
  code?: string | null;
};

export async function fetchProfileDetailed(userId: string): Promise<ProfileFetchResult> {
  try {
    const { data } = await api.get<{ data: Record<string, unknown> | null }>(`/profiles/${userId}`);
    if (!data) return { user: null, error: null };
    return { user: profileToUser(data), error: null, code: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { user: null, error: message };
  }
}

export async function fetchProfile(userId: string): Promise<User | null> {
  const result = await fetchProfileDetailed(userId);
  return result.user;
}

export async function fetchProfileBySlug(slug: string): Promise<User | null> {
  try {
    const { data } = await api.get<{ data: Record<string, unknown> | null }>(`/profiles/by-slug/${encodeURIComponent(slug)}`);
    return data ? profileToUser(data) : null;
  } catch {
    return null;
  }
}

export async function fetchStaffAccounts(ownerId: string): Promise<User[]> {
  try {
    const { data } = await api.get<{ data: Record<string, unknown>[] }>(`/profiles/staff/of/${ownerId}`);
    return (data ?? []).map(profileToUser);
  } catch {
    return [];
  }
}

export async function updateProfile(
  userId: string,
  updates: { business_name?: string; email?: string; slug?: string; status?: string; access?: string; tier?: string; tier_expires_at?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/profiles/${userId}`, updates);
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to update this profile right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  try {
    const { data } = await api.post<{ data: boolean }>('/profiles/rpc/is_slug_available', { slug });
    return data === true;
  } catch {
    return false;
  }
}
