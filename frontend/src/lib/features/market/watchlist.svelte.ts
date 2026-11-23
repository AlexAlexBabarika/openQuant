import type { SymbolProviders } from './symbols';
import {
  addGroup,
  addTickerToGroup,
  clearGroup,
  collectTickersByPriority,
  collectTickersByStance,
  deleteGroup,
  duplicateGroup,
  findPriorityConflict,
  findStanceConflict,
  findTickerProviders,
  loadGroupsFromStorage,
  loadSelectedGroupName,
  loadSelectedPriority,
  loadSelectedStance,
  persistGroups,
  persistSelectedGroupName,
  persistSelectedPriority,
  persistSelectedStance,
  priorityCounts,
  removeTickerEverywhere,
  removeTickerFromGroup,
  renameGroup,
  setPriorityEverywhere,
  setStanceEverywhere,
  setTickerPriority,
  setTickerProvidersEverywhere,
  setTickerStance,
  stanceCounts,
  type FlaggedPriority,
  type FlaggedStance,
  type PriorityConflict,
  type StanceConflict,
  type TickerGroup,
  type TickerPriority,
  type TickerStance,
} from './tickers';

export interface WatchlistState {
  groups: TickerGroup[];
  selectedGroupName: string;
  selectedPriority: FlaggedPriority | null;
  selectedStance: FlaggedStance | null;
}

/** A flag change that disagrees with the same symbol's flag in other groups. */
export type FlagConflict =
  | {
      kind: 'priority';
      symbol: string;
      desired: TickerPriority;
      conflict: PriorityConflict;
    }
  | {
      kind: 'stance';
      symbol: string;
      desired: TickerStance;
      conflict: StanceConflict;
    };

function storedState(): WatchlistState {
  const groups = loadGroupsFromStorage();
  return {
    groups,
    selectedGroupName: loadSelectedGroupName(groups),
    selectedPriority: loadSelectedPriority(),
    selectedStance: loadSelectedStance(),
  };
}

/**
 * The watchlist: ticker groups plus what is on show. Exactly one view is active:
 * a group, or every ticker carrying one priority or one stance across groups.
 */
export class Watchlist {
  groups = $state<TickerGroup[]>([]);
  selectedGroupName = $state('');
  selectedPriority = $state<FlaggedPriority | null>(null);
  selectedStance = $state<FlaggedStance | null>(null);

  constructor(initial: WatchlistState = storedState()) {
    this.apply(initial);
  }

  groupNames = $derived(this.groups.map(g => g.name));
  /** Symbols in the selected group, whatever view is showing. */
  groupSymbols = $derived(
    (
      this.groups.find(g => g.name === this.selectedGroupName)?.tickers ?? []
    ).map(t => t.symbol),
  );
  /** The tickers the active view shows. */
  tickers = $derived(
    this.selectedStance
      ? collectTickersByStance(this.groups, this.selectedStance)
      : this.selectedPriority
        ? collectTickersByPriority(this.groups, this.selectedPriority)
        : (this.groups.find(g => g.name === this.selectedGroupName)?.tickers ??
          []),
  );
  priorityCounts = $derived(priorityCounts(this.groups));
  stanceCounts = $derived(stanceCounts(this.groups));

  snapshot(): WatchlistState {
    return {
      groups: this.groups,
      selectedGroupName: this.selectedGroupName,
      selectedPriority: this.selectedPriority,
      selectedStance: this.selectedStance,
    };
  }
  apply(next: WatchlistState): void {
    this.groups = next.groups;
    this.selectedGroupName = next.selectedGroupName;
    this.selectedPriority = next.selectedPriority;
    this.selectedStance = next.selectedStance;
  }
  /** Signed-out watchlists live in this browser. */
  loadLocal(): void {
    this.apply(storedState());
  }
  saveLocal(): void {
    persistGroups(this.groups);
    persistSelectedGroupName(this.selectedGroupName);
    persistSelectedPriority(this.selectedPriority);
    persistSelectedStance(this.selectedStance);
  }

