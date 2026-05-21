const baseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '') ?? '';

export const isApiConfigured = Boolean(baseUrl);
export const API_CONFIG_ERROR =
  'Missing VITE_API_URL. Configure it in your deployment environment.';

const TOKEN_KEY = 'stampee.auth.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
  form?: FormData;
};

async function request<T>(path: string, init: ApiInit = {}): Promise<T> {
  if (!baseUrl) throw new ApiError(0, API_CONFIG_ERROR);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (init.form) {
    body = init.form;
  } else if (init.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(init.body);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    body,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    const message =
      (isJson && payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: string }).error === 'string')
        ? (payload as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: ApiInit) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: ApiInit) => request<T>(path, { ...init, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, init?: ApiInit) => request<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T>(path: string, init?: ApiInit) => request<T>(path, { ...init, method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};
