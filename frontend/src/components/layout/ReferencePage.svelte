<script lang="ts">
  import type { Snippet } from 'svelte';

  // Shared page for the scripting references: hero, then the caller's sections.
  let {
    title,
    lede,
    children,
  }: { title: string; lede: Snippet; children: Snippet } = $props();
</script>

<div class="docs">
  <article>
    <header class="hero">
      <span class="kicker">// reference</span>
      <h1>{title}</h1>
      <p class="lede">{@render lede()}</p>
    </header>
    {@render children()}
  </article>
</div>

<style>
  .docs {
    height: 100%;
    overflow-y: auto;
    background:
      linear-gradient(
        180deg,
        color-mix(in oklab, oklch(var(--popover)) 100%, black 4%),
        color-mix(in oklab, oklch(var(--popover)) 100%, black 10%)
      );
  }

  article {
    max-width: 880px;
    margin: 0 auto;
    padding: 28px 32px 64px;
    color: oklch(var(--foreground));
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.65;
  }

  .hero {
    margin-bottom: 28px;
    padding-bottom: 18px;
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  .kicker {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .lede {
    color: color-mix(in oklab, oklch(var(--foreground)) 70%, transparent);
    margin: 0;
  }
  .lede :global(code) {
    font-family: inherit;
    color: oklch(var(--primary));
  }

  article :global(section) {
    margin-top: 26px;
  }
  article :global(h2) {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: lowercase;
  }
  article :global(.hash) {
    color: oklch(var(--primary));
    font-weight: 600;
  }
  article :global(.dim) {
    margin: 0 0 10px;
    color: oklch(var(--muted-foreground));
    font-size: 12px;
  }

  article :global(.defs) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  article :global(.defs li) {
    display: grid;
    grid-template-columns: minmax(140px, max-content) auto 1fr;
    gap: 12px;
    align-items: baseline;
    padding: 6px 10px;
    border-left: 2px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background: color-mix(in oklab, oklch(var(--foreground)) 3%, transparent);
    border-radius: 0 4px 4px 0;
  }
  article :global(.defs li.block) {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  article :global(.defs .name) {
    color: oklch(var(--primary));
    font-weight: 600;
  }
  article :global(.defs .sig) {
    color: oklch(var(--foreground));
    font-weight: 600;
    word-break: break-word;
  }
  article :global(.defs .type) {
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 999px;
    color: oklch(var(--muted-foreground));
  }
  article :global(.defs .desc) {
    color: color-mix(in oklab, oklch(var(--foreground)) 78%, transparent);
  }

  article :global(.tags) { margin: 0; }
  article :global(.tag) {
    display: inline-block;
    margin: 2px 6px 2px 0;
    padding: 2px 8px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 3px;
    font-size: 11px;
    color: oklch(var(--foreground));
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
  }

  article :global(.bullets) {
    margin: 0;
    padding-left: 18px;
    color: color-mix(in oklab, oklch(var(--foreground)) 78%, transparent);
  }
  article :global(.bullets li) { margin: 2px 0; }

  article :global(.example) {
    margin-top: 12px;
  }
  article :global(.example-title) {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  article :global(pre) {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.55;
  }
  article :global(pre code) { color: oklch(var(--foreground)); }

  /* Light theme: pure white surfaces, black hairlines, no greys. */
  :global(html:not(.dark)) .docs { background: oklch(var(--card)); }
  :global(html:not(.dark)) .hero { border-bottom: 1px dashed oklch(var(--foreground)); }
  :global(html:not(.dark)) article :global(.defs li) {
    background: oklch(var(--card));
    border-left: 2px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) article :global(.defs .type) {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) article :global(.tag) {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) article :global(pre) {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
</style>
