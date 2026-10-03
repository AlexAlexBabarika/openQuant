import { apiJson, getSessionGeneration } from '$lib/core/api';
import type { TickerGroup, FlaggedPriority, FlaggedStance } from './tickers';
import {
  isDefaultTickerWorkspaceState,
  normalizeGroupsList,
  resolveSelectedGroupName,
} from './tickers';

export type TickerWorkspacePayload = {
  groups: TickerGroup[];
  selectedGroup: string;
  selectedPriority: FlaggedPriority | null;
  selectedStance: FlaggedStance | null;
};

export type TickerWorkspaceApiResponse = {
  workspace: TickerWorkspacePayload;
  from_database: boolean;
  updated_at: string | null;
};

export async function fetchTickerWorkspace(): Promise<TickerWorkspaceApiResponse> {
  return apiJson<TickerWorkspaceApiResponse>(
    '/user/ticker-workspace',
    { method: 'GET' },
    true,
  );
}

export async function putTickerWorkspace(
  workspace: TickerWorkspacePayload,
): Promise<TickerWorkspaceApiResponse> {
  return apiJson<TickerWorkspaceApiResponse>(
    '/user/ticker-workspace',
    {
      method: 'PUT',
      body: JSON.stringify(workspace),
    },
    true,
  );
}

export function buildTickerWorkspacePayload(
  groups: TickerGroup[],
  selectedGroupName: string,
  selectedPriority: FlaggedPriority | null,
  selectedStance: FlaggedStance | null,
): TickerWorkspacePayload {
  return {
    groups,
    selectedGroup: selectedGroupName,
    selectedPriority,
    selectedStance,
  };
}

export interface TickerWorkspaceState {
  groups: TickerGroup[];
  selectedGroupName: string;
  selectedPriority: FlaggedPriority | null;
  selectedStance: FlaggedStance | null;
}

export function workspacePayloadToAppState(
  w: TickerWorkspacePayload,
): TickerWorkspaceState {
  const groups = normalizeGroupsList(w.groups);
  return {
    groups,
    selectedGroupName: resolveSelectedGroupName(groups, w.selectedGroup),
    selectedPriority: w.selectedPriority,
    selectedStance: w.selectedStance,
  };
}

// Hydrate the workspace for a freshly-signed-in user. Returns the remote state
// to apply, or `null` when the local state was pushed up because the server had
// nothing yet.
export async function syncWorkspaceOnSignIn(
  current: TickerWorkspaceState,
  isCurrent: () => boolean = () => true,
  save: (
    workspace: TickerWorkspacePayload,
  ) => Promise<unknown> = putTickerWorkspace,
): Promise<TickerWorkspaceState | null> {
  const res = await fetchTickerWorkspace();
  if (!isCurrent()) return null;
  if (res.from_database) {
    return workspacePayloadToAppState(res.workspace);
  }
  if (
    !isDefaultTickerWorkspaceState(
      current.groups,
      current.selectedGroupName,
      current.selectedPriority,
      current.selectedStance,
    )
  ) {
    await save(
      buildTickerWorkspacePayload(
        current.groups,
        current.selectedGroupName,
        current.selectedPriority,
        current.selectedStance,
      ),
    );
  }
  return null;
}

function statePayload(state: TickerWorkspaceState): TickerWorkspacePayload {
  return buildTickerWorkspacePayload(
    state.groups,
    state.selectedGroupName,
    state.selectedPriority,
    state.selectedStance,
  );
}

export class TickerWorkspaceSync {
  private userId: string | null = null;
  private generation = 0;
  private sessionGeneration = getSessionGeneration();
  private ready = false;
  private acknowledgedJson: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private pendingWrites = 0;

  constructor(
    private readonly options: {
      userId: () => string | null;
      read: () => TickerWorkspaceState;
      apply: (state: TickerWorkspaceState) => void;
      onHydrated: () => void;
      onError: (error: unknown) => void;
    },
  ) {}

  setUser(userId: string | null): void {
    const sessionGeneration = getSessionGeneration();
    if (userId === this.userId && sessionGeneration === this.sessionGeneration)
      return;
    this.cancelTimer();
    this.userId = userId;
    this.sessionGeneration = sessionGeneration;
    this.generation++;
    this.ready = false;
    this.acknowledgedJson = null;
    if (userId) void this.hydrate(this.generation);
  }

  private isCurrent(generation: number): boolean {
    return (
      generation === this.generation &&
      this.userId !== null &&
      this.options.userId() === this.userId &&
      getSessionGeneration() === this.sessionGeneration
    );
  }

  private async hydrate(generation: number): Promise<void> {
    const current = this.options.read();
    const initialJson = JSON.stringify(statePayload(current));
    try {
      await this.writes;
      if (!this.isCurrent(generation)) return;
      const next = await syncWorkspaceOnSignIn(
        JSON.parse(JSON.stringify(current)) as TickerWorkspaceState,
        () => this.isCurrent(generation),
        payload => this.write(JSON.stringify(payload), generation),
      );
      if (!this.isCurrent(generation)) return;
      const unchanged =
        JSON.stringify(statePayload(this.options.read())) === initialJson;
      if (unchanged && next) this.options.apply(next);
      if (unchanged)
        this.acknowledgedJson = JSON.stringify(
          statePayload(this.options.read()),
        );
      this.ready = true;
      this.options.onHydrated();
      this.save(statePayload(this.options.read()));
    } catch (error) {
      if (this.isCurrent(generation)) this.options.onError(error);
    }
  }

  save(payload: TickerWorkspacePayload): void {
    this.cancelTimer();
    if (!this.ready || !this.isCurrent(this.generation)) return;
    const json = JSON.stringify(payload);
    if (json === this.acknowledgedJson && this.pendingWrites === 0) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write(json, generation).catch(error => {
        if (this.isCurrent(generation)) this.options.onError(error);
      });
    }, 500);
  }

  private write(json: string, generation: number): Promise<void> {
    this.pendingWrites++;
    const result = this.writes
      .then(async () => {
        if (!this.isCurrent(generation) || json === this.acknowledgedJson)
          return;
        await putTickerWorkspace(JSON.parse(json) as TickerWorkspacePayload);
        if (this.isCurrent(generation)) this.acknowledgedJson = json;
      })
      .finally(() => {
        this.pendingWrites--;
      });
    this.writes = result.catch(() => {});
    return result;
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  destroy(): void {
    this.cancelTimer();
    this.generation++;
  }
}
