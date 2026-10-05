<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import TextPromptDialog from '../dialogs/TextPromptDialog.svelte';
  import CandlestickChart from '@lucide/svelte/icons/candlestick-chart';
  import LineChart from '@lucide/svelte/icons/line-chart';
  import AreaChart from '@lucide/svelte/icons/area-chart';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import Settings from '@lucide/svelte/icons/settings';
  import type { Theme } from '$lib/features/theme/theme';
  import ColourSwatch from './ColourSwatch.svelte';
  import type {
    ChartColours,
    ChartColourKey,
    ChartTemplate,
    ChartType,
  } from '$lib/features/chart/chartColours';
  import {
    defaultChartColours,
    setChartColour,
    loadTemplates,
    saveTemplate,
    deleteTemplate,
  } from '$lib/features/chart/chartColours';

  export interface MovingAverageConfig {
    enabled: boolean;
    period: number;
    lineWidth: number;
  }

  export interface BollingerBandsConfig {
    enabled: boolean;
    period: number;
    stdDev: number;
    lineWidth: number;
  }

  let {
    chartType = $bindable('candlestick'),
    showArea = $bindable(true),
    showVolume = $bindable(true),
    smaConfig = $bindable({ enabled: false, period: 20, lineWidth: 2 }),
    emaConfig = $bindable({ enabled: false, period: 20, lineWidth: 2 }),
    bbandsConfig = $bindable({ enabled: false, period: 20, stdDev: 2, lineWidth: 1 }),
    colours = $bindable({} as ChartColours),
    theme,
    onthemechange,
  }: {
    chartType: ChartType;
    showArea: boolean;
    showVolume: boolean;
    smaConfig: MovingAverageConfig;
    emaConfig: MovingAverageConfig;
    bbandsConfig: BollingerBandsConfig;
    colours: ChartColours;
    theme: Theme;
    onthemechange: (theme: Theme) => void;
  } = $props();

  let open = $state(false);

  function setColour(key: ChartColourKey, value: string) {
    colours = setChartColour(colours, key, value);
  }

  let templates = $state<ChartTemplate[]>([]);
  let selectedTemplateName = $state('');

  $effect(() => {
    if (open) templates = loadTemplates();
  });

  let saveDialogOpen = $state(false);

  function applyTemplate(name: string) {
    const tpl = templates.find(t => t.name === name);
    if (!tpl) return;
    colours = { ...tpl.colours };
    smaConfig = {
      ...smaConfig,
      lineWidth: tpl.smaLineWidth,
      ...(tpl.smaEnabled !== undefined && { enabled: tpl.smaEnabled }),
    };
    emaConfig = {
      ...emaConfig,
      lineWidth: tpl.emaLineWidth,
      ...(tpl.emaEnabled !== undefined && { enabled: tpl.emaEnabled }),
    };
    bbandsConfig = {
      ...bbandsConfig,
      ...(tpl.bbandsLineWidth !== undefined && {
        lineWidth: tpl.bbandsLineWidth,
      }),
      ...(tpl.bbandsEnabled !== undefined && { enabled: tpl.bbandsEnabled }),
    };
    if (tpl.chartType !== undefined) chartType = tpl.chartType;
    if (tpl.showArea !== undefined) showArea = tpl.showArea;
    if (tpl.showVolume !== undefined) showVolume = tpl.showVolume;
  }

  function openSaveDialog() {
    saveDialogOpen = true;
  }

  function confirmSave(name: string) {
    const tpl: ChartTemplate = {
      name,
      colours: { ...colours },
      smaLineWidth: smaConfig.lineWidth,
      emaLineWidth: emaConfig.lineWidth,
      bbandsLineWidth: bbandsConfig.lineWidth,
      chartType,
      showArea,
      showVolume,
      smaEnabled: smaConfig.enabled,
      emaEnabled: emaConfig.enabled,
      bbandsEnabled: bbandsConfig.enabled,
    };
    saveTemplate(tpl);
    templates = loadTemplates();
    selectedTemplateName = tpl.name;
  }

  function handleDelete() {
    if (!selectedTemplateName) return;
    deleteTemplate(selectedTemplateName);
    templates = loadTemplates();
    selectedTemplateName = '';
  }

  function intOr(e: Event, fallback: number): number {
    return parseInt((e.target as HTMLInputElement).value, 10) || fallback;
  }

  function floatOr(e: Event, fallback: number): number {
    return parseFloat((e.target as HTMLInputElement).value) || fallback;
  }

  function handleReset() {
    colours = defaultChartColours();
    chartType = 'candlestick';
    showArea = false;
    showVolume = true;
    smaConfig = { enabled: false, period: 20, lineWidth: 2 };
    emaConfig = { enabled: false, period: 20, lineWidth: 2 };
    bbandsConfig = { enabled: false, period: 20, stdDev: 2, lineWidth: 1 };
    selectedTemplateName = '';
  }

