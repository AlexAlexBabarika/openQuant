<script lang="ts">
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import type { PopupAction, ScreenPoint } from '$lib/features/drawables';

  type PopupActionId = PopupAction['id'];

  let {
    anchor,
    actions,
    onAction,
  }: {
    anchor: ScreenPoint;
    actions: PopupAction[];
    onAction: (id: PopupAction['id'], action: PopupAction) => void;
  } = $props();

  const ICONS: Record<PopupActionId, typeof Trash2> = {
    delete: Trash2,
    custom: MoreHorizontal,
  };

  // Place the popup 8px below and a few px left of the anchor corner.
  const OFFSET_X = -8;
  const OFFSET_Y = 8;
</script>

<div
  class="absolute z-20 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-1 shadow-lg"
  style:left="{anchor.x + OFFSET_X}px"
  style:top="{anchor.y + OFFSET_Y}px"
  role="toolbar"
  aria-label="Drawable actions"
  tabindex="-1"
  onpointerdown={(e) => e.stopPropagation()}
>
  {#each actions as action (action.id)}
    {@const Icon = ICONS[action.id]}
    <button
      type="button"
      class="flex items-center justify-center w-7 h-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
      aria-label={action.label}
      title={action.label}
      onclick={(e) => { e.stopPropagation(); onAction(action.id, action); }}
    >
      <Icon class="h-4 w-4" />
    </button>
  {/each}
</div>
