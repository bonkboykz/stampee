import { api } from '../api';

export interface PublicCampaignSignupContext {
  owner: {
    id: string;
    slug: string;
    businessName: string;
  };
  campaign: {
    id: string;
    name: string;
    isEnabled: boolean;
  };
}

export type PublicCampaignSignupOutcome =
  | { outcome: 'issued'; uniqueId: string }
  | { outcome: 'redirect_existing'; uniqueId: string }
  | { outcome: 'campaign_disabled_no_existing' }
  | { outcome: 'error'; error: string };

export async function fetchPublicCampaignSignupContext(
  slug: string,
  campaignId: string
): Promise<PublicCampaignSignupContext | null> {
  try {
    const { data } = await api.post<{ data: PublicCampaignSignupContext | null }>('/public/context', {
      slug,
      campaign_id: campaignId,
    });
    if (!data?.owner?.id || !data.owner.slug || !data.campaign?.id || !data.campaign.name) return null;
    return {
      owner: {
        id: data.owner.id,
        slug: data.owner.slug,
        businessName: data.owner.businessName ?? '',
      },
      campaign: {
        id: data.campaign.id,
        name: data.campaign.name,
        isEnabled: data.campaign.isEnabled !== false,
      },
    };
  } catch {
    return null;
  }
}

export async function registerPublicCampaignSignup(input: {
  slug: string;
  campaignId: string;
  name: string;
  email?: string;
  mobile?: string;
}): Promise<PublicCampaignSignupOutcome> {
  try {
    const { data } = await api.post<{ data: PublicCampaignSignupOutcome }>('/public/register', {
      slug: input.slug,
      campaign_id: input.campaignId,
      name: input.name,
      email: input.email ?? '',
      mobile: input.mobile ?? '',
    });
    if (!data || typeof data !== 'object') {
      return { outcome: 'error', error: 'Unable to complete signup right now. Please try again.' };
    }
    return data;
  } catch {
    return { outcome: 'error', error: 'Unable to complete signup right now. Please try again.' };
  }
}

export interface PublicCardPayload {
  card: {
    id: string;
    uniqueId: string;
    campaignId: string | null;
    campaignName: string;
    stamps: number;
    lastVisit: string;
    status: 'Active' | 'Redeemed';
    completedDate?: string;
    templateSnapshot?: Record<string, unknown> | null;
    history: Array<{
      id: string;
      type: string;
      amount: number;
      date: string;
      timestamp: number;
      title: string;
    }>;
  };
  customer: { id: string; name: string };
  campaign?: Record<string, unknown> | null;
}

export async function fetchPublicCard(slug: string, cardUniqueId: string): Promise<PublicCardPayload | null> {
  try {
    const { data } = await api.post<{ data: PublicCardPayload | null }>('/public/public-card', {
      slug,
      card_unique_id: cardUniqueId,
    });
    return data ?? null;
  } catch {
    return null;
  }
}
