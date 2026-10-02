<script lang="ts">
  import StrategyTrial from '$lib/features/trial/StrategyTrial.svelte';
  import { selectEntry } from './entry';
  import { applyTheme, loadTheme } from '$lib/features/theme/theme';

  const trialOnly = document.querySelector('meta[name="openquant-mode"]')?.getAttribute('content') === 'trial-only';
  const entry = selectEntry(window.location.search, trialOnly);
  applyTheme(loadTheme());
</script>

<svelte:head>
  <title>{trialOnly ? 'OpenQuant — Robustness examples' : 'OpenQuant — Research workspace'}</title>
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
    <aside id="workspace-unavailable" aria-label="Standalone demo mode" tabindex="-1">
      <strong>Standalone examples server.</strong>
      This server has no research workspace. Start the full OpenQuant app with its normal launcher to use market data, custom strategies and backtesting. Changing the URL cannot enable the workspace here.
      {#if entry === 'workspace-unavailable'}<a href="/">Return to examples</a>{/if}
    </aside>
  <StrategyTrial workspaceHref="#workspace-unavailable" />
{/if}

<style>
  aside { padding: 12px 18px; background: oklch(var(--muted)); color: oklch(var(--foreground)); font: 11px/1.6 var(--font-mono); border-bottom: 1px solid oklch(var(--border)); }
  aside:target { outline: 2px solid oklch(var(--primary)); outline-offset: -2px; }
  aside a { color: inherit; text-decoration: underline; margin-left: .5rem; }
</style>
