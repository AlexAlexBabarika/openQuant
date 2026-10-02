<script lang="ts">
  import StrategyTrial from '$lib/features/trial/StrategyTrial.svelte';
  import { selectEntry } from './entry';

  const trialOnly = document.querySelector('meta[name="openquant-mode"]')?.getAttribute('content') === 'trial-only';
  const entry = selectEntry(window.location.search, trialOnly);
</script>

<svelte:head>
  <title>{entry === 'workspace' ? 'OpenQuant — Research workspace' : 'OpenQuant — Strategy on Trial'}</title>
</svelte:head>

{#if entry === 'workspace'}
  {#await import('./App.svelte')}
    <p role="status">Opening the research workspace…</p>
  {:then { default: Workspace }}
    <Workspace />
  {:catch}
    <p role="alert">The research workspace could not load. <a href="/">Return to Strategy on Trial</a> or refresh to retry.</p>
  {/await}
{:else}
  {#if trialOnly}
    <aside id="workspace-unavailable" aria-label="Standalone demo mode" tabindex="-1">
      <strong>Curated demo only.</strong>
      The research workspace is unavailable in this standalone server. Start the full OpenQuant app to use accounts, market data and research tools.
      {#if entry === 'workspace-unavailable'}<a href="/">Return to the trial</a>{/if}
    </aside>
  {/if}
  <StrategyTrial workspaceHref={trialOnly ? '#workspace-unavailable' : '/?workspace=1'} />
{/if}

<style>
  aside { padding: 1rem 1.5rem; background: #292d22; color: #f0ede5; font-size: .9rem; line-height: 1.5; }
  aside:target { outline: 2px solid #efad78; outline-offset: -2px; }
  aside a { color: inherit; text-decoration: underline; margin-left: .5rem; }
</style>
