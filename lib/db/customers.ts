import { api, ApiError } from '../api';
import type { Customer, IssuedCard, Transaction } from '../../types';

interface CustomerRow {
  id: string;
  owner_id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: 'Active' | 'Inactive';
  created_at: string;
}

interface CardRow {
  id: string;
  unique_id: string;
  customer_id: string;
  campaign_id: string | null;
  owner_id: string;
  campaign_name: string;
  stamps: number;
  last_visit: string;
  status: 'Active' | 'Redeemed';
  completed_date: string | null;
  template_snapshot: unknown;
}

interface TxRow {
  id: string;
  card_id: string;
  type: Transaction['type'];
  amount: number;
  date: string;
  timestamp: number;
  title: string;
  remarks: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
}

function txFromRow(r: TxRow): Transaction {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    date: r.date,
    timestamp: r.timestamp,
    title: r.title,
    remarks: r.remarks ?? undefined,
    actorId: r.actor_id ?? undefined,
    actorName: r.actor_name ?? undefined,
    actorRole: (r.actor_role as 'owner' | 'staff' | undefined) ?? undefined,
  };
}

function cardFromRow(r: CardRow, history: Transaction[]): IssuedCard {
  return {
    id: r.id,
    uniqueId: r.unique_id,
    campaignId: r.campaign_id ?? null,
    campaignName: r.campaign_name,
    stamps: r.stamps,
    lastVisit: r.last_visit,
    status: r.status,
    completedDate: r.completed_date ?? undefined,
    history,
    templateSnapshot: (r.template_snapshot as IssuedCard['templateSnapshot']) ?? undefined,
  };
}

function customerFromRow(row: CustomerRow, cards: IssuedCard[]): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    mobile: row.mobile ?? undefined,
    status: row.status,
    cards,
  };
}

export async function fetchCustomersWithCards(_ownerId: string): Promise<Customer[]> {
  try {
    const payload = await api.get<{ customers: CustomerRow[]; cards: CardRow[]; transactions: TxRow[] }>('/customers');
    const txByCard = new Map<string, Transaction[]>();
    for (const t of payload.transactions ?? []) {
      const list = txByCard.get(t.card_id) ?? [];
      list.push(txFromRow(t));
      txByCard.set(t.card_id, list);
    }
    const cardsByCustomer = new Map<string, IssuedCard[]>();
    for (const r of payload.cards ?? []) {
      const card = cardFromRow(r, txByCard.get(r.id) ?? []);
      const list = cardsByCustomer.get(r.customer_id) ?? [];
      list.push(card);
      cardsByCustomer.set(r.customer_id, list);
    }
    return (payload.customers ?? []).map((r) =>
      customerFromRow(r, cardsByCustomer.get(r.id) ?? [])
    );
  } catch {
    return [];
  }
}

export async function upsertCustomer(
  customer: { id: string; name: string; email: string; mobile?: string; status: 'Active' | 'Inactive' },
  _ownerId: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await api.post('/customers', {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      mobile: customer.mobile,
      status: customer.status,
    });
    return { ok: true, id: customer.id };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to save this customer right now. Please try again.';
    return { ok: false, error: message };
  }
}

export async function updateCustomerStatus(
  customerId: string,
  status: 'Active' | 'Inactive'
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.patch(`/customers/${encodeURIComponent(customerId)}/status`, { status });
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Unable to update this customer right now. Please try again.';
    return { ok: false, error: message };
  }
}
