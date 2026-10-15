import { apiFetch, apiJson, readErrorMessage } from '$lib/core/api';

export const API_KEY_PROVIDERS = [
  { value: 'twelvedata', label: 'Twelve Data' },
  { value: 'alphavantage', label: 'Alpha Vantage' },
  { value: 'massive', label: 'Massive' },
  { value: 'tradier', label: 'Tradier (production, read-only chains)' },
  { value: 'tradier_sandbox', label: 'Tradier Sandbox (delayed chains)' },
] as const;

export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number]['value'];

export type ApiKeyInfo = {
  id: string;
  provider: ApiKeyProvider;
  key_prefix: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const data = await apiJson<{ keys: ApiKeyInfo[] }>(
    '/user/api-keys',
    {},
    true,
  );
  return data.keys;
}

export function createApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<ApiKeyInfo> {
  return apiJson<ApiKeyInfo>(
    '/user/api-keys',
    {
      method: 'POST',
      body: JSON.stringify({ provider, api_key: apiKey }),
    },
    true,
  );
}

export function updateApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<ApiKeyInfo> {
  return apiJson<ApiKeyInfo>(
    `/user/api-keys/${provider}`,
    {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey }),
    },
    true,
  );
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  const res = await apiFetch(
    `/user/api-keys/${provider}`,
    { method: 'DELETE' },
    true,
  );
  if (!res.ok) throw new Error(await readErrorMessage(res));
}
