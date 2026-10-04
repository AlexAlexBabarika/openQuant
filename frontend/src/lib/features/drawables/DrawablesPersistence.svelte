<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { drawables } from './store.svelte';
  import { loadAll, saveAll } from './persistence';

  let {
    userId = null,
    ready = true,
  }: { userId?: string | null; ready?: boolean } = $props();
  let activeOwner: string | null | undefined;

  function flush(): void {
    if (activeOwner !== undefined) saveAll(drawables.items, activeOwner);
  }

  $effect.pre(() => {
    const owner = userId;
    const canRestore = ready;
    untrack(() => {
      if (!canRestore) {
        flush();
        activeOwner = undefined;
        drawables.replaceAll([]);
        return;
      }
      if (activeOwner === owner) return;
      flush();
      activeOwner = owner;
      drawables.replaceAll(loadAll(owner));
    });
  });

  $effect(() => {
    const items = drawables.items;
    const owner = userId;
    if (!ready || activeOwner !== owner) return;
    const id = setTimeout(() => {
      if (ready && userId === owner && activeOwner === owner) {
        saveAll(items, owner);
      }
    }, 500);
    return () => clearTimeout(id);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  });

  onDestroy(flush);
</script>
