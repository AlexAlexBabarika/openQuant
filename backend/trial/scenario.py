"""Constructed OHLCV, not market history or independent evidence of alpha.

The training regime has persistent alternating trends. The chronological test
regime has faster reversals and a negative drift. Seeded bounded noise, gaps,
ranges and volume make a reproducible teaching example, not a market model.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

import polars as pl

DATASET_ID = "synthetic-regime-shift"
DATASET_VERSION = "1"
DATASET_LABEL = "Synthetic educational OHLCV — trends meet reversals"
TRAINING_BARS = 240
HOLDOUT_BARS = 120
SEED = 1729
MAX_OPEN_GAP = 0.004


def scenario_frame() -> pl.DataFrame:
    rng = random.Random(SEED)
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    timestamps: list[datetime] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[float] = []
    previous_close = 100.0
    for i in range(TRAINING_BARS + HOLDOUT_BARS):
        opening = previous_close * (1 + rng.uniform(-MAX_OPEN_GAP, MAX_OPEN_GAP))
        if i < TRAINING_BARS:
            drift = 0.003 if (i // 30) % 2 == 0 else -0.002
        else:
            drift = -0.001 + 0.012 * math.sin((i - TRAINING_BARS) * math.pi / 3)
        close = opening * (1 + drift + rng.uniform(-0.006, 0.006))
        timestamps.append(start + timedelta(days=i))
        opens.append(opening)
        highs.append(max(opening, close) * (1 + rng.uniform(0.001, 0.009)))
        lows.append(min(opening, close) * (1 - rng.uniform(0.001, 0.009)))
        closes.append(close)
        volumes.append(float(rng.randrange(500_000, 1_500_001)))
        previous_close = close
    return pl.DataFrame(
        {
            "timestamp": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }
    )
