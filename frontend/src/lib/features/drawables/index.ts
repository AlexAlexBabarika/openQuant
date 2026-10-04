// frontend/src/lib/drawables/index.ts
import { registerTool, getRegisteredBundledTool, listTools } from './registry';
import { BUNDLED_TOOLS } from './toolCatalog';
import { loadToolDefaults } from './toolDefaults';
import { isPositionToolType } from './tools/position/constants';
import type { DrawableTool } from './types';

export * from './types';
export type { BundledTool, BundledToolType } from './toolCatalog';
export { BUNDLED_TOOLS, BUNDLED_TOOLS_BY_TYPE } from './toolCatalog';
export { deepCloneDrawableSnapshot } from './clone';
export type { BundledDrawable } from './bundledDrawable';
export { drawables, createDrawablesStore } from './store.svelte';
export {
  loadAll,
  saveAll,
  DRAWABLES_STORAGE_KEY,
  drawablesStorageKey,
} from './persistence';
export {
  registerTool,
  getTool,
  getRegisteredBundledTool,
  listTools,
} from './registry';

/** Draw tools shown as individual icons (excludes grouped position long/short). */
export function listToolbarDrawableTools(): DrawableTool[] {
  return listTools().filter(t => !isPositionToolType(t.type));
}

export { POSITION_TOOLBAR_MODES } from './tools/position/tool';
export {
  isPositionToolType,
  POSITION_TOOL_TYPES,
} from './tools/position/constants';
export { DEFAULT_POPUP_ACTIONS, resolvePopupActions } from './popupActions';
export {
  loadToolDefaults,
  saveToolDefaults,
  TOOL_DEFAULTS_STORAGE_KEY,
} from './toolDefaults';
export type { ActiveTool } from './activeTool';
export { CURSOR } from './activeTool';
export {
  buildCoordMap,
  chartTimeAtCoordinate,
  candleUnixSeconds,
} from './coordMap';
export type { DrawableSurface } from './drawableSurface';
export type { DrawableToolbarCommands } from './toolbarCommands';
export { toolbarCommandsFromStore } from './toolbarCommands';

let registered = false;

function applyPersistedToolDefaults(): void {
  for (const bundled of BUNDLED_TOOLS) {
    const stored = loadToolDefaults(bundled.type);
    const tool = getRegisteredBundledTool(bundled.type);
    if (stored && tool) {
      if (isPositionToolType(tool.type)) {
        tool.defaults.params = {} as typeof tool.defaults.params;
      } else {
        tool.defaults.params = stored.params as typeof tool.defaults.params;
      }
      tool.defaults.style = stored.style as typeof tool.defaults.style;
    }
  }
}

/** Registers bundled tools once; runs at load so early importers see `listTools()`. Exported for tests. */
export function ensureToolsRegistered(): void {
  if (registered) return;
  for (const tool of BUNDLED_TOOLS) {
    registerTool(tool);
  }
  applyPersistedToolDefaults();
  registered = true;
}

ensureToolsRegistered();
