<script lang="ts">
  import StrategyTrial from '$lib/features/trial/StrategyTrial.svelte';
  import { selectEntry } from './entry';
  import { applyTheme, loadTheme } from '$lib/features/theme/theme';

  const trialOnly = document.querySelector('meta[name="openquant-mode"]')?.getAttribute('content') === 'trial-only';
  const entry = selectEntry(window.location.search, trialOnly);
  applyTheme(loadTheme());
</script>

<svelte:head>
  <title>{trialOnly ? 'OpenQuant — Strategy on Trial demo' : 'OpenQuant — Research workspace'}</title>
</svelte:head>

{#if !trialOnly}
  {#await import('./App.svelte')}
    <p role="status">Opening the research workspace…</p>
  {:then { default: Workspace }}
    <Workspace />
  {:catch}
    <p role="alert">The research workspace could not load. Refresh to retry.</p>
  {/await}
{:else}
  {#if trialOnly}
    <aside id="workspace-unavailable" aria-label="Standalone demo mode" tabindex="-1">
      <strong>Curated demo only.</strong>
      The research workspace is unavailable in this standalone server. Start the full OpenQuant app to use accounts, market data and research tools.
      {#if entry === 'workspace-unavailable'}<a href="/">Return to the trial</a>{/if}
    </aside>
  {/if}
  <StrategyTrial workspaceHref="#workspace-unavailable" />
{/if}

<style>
  aside { padding: 1rem 1.5rem; background: oklch(var(--muted)); color: oklch(var(--foreground)); font-size: .9rem; line-height: 1.5; border-bottom: 1px solid oklch(var(--border)); }
  aside:target { outline: 2px solid oklch(var(--primary)); outline-offset: -2px; }
  aside a { color: inherit; text-decoration: underline; margin-left: .5rem; }
</style>
