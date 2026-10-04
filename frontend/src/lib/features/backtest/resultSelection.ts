import type { BacktestResult } from './types';
import type { DrawdownEpisode } from './derive';

export type ResultSelection = {
  kind: 'trade' | 'drawdown';
  index: number;
  label: string;
  from: number;
  to: number;
};

function paddedRange(first: number, last: number, count: number) {
  if (!count || first < 0 || last < first || last >= count) return null;
  const padding = Math.max(2, Math.ceil((last - first + 1) * 0.15));
  const from = Math.max(0, first - padding);
  return { from, to: Math.max(from + 1, Math.min(count - 1, last + padding)) };
}

export function tradeSelection(
  result: BacktestResult,
  index: number,
): ResultSelection | null {
  const trade = result.trades[index];
  if (
    !trade ||
    !Number.isInteger(trade.entry_index) ||
    !Number.isInteger(trade.exit_index)
  )
    return null;
  const range = paddedRange(
    trade.entry_index,
    trade.exit_index,
    result.bars.length,
  );
  return range
    ? {
        kind: 'trade',
        index,
        label: `Trade #${index + 1} · entry ${trade.entry_time} · exit ${trade.exit_time}`,
        ...range,
      }
    : null;
}

export function drawdownSelection(
  result: BacktestResult,
  episode: DrawdownEpisode,
  index: number,
): ResultSelection | null {
  const end = episode.recovery ?? result.equity[result.equity.length - 1]?.t;
  if (end === undefined || end < episode.start) return null;
  const first = result.bars.findIndex(b => b.t >= episode.start);
  let last = -1;
  for (let i = result.bars.length - 1; i >= 0; i--)
    if (result.bars[i].t <= end) {
      last = i;
      break;
    }
  const range = paddedRange(first, last, result.bars.length);
  return range
    ? {
        kind: 'drawdown',
        index,
        label: `Drawdown #${index + 1} · ${new Date(episode.start * 1000).toISOString()} → ${episode.recovery === null ? 'ongoing' : new Date(end * 1000).toISOString()}`,
        ...range,
      }
    : null;
}
