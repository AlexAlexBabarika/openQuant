<!--
  Inline error banner. Collapsed it shows a single truncated line; clicking
  expands it to the full, wrapped message so long errors (stack traces, sandbox
  stderr) are fully readable. Shared by the strategy/portfolio/indicator panels.
-->
<script lang="ts">
  let { message }: { message: string } = $props();
  let expanded = $state(false);
</script>

<button
  type="button"
  class="banner err"
  class:expanded
  aria-live="polite"
  aria-expanded={expanded}
  title={expanded ? message : `${message} (click to expand)`}
  onclick={() => (expanded = !expanded)}
>
  {message}
</button>

<style>
  .banner.err {
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 10px;
    border: 1px solid color-mix(in oklab, oklch(var(--status-error)) 50%, transparent);
    border-radius: 3px;
    background: color-mix(in oklab, oklch(var(--status-error)) 10%, transparent);
    color: oklch(var(--status-error));
    font-size: var(--font-size-label);
    letter-spacing: 0.02em;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .banner.err.expanded {
    white-space: pre-wrap;
    overflow: visible;
    word-break: break-word;
  }
</style>