</script>

<button
  type="button"
  class="ot-workbench-ghost"
  onclick={() => (open = true)}
  title="Chart options"
>
  <Settings class="h-3 w-3" />
  <span>opt</span>
</button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>Chart Options</Dialog.Title>
    </Dialog.Header>

      <div class="flex min-w-0 flex-col gap-4">
        <fieldset>
          <legend class="text-sm font-medium text-card-foreground mb-2"
            >Theme</legend
          >
          <div class="flex gap-2">
            <button
              type="button"
              class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {theme ===
              'dark'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'}"
              onclick={() => onthemechange('dark')}
            >
              <Moon class="size-4" />
              Dark
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {theme ===
              'light'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'}"
              onclick={() => onthemechange('light')}
            >
              <Sun class="size-4" />
              White
            </button>
          </div>
        </fieldset>

        <!-- Row 1: Chart Type + Overlay -->
        <div class="flex flex-wrap items-end justify-between gap-4">
          <fieldset>
            <legend class="text-sm font-medium text-card-foreground mb-2"
              >Chart Type</legend
            >
            <div class="flex gap-2">
              <button
                type="button"
                class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {chartType ===
                'candlestick'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                onclick={() => (chartType = 'candlestick')}
              >
                <CandlestickChart class="size-4" />
                Candlestick
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {chartType ===
                'line'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                onclick={() => (chartType = 'line')}
              >
                <LineChart class="size-4" />
                Line
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend class="text-sm font-medium text-card-foreground mb-2"
              >Overlay</legend
            >
            <div class="flex gap-2">
              <button
                type="button"
                class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {showArea
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                onclick={() => (showArea = !showArea)}
              >
                <AreaChart class="size-4" />
                Area
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {showVolume
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                onclick={() => (showVolume = !showVolume)}
              >
                <BarChart3 class="size-4" />
                Volume
              </button>
            </div>
          </fieldset>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm font-medium text-card-foreground min-w-[50px]">Background:</span>
          <ColourSwatch bind:colour={() => colours.chartBackground, value => setColour('chartBackground', value)} label="Chart" />
          <ColourSwatch bind:colour={() => colours.gridLines, value => setColour('gridLines', value)} label="Grid" />
          <ColourSwatch bind:colour={() => colours.textColour, value => setColour('textColour', value)} label="Text" />
        </div>

        {#if chartType === 'candlestick'}
          <div class="flex items-center gap-3 flex-wrap">
            <span class="text-sm font-medium text-card-foreground min-w-[50px]">Chart:</span>
            <ColourSwatch bind:colour={() => colours.candleUpBody, value => setColour('candleUpBody', value)} label="Up body" />
            <ColourSwatch bind:colour={() => colours.candleDownBody, value => setColour('candleDownBody', value)} label="Down body" />
            <ColourSwatch bind:colour={() => colours.candleUpWick, value => setColour('candleUpWick', value)} label="Up wick" />
            <ColourSwatch bind:colour={() => colours.candleDownWick, value => setColour('candleDownWick', value)} label="Down wick" />
            <ColourSwatch bind:colour={() => colours.candleUpBorder, value => setColour('candleUpBorder', value)} label="Up border" />
            <ColourSwatch bind:colour={() => colours.candleDownBorder, value => setColour('candleDownBorder', value)} label="Down border" />
          </div>
        {/if}

        {#if chartType === 'line'}
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm font-medium text-card-foreground min-w-[50px]">Chart:</span>
            <ColourSwatch bind:colour={() => colours.lineColour, value => setColour('lineColour', value)} label="Line" />
          </div>
        {/if}

        {#if showArea}
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm font-medium text-card-foreground min-w-[50px]">Area:</span>
            <ColourSwatch bind:colour={() => colours.areaTop, value => setColour('areaTop', value)} label="Area top" />
            <ColourSwatch bind:colour={() => colours.areaBottom, value => setColour('areaBottom', value)} label="Area bottom" />
          </div>
        {/if}

        {#if showVolume}
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm font-medium text-card-foreground min-w-[50px]">Volume:</span>
            <ColourSwatch bind:colour={() => colours.volumeUp, value => setColour('volumeUp', value)} label="Up volume" />
            <ColourSwatch bind:colour={() => colours.volumeDown, value => setColour('volumeDown', value)} label="Down volume" />
          </div>
        {/if}

        <!-- Row 2: Moving Averages -->
        <fieldset>
          <legend class="text-sm font-medium text-card-foreground mb-2"
            >Moving Averages</legend
          >
          <div
            class="rounded-md bg-muted/50 border border-border p-3 flex flex-col gap-3"
          >
            <!-- SMA -->
            <div>
              <div class="text-xs font-medium text-muted-foreground mb-1.5">
                Simple Moving Average
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {smaConfig.enabled
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'}"
                  onclick={() =>
                    (smaConfig = {
                      ...smaConfig,
                      enabled: !smaConfig.enabled,
                    })}
                >
                  <TrendingUp class="size-4" />
                  SMA
                </button>
                {#if smaConfig.enabled}
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Width
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={smaConfig.lineWidth}
                      oninput={e =>
                        (smaConfig = {
                          ...smaConfig,
                          lineWidth: intOr(e, 2),
                        })}
                      class="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Period
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={smaConfig.period}
                      oninput={e =>
                        (smaConfig = {
                          ...smaConfig,
                          period: intOr(e, 20),
                        })}
                      class="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <ColourSwatch bind:colour={() => colours.smaLine, value => setColour('smaLine', value)} label="Line" />
                {/if}
              </div>
            </div>

            <!-- Bollinger Bands -->
            <div>
              <div class="text-xs font-medium text-muted-foreground mb-1.5">
                Bollinger Bands
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {bbandsConfig.enabled
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'}"
                  onclick={() =>
                    (bbandsConfig = {
                      ...bbandsConfig,
                      enabled: !bbandsConfig.enabled,
                    })}
                >
                  <TrendingUp class="size-4" />
                  BB
                </button>
                {#if bbandsConfig.enabled}
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Width
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={bbandsConfig.lineWidth}
                      oninput={e =>
                        (bbandsConfig = {
                          ...bbandsConfig,
                          lineWidth: intOr(e, 1),
                        })}
                      class="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Period
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={bbandsConfig.period}
                      oninput={e =>
                        (bbandsConfig = {
                          ...bbandsConfig,
                          period: intOr(e, 20),
                        })}
                      class="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Std
                    <input
                      type="number"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={bbandsConfig.stdDev}
                      oninput={e =>
                        (bbandsConfig = {
                          ...bbandsConfig,
                          stdDev: floatOr(e, 2),
                        })}
                      class="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <ColourSwatch bind:colour={() => colours.bbandsUpper, value => setColour('bbandsUpper', value)} label="Upper" />
                  <ColourSwatch bind:colour={() => colours.bbandsMiddle, value => setColour('bbandsMiddle', value)} label="Mid" />
                  <ColourSwatch bind:colour={() => colours.bbandsLower, value => setColour('bbandsLower', value)} label="Lower" />
                {/if}
              </div>
            </div>

            <!-- EMA -->
            <div>
              <div class="text-xs font-medium text-muted-foreground mb-1.5">
                Exponential Moving Average
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors {emaConfig.enabled
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'}"
                  onclick={() =>
                    (emaConfig = {
                      ...emaConfig,
                      enabled: !emaConfig.enabled,
                    })}
                >
                  <TrendingUp class="size-4" />
                  EMA
                </button>
                {#if emaConfig.enabled}
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Width
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={emaConfig.lineWidth}
                      oninput={e =>
                        (emaConfig = {
                          ...emaConfig,
                          lineWidth: intOr(e, 2),
                        })}
                      class="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <label
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    Period
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={emaConfig.period}
                      oninput={e =>
                        (emaConfig = {
                          ...emaConfig,
                          period: intOr(e, 20),
                        })}
                      class="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
                    />
                  </label>
                  <ColourSwatch bind:colour={() => colours.emaLine, value => setColour('emaLine', value)} label="Line" />
                {/if}
              </div>
            </div>
          </div>
        </fieldset>

        <!-- Templates -->
        <fieldset>
          <legend class="text-sm font-medium text-card-foreground mb-2"
            >Templates</legend
          >
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              <Select.Root
                type="single"
                bind:value={selectedTemplateName}
                onValueChange={(name) => {
                  if (name) applyTemplate(name);
                }}
              >
                <Select.Trigger class="min-w-[160px]">
                  {selectedTemplateName || 'Select template'}
                </Select.Trigger>
                <Select.Content>
                  {#each templates as tpl (tpl.name)}
                    <Select.Item value={tpl.name}>{tpl.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <Button variant="outline" size="sm" onclick={openSaveDialog}>
                Save
              </Button>
              {#if selectedTemplateName}
                <Button variant="outline" size="sm" class="text-red-400 hover:text-red-300 border-red-400/50 hover:border-red-400" onclick={handleDelete}>
                  Delete
                </Button>
              {/if}
            </div>
            <Button variant="outline" size="sm" onclick={handleReset}>
              Reset to Default
            </Button>
          </div>
        </fieldset>
      </div>
  </Dialog.Content>
</Dialog.Root>

<TextPromptDialog
  open={saveDialogOpen}
  onopenchange={v => (saveDialogOpen = v)}
  title="Save Template"
  description="Enter a name for your chart template."
  placeholder="Template name"
  initialValue={selectedTemplateName}
  onsubmit={confirmSave}
/>
