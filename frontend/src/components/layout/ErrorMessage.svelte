<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';

  let {
    message = $bindable<string | null>(null),
    context = '',
    loadedContext = '',
    onretry,
  }: {
    message: string | null;
    context?: string;
    loadedContext?: string;
    onretry?: () => void;
  } = $props();
</script>

<Dialog.Root
  open={message !== null}
  onOpenChange={v => {
    if (!v) message = null;
  }}
>
  <Dialog.Content class="sm:max-w-md" showCloseButton={false}>
    <Dialog.Header>
      <div class="flex items-center justify-between gap-3">
        <Dialog.Title class="min-w-0 shrink text-lg font-semibold leading-none">
          Market data unavailable
        </Dialog.Title>
        <Button
          variant="outline"
          class="shrink-0"
          onclick={() => (message = null)}
        >
          Close
        </Button>
      </div>
      <Dialog.Description>{context ? `Request: ${context}.` : 'The market data request did not finish.'} Retry, or close this message and change the symbol, source or range.</Dialog.Description>
    </Dialog.Header>

    <div
      class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex gap-2 items-center"
    >
      <CircleAlert class="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <p class="leading-relaxed break-words min-w-0">{message}</p>
    </div>
    {#if loadedContext}<p class="text-sm text-muted-foreground">The chart still shows the last loaded data: {loadedContext}. It is not the failed request's result.</p>{/if}
    {#if onretry}<Button onclick={() => { message = null; onretry?.(); }}>Retry current request</Button>{/if}
  </Dialog.Content>
</Dialog.Root>
