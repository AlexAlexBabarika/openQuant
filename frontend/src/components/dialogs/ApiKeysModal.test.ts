import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import type { ApiKeyInfo } from '$lib/features/api-keys/api-keys';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

async function settle() {
  for (let i = 0; i < 3; i++) {
    client.flush();
    await Promise.resolve();
  }
  client.flush();
}

function setup(keys: ApiKeyInfo[]) {
  const url = new URL('./ApiKeysModal.svelte', import.meta.url);
  const script = readFileSync(url, 'utf8').split('</script>')[0];
  const listApiKeys = vi.fn(async () => keys);
  const module = clientModule<{
    default: (
      anchor: null,
      props: { open: boolean },
    ) => {
      setOpen: (value: boolean) => void;
      read: () => {
        fetching: boolean;
        keys: ApiKeyInfo[];
        error: string | null;
      };
    };
  }>(
    url,
    {
      '$lib/components/ui/dialog': {},
      '$lib/components/ui/button': {},
      '$lib/components/ui/input': {},
      '$lib/components/ui/select': {},
      '$lib/features/api-keys/api-keys': {
        API_KEY_PROVIDERS: [],
        listApiKeys,
        createApiKey: vi.fn(),
        updateApiKey: vi.fn(),
      },
    },
    `${script}
    export function setOpen(value: boolean) { open = value; }
    export function read() { return { fetching: fetchingKeys, keys: existingKeys, error }; }
    </script>`,
  );
  let modal!: ReturnType<typeof module.default>;
  cleanups.push(
    client.effect_root(() => {
      modal = module.default(null, { open: false });
    }),
  );
  return { modal, listApiKeys };
}

describe('API keys modal loading', () => {
  it.each([
    { keys: [] },
    {
      keys: [
        {
          id: 'fixture',
          provider: 'alphavantage',
          key_prefix: 'test',
          created_at: null,
          updated_at: null,
        },
      ],
    },
  ] satisfies { keys: ApiKeyInfo[] }[])(
    'loads once per open, without subscribing to the response list ($keys)',
    async ({ keys }) => {
      const { modal, listApiKeys } = setup(keys);
      await settle();
      expect(listApiKeys).not.toHaveBeenCalled();
      modal.setOpen(true);
      await settle();
      expect(listApiKeys).toHaveBeenCalledTimes(1);
      expect(modal.read()).toMatchObject({ fetching: false, keys });
      modal.setOpen(false);
      await settle();
      modal.setOpen(true);
      await settle();
      expect(listApiKeys).toHaveBeenCalledTimes(2);
      expect(modal.read().fetching).toBe(false);
    },
  );

  it('settles a failed request without retrying on every state change', async () => {
    const { modal, listApiKeys } = setup([]);
    listApiKeys.mockRejectedValueOnce(new Error('Offline'));
    modal.setOpen(true);
    await settle();
    expect(listApiKeys).toHaveBeenCalledTimes(1);
    expect(modal.read()).toMatchObject({ fetching: false, error: 'Offline' });
  });
});
