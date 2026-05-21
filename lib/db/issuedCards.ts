import { api, ApiError } from '../api';
import type { IssuedCard, Transaction, StoredTemplate } from '../../types';

export type ScannedCardStatus = 'owned' | 'foreign' | 'missing';

export interface PublicScanEntryContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  card: {
    uniqueId: string;
  };
}

export async function insertIssuedCard(
  card: {
    id: string;
    uniqueId: string;
    customerId: string;
    campaignId: string;
    campaignName: string;
    templateSnapshot?: StoredTemplate;
  },
  _ownerId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post('/issued-cards', {
      id: card.id,
      unique_id: card.uniqueId,
      customer_id: card.customerId,
      campaign_id: card.campaignId,
      campaign_name: card.campaignName,
      template_snapshot: card.templateSnapshot ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to issue this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function updateIssuedCard(
  cardId: string,
  updates: Partial<Pick<IssuedCard, 'stamps' | 'status' | 'completedDate' | 'lastVisit'>>
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {};
  if (updates.stamps !== undefined) payload.stamps = updates.stamps;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.completedDate !== undefined) payload.completed_date = updates.completedDate;
  if (updates.lastVisit !== undefined) payload.last_visit = updates.lastVisit;
  try {
    await api.patch(`/issued-cards/${encodeURIComponent(cardId)}`, payload);
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to update this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function deleteIssuedCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.delete(`/issued-cards/${encodeURIComponent(cardId)}`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to revoke this card right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function insertTransaction(
  cardId: string,
  tx: Transaction
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post(`/issued-cards/${encodeURIComponent(cardId)}/transactions`, {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      date: tx.date,
      timestamp: tx.timestamp,
      title: tx.title,
      remarks: tx.remarks ?? null,
      actor_id: tx.actorId ?? null,
      actor_name: tx.actorName ?? null,
      actor_role: tx.actorRole ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to save this activity right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function countIssuedCards(_ownerId: string): Promise<number> {
  try {
    const { count } = await api.get<{ count: number }>('/issued-cards/count');
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function inspectScannedCard(uniqueId: string): Promise<{ status: ScannedCardStatus; error?: string }> {
  try {
    const { data } = await api.post<{ data: { status?: string } }>('/issued-cards/rpc/inspect_scanned_card', {
      card_unique_id: uniqueId,
    });
    const status = data?.status;
    if (status === 'owned' || status === 'foreign' || status === 'missing') {
      return { status };
    }
    return { status: 'missing' };
  } catch {
    return { status: 'missing', error: 'Unable to validate this card right now. Please try again.' };
  }
}

export async function fetchPublicScanEntryContext(
  slug: string,
  uniqueId: string
): Promise<PublicScanEntryContext | null> {
  try {
    const { data } = await api.post<{ data: PublicScanEntryContext | null }>('/issued-cards/rpc/get_scan_entry_context', {
      slug,
      card_unique_id: uniqueId,
    });
    if (!data || !data.owner?.id || !data.owner.slug || !data.card?.uniqueId) return null;
    return {
      owner: {
        id: data.owner.id,
        slug: data.owner.slug,
        businessName: data.owner.businessName ?? '',
      },
      card: { uniqueId: data.card.uniqueId },
    };
  } catch {
    return null;
  }
}
