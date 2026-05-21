import { api, ApiError } from '../api';

interface ActivationResult {
  success: boolean;
  error?: string;
  expires_at?: string;
}

export async function activateLicenseKey(key: string): Promise<ActivationResult> {
  try {
    return await api.post<ActivationResult>('/license-keys/activate', { key });
  } catch (err) {
    const error = err instanceof ApiError ? err.message : 'Unable to activate this key right now. Please try again.';
    return { success: false, error };
  }
}
