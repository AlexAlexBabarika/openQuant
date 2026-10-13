<script lang="ts">
  import type { DataQualityReport } from '$lib/features/runs/dataQuality';
  let { report, pending = false }: {report: DataQualityReport | null | undefined; pending?: boolean} = $props();
</script>

<details class="text-xs rounded border border-border p-2" open={!!report?.errors.length}>
  <summary>Data quality · {report?.errors.length ? 'execution blocked' : report ? `${report.warnings.length} warnings` : 'unavailable'}</summary>
  {#if report}
    {#each report.errors as issue}<p role="alert">Blocking error · {issue.code}: {issue.message} ({issue.count})</p>{/each}
    {#each report.warnings as issue}<p>Warning · {issue.code}: {issue.message} ({issue.count})</p>{/each}
    <p>{report.provenance.row_count} canonical bars · {report.provenance.start ?? 'Unknown start'} — {report.provenance.end ?? 'Unknown end'}</p>
    <p>Provider/version are recorded labels, not independent certification. Calendar and adjustment unknown; freshness not assessed. Upstream normalization may already have repaired or dropped rows.</p>
    {#if pending}<p>Preview only. Execution re-inspects loaded bars and rejects a changed dataset identity.</p>{/if}
  {:else}<p>{pending ? 'Cache-only preview unavailable. Execution will inspect its loaded snapshot before compute.' : 'No recorded quality evidence in this result. Missing evidence is not a pass.'}</p>{/if}
</details>