  selectGroup(name: string): void {
    this.selectedGroupName = name;
    this.selectedPriority = null;
    this.selectedStance = null;
  }
  selectPriority(priority: FlaggedPriority): void {
    this.selectedPriority = priority;
    this.selectedStance = null;
  }
  selectStance(stance: FlaggedStance): void {
    this.selectedStance = stance;
    this.selectedPriority = null;
  }

  addGroup(name: string): void {
    this.groups = addGroup(this.groups, name);
    this.selectGroup(name);
  }
  renameGroup(name: string): void {
    this.groups = renameGroup(this.groups, this.selectedGroupName, name);
    this.selectedGroupName = name;
  }
  duplicateGroup(): void {
    const result = duplicateGroup(this.groups, this.selectedGroupName);
    if (!result) return;
    this.groups = result.groups;
    this.selectedGroupName = result.newName;
  }
  /** The last group cannot be deleted. */
  deleteGroup(): void {
    const next = deleteGroup(this.groups, this.selectedGroupName);
    if (!next) return;
    this.groups = next;
    this.selectedGroupName = next[0].name;
  }
  clearGroup(): void {
    this.groups = clearGroup(this.groups, this.selectedGroupName);
  }

  addTicker(symbol: string, providers: SymbolProviders | null): void {
    this.groups = addTickerToGroup(
      this.groups,
      this.selectedGroupName,
      symbol,
      providers,
    );
  }
  /** From a flag view the ticker leaves every group; from a group, only that one. */
  deleteTicker(symbol: string): void {
    this.groups =
      this.selectedPriority || this.selectedStance
        ? removeTickerEverywhere(this.groups, symbol)
        : removeTickerFromGroup(this.groups, this.selectedGroupName, symbol);
  }

  /**
   * In a flag view the change applies everywhere. In a group it applies there
   * unless the symbol carries a different flag elsewhere; then nothing changes
   * and the conflict is returned for the user to resolve.
   */
  setPriority(symbol: string, priority: TickerPriority): FlagConflict | null {
    if (this.selectedPriority) {
      this.groups = setPriorityEverywhere(this.groups, symbol, priority);
      return null;
    }
    const conflict = findPriorityConflict(
      this.groups,
      symbol,
      priority,
      this.selectedGroupName,
    );
    if (conflict)
      return { kind: 'priority', symbol, desired: priority, conflict };
    this.groups = setTickerPriority(
      this.groups,
      this.selectedGroupName,
      symbol,
      priority,
    );
    return null;
  }
  setStance(symbol: string, stance: TickerStance): FlagConflict | null {
    if (this.selectedStance) {
      this.groups = setStanceEverywhere(this.groups, symbol, stance);
      return null;
    }
    const conflict = findStanceConflict(
      this.groups,
      symbol,
      stance,
      this.selectedGroupName,
    );
    if (conflict) return { kind: 'stance', symbol, desired: stance, conflict };
    this.groups = setTickerStance(
      this.groups,
      this.selectedGroupName,
      symbol,
      stance,
    );
    return null;
  }
  /** Resolve a conflict by giving this group the flag the other groups already use. */
  adoptExistingFlag(conflict: FlagConflict): void {
    this.groups =
      conflict.kind === 'priority'
        ? setTickerPriority(
            this.groups,
            this.selectedGroupName,
            conflict.symbol,
            conflict.conflict.existingPriority,
          )
        : setTickerStance(
            this.groups,
            this.selectedGroupName,
            conflict.symbol,
            conflict.conflict.existingStance,
          );
  }

  providersFor(symbol: string): SymbolProviders | null {
    return findTickerProviders(this.groups, symbol);
  }
  setProviders(symbol: string, providers: SymbolProviders): void {
    this.groups = setTickerProvidersEverywhere(this.groups, symbol, providers);
  }
}
