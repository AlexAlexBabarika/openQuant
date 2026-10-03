<script lang="ts">
  import { isWorkspaceReport, type EvidenceReport } from '../trial/workspace';
  import { createTrialShareUrl, TRIAL_SHARE_NOTICE } from './sharing';
  import { generateTrialReportHtml, trialReportFilename } from './export';

  let { report }: { report: EvidenceReport } = $props();
  const id = $props.id();
  let status = $state('');
  let fallbackUrl = $state('');
  let copying = $state(false);

  export async function copyLink(): Promise<void> {
    if (copying || isWorkspaceReport(report)) return;
    copying = true;
    fallbackUrl = '';
    status = '';
    try {
      const url = createTrialShareUrl(report.config, window.location.href);
      try {
        await navigator.clipboard.writeText(url);
        status = 'Demo configuration link copied.';
      } catch {
        fallbackUrl = url;
        status = 'Clipboard unavailable. Select and copy the link below.';
      }
    } catch {
      status = 'Could not create a link for this configuration.';
    } finally {
      copying = false;
    }
  }

  export function downloadHtml(): void {
    status = '';
    let url: string | undefined;
    try {
      const blob = new Blob([generateTrialReportHtml(report)], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = trialReportFilename(report);
      document.body.appendChild(link);
      try {
        link.click();
        status = 'HTML snapshot download requested. Open the file to view or print it.';
      } finally {
        link.remove();
      }
    } catch {
      status = 'Could not download the HTML snapshot. Please try again.';
    } finally {
      if (url) {
        const objectUrl = url;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }
</script>

<section aria-label="Share or save this robustness report">
  <div class="actions">
    {#if !isWorkspaceReport(report)}<button class="ot-workbench-ghost" type="button" onclick={copyLink} disabled={copying} aria-describedby={`${id}-notice`}>
      {copying ? 'Copying…' : 'Copy demo configuration link'}
    </button>{/if}
    <button class="ot-workbench-ghost" type="button" onclick={downloadHtml}>Download HTML snapshot</button>
  </div>
  <p id={`${id}-notice`} class="notice">{isWorkspaceReport(report) ? 'Local snapshot only: results and configuration, not strategy source. No public code or market-data rerun link is created. Review the exported results before sharing.' : TRIAL_SHARE_NOTICE}</p>
  <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
  {#if fallbackUrl}
    <label for={`${id}-link`}>Demo configuration link — select to copy</label>
    <input
      id={`${id}-link`}
      type="url"
      readonly
      value={fallbackUrl}
      onfocus={event => event.currentTarget.select()}
    />
  {/if}
</section>

<style>
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  button { height: auto; min-height: 44px; padding: 0.6rem 1rem; }
  button:disabled { opacity: 0.6; cursor: wait; }
  button:focus-visible, input:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .notice { font-size: 0.8rem; max-width: 75ch; color: oklch(var(--muted-foreground)); margin: 0.75rem 0; }
  label { display: block; margin-bottom: 0.4rem; }
  input { width: 100%; padding: 0.65rem; border: 1px solid currentColor; border-radius: 0.3rem; font: inherit; background: transparent; color: inherit; }
</style>
