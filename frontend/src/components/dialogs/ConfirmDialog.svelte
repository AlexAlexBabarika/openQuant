<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { confirmState } from '$lib/features/confirm/confirm.svelte';

  const request = $derived(confirmState.request);
</script>

<Dialog.Root
  open={request !== null}
  onOpenChange={open => {
    if (!open) confirmState.settle(false);
  }}
>
  <Dialog.Content class="sm:max-w-md">
    {#if request}
      <Dialog.Header>
        <Dialog.Title>{request.title}</Dialog.Title>
        {#if request.description}
          <Dialog.Description>{request.description}</Dialog.Description>
        {/if}
      </Dialog.Header>
      <Dialog.Footer class="mt-4">
        {#if request.acknowledge}
          <Button type="button" onclick={() => confirmState.settle(true)}>
            {request.confirmLabel ?? 'Close'}
          </Button>
        {:else}
          <Button
            variant="outline"
            type="button"
            onclick={() => confirmState.settle(false)}
          >
            Cancel
          </Button>
          <Button
            variant={request.destructive ? 'destructive' : 'default'}
            type="button"
            onclick={() => confirmState.settle(true)}
          >
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        {/if}
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
