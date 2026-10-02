# Third-party notices

OpenQuant is distributed under the Apache License 2.0 (see `LICENSE`). It also
bundles and depends on third-party software and assets that remain under their
own licenses. This file records those components, their license identifiers, and
the obligations that attach when you redistribute OpenQuant — including as a
Docker image.

Nothing listed here restricts private use, self-hosting, or modification. The
obligations below apply when you **distribute** OpenQuant or a derivative.

## Obligations at a glance

| # | Component | Obligation when redistributing |
| --- | --- | --- |
| 1 | Lato, Space Mono (SIL OFL 1.1) | Ship the font files together with their license text. Do not sell the fonts on their own, and do not reuse the reserved font names for modified versions. |
| 2 | TradingView Lightweight Charts (Apache-2.0) | Keep the on-chart attribution logo enabled. Retain the copyright notice. |
| 3 | `psycopg` / `psycopg-binary` (LGPL-3.0-only) | Keep the library replaceable and pass on its license text and source offer. |
| 4 | `certifi` (MPL-2.0) | Redistribute the covered files unmodified, or publish your modifications to those files. |
| 5 | Everything else (MIT / BSD / Apache-2.0 / ISC / PSF / MPL) | Retain copyright and license notices. |

## 1. Bundled fonts

These font files are redistributed inside the application bundle and the Docker
image. Both are licensed under the SIL Open Font License, Version 1.1, which
requires the license text to travel with the font files. The full license text is
bundled next to the fonts and is served as part of the frontend build.

**Lato** — `frontend/public/fonts/Lato-{Regular,Bold}.{woff2,ttf}`

```
Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (http://www.typoland.com/)
with Reserved Font Name "Lato".
```

License text: `frontend/public/fonts/LICENSE-Lato.txt`

**Space Mono** — `frontend/public/fonts/SpaceMono-{Regular,Bold}.woff2`

```
Copyright 2016 The Space Mono Project Authors
(https://github.com/googlefonts/spacemono)
```

License text: `frontend/public/fonts/LICENSE-SpaceMono.txt`

Because "Lato" and "Space Mono" are Reserved Font Names under the OFL, a modified
version of either font must be released under a different name.

## 2. TradingView Lightweight Charts

The price chart is rendered by `lightweight-charts` (Apache-2.0), developed by
TradingView, Inc.

```
TradingView Lightweight Charts™
Copyright (c) 2025 TradingView, Inc.
https://www.tradingview.com/
```

The library's license requires that you reproduce the attribution notice from its
NOTICE file and place a link to <https://www.tradingview.com/> on a page of your
application that is visible to users. Upstream states that displaying the
library's built-in attribution logo is sufficient to satisfy that requirement.

OpenQuant satisfies it twice over: the notice above is reproduced in this file
and in `NOTICE`, and `layout.attributionLogo` is left at its default value of
`true` — it is not set anywhere in
`frontend/src/lib/features/chart/chart.ts` or in any other chart setup. If you
ever set that option to `false`, you must keep a visible TradingView link
elsewhere in the UI to remain compliant.

"TradingView" and "Lightweight Charts" are trademarks of TradingView, Inc.
OpenQuant is not affiliated with, endorsed by, or sponsored by TradingView.

## 3. Weak-copyleft components

Two runtime dependencies are copyleft. Neither imposes its license on OpenQuant's
own source code, but both carry redistribution conditions.

### `psycopg` and `psycopg-binary` 3.3.3 — LGPL-3.0-only

The PostgreSQL driver is licensed under the GNU Lesser General Public License
v3.0. OpenQuant satisfies the LGPL by using it as a separate, unmodified,
dynamically imported library:

- OpenQuant does not modify psycopg and does not statically link it;
- it is installed as an independent package from PyPI, pinned in
  `backend/requirements.txt`, so a recipient can replace it with their own build
  of psycopg 3.x without rebuilding OpenQuant; and
- its license text and source are available from the upstream project at
  <https://github.com/psycopg/psycopg>.

If you redistribute the OpenQuant image, you must pass on the psycopg license
text and either the driver's source or a written offer to supply it, and you must
not restrict recipients from replacing the library.

### `certifi` — MPL-2.0

The CA certificate bundle is licensed under the Mozilla Public License 2.0, which
is file-level copyleft. OpenQuant redistributes it unmodified, so no source
disclosure is triggered. If you modify the certifi files themselves, you must
publish those modifications under the MPL-2.0. Source:
<https://github.com/certifi/python-certifi>.

## 4. Backend runtime dependencies

Resolved from `backend/requirements.txt`. This is the full pinned runtime set
installed into the Docker image, direct and transitive.

| Package | Version | License |
| --- | --- | --- |
| `aiohappyeyeballs` | 2.7.1 | PSF-2.0 |
| `aiohttp` | 3.14.3 | Apache-2.0 AND MIT |
| `aiosignal` | 1.4.0 | Apache-2.0 |
| `annotated-doc` | 0.0.5 | MIT |
| `annotated-types` | 0.8.0 | MIT |
| `anyio` | 4.14.2 | MIT |
| `argon2-cffi` | 25.1.0 | MIT |
| `argon2-cffi-bindings` | 25.1.0 | MIT |
| `attrs` | 26.1.0 | MIT |
| `beautifulsoup4` | 4.15.0 | MIT |
| `certifi` | 2026.7.22 | MPL-2.0 |
| `cffi` | 2.1.0 | MIT-0 |
| `charset-normalizer` | 3.4.9 | MIT |
| `click` | 8.4.2 | BSD-3-Clause |
| `cryptography` | 48.0.1 | Apache-2.0 OR BSD-3-Clause |
| `curl-cffi` | 0.16.0 | MIT |
| `dateparser` | 1.4.1 | BSD-3-Clause |
| `dnspython` | 2.8.0 | ISC |
| `email-validator` | 2.3.0 | Unlicense |
| `fastapi` | 0.141.1 | MIT |
| `frozenlist` | 1.8.0 | Apache-2.0 |
| `h11` | 0.16.0 | MIT |
| `httptools` | 0.8.0 | MIT |
| `idna` | 3.18 | BSD-3-Clause |
| `multidict` | 6.7.1 | Apache-2.0 |
| `multitasking` | 0.0.13 | Apache-2.0 |
| `numpy` | 2.4.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| `pandas` | 3.0.5 | BSD-3-Clause |
| `peewee` | 4.3.0 | MIT |
| `platformdirs` | 4.11.0 | MIT |
| `polars` | 1.38.1 | MIT |
| `polars-runtime-32` | 1.38.1 | MIT |
| `propcache` | 0.5.2 | Apache-2.0 |
| `protobuf` | 7.35.1 | BSD-3-Clause |
| `psycopg` | 3.3.3 | LGPL-3.0-only |
| `psycopg-binary` | 3.3.3 | LGPL-3.0-only |
| `pycparser` | 3.0 | BSD-3-Clause |
| `pycryptodome` | 3.23.0 | BSD-2-Clause AND Public-Domain |
| `pydantic` | 2.12.5 | MIT |
| `pydantic-core` | 2.41.5 | MIT |
| `pyjwt` | 2.13.0 | MIT |
| `python-binance` | 1.0.35 | MIT |
| `python-dateutil` | 2.9.0.post0 | BSD-3-Clause OR Apache-2.0 |
| `python-dotenv` | 1.2.2 | BSD-3-Clause |
| `python-multipart` | 0.0.31 | Apache-2.0 |
| `pytz` | 2026.3.post1 | MIT |
| `pyyaml` | 6.0.3 | MIT |
| `regex` | 2026.7.19 | Apache-2.0 AND CNRI-Python |
| `requests` | 2.34.2 | Apache-2.0 |
| `scipy` | 1.17.1 | BSD-3-Clause |
| `six` | 1.17.0 | MIT |
| `soupsieve` | 2.9.1 | MIT |
| `starlette` | 0.52.1 | BSD-3-Clause |
| `typing-extensions` | 4.16.0 | PSF-2.0 |
| `typing-inspection` | 0.4.2 | MIT |
| `tzlocal` | 5.4.4 | MIT |
| `urllib3` | 2.7.0 | MIT |
| `uvicorn` | 0.40.0 | BSD-3-Clause |
| `uvloop` | 0.22.1 | Apache-2.0 OR MIT |
| `watchfiles` | 1.2.0 | MIT |
| `websockets` | 15.0.1 | BSD-3-Clause |
| `yarl` | 1.24.5 | Apache-2.0 |
| `yfinance` | 1.5.2 | Apache-2.0 |

Development-only tools from `backend/requirements-dev.txt` (`ruff`, `mypy`,
`pytest`, `httpx`, `sqlacodegen`) are not shipped in the image. They are MIT or
BSD-3-Clause licensed.

`pytest-asyncio` 1.1.0 is an Apache-2.0 development-only test plugin and is not
shipped in the image.

## 5. Frontend dependencies

Direct dependencies from `frontend/package.json`. Several packages listed as dev
dependencies (Svelte, Tailwind, `bits-ui`, `@lucide/svelte`) are compiled into the
shipped bundle, so they are included here.

| Package | Version | License |
| --- | --- | --- |
| `@codemirror/lang-python` | 6.2.1 | MIT |
| `@codemirror/state` | 6.6.0 | MIT |
| `@codemirror/theme-one-dark` | 6.1.3 | MIT |
| `@codemirror/view` | 6.41.1 | MIT |
| `@internationalized/date` | 3.12.0 | Apache-2.0 |
| `@lucide/svelte` | 1.7.0 | ISC |
| `@sveltejs/vite-plugin-svelte` | 6.2.4 | MIT |
| `@tailwindcss/vite` | 4.2.1 | MIT |
| `@types/culori` | 4.0.1 | MIT |
| `@types/node` | 25.3.0 | MIT |
| `@vitest/coverage-v8` | 4.0.18 | MIT |
| `bits-ui` | 2.16.5 | MIT |
| `clsx` | 2.1.1 | MIT |
| `codemirror` | 6.0.2 | MIT |
| `culori` | 4.0.2 | MIT |
| `lightweight-charts` | 5.1.0 | Apache-2.0 |
| `prettier` | 3.8.1 | MIT |
| `svelte` | 5.53.5 | MIT |
| `svelte-check` | 4.4.3 | MIT |
| `tailwind-merge` | 3.5.0 | MIT |
| `tailwind-variants` | 3.2.2 | MIT |
| `tailwindcss` | 4.2.1 | MIT |
| `tailwindcss-animate` | 1.0.7 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vite` | 7.3.1 | MIT |
| `vitest` | 4.0.18 | MIT |

Across the full transitive npm tree (140 packages): 119 MIT, 8 Apache-2.0,
5 ISC, 4 BSD-3-Clause, 2 MPL-2.0, 1 0BSD, and `svelte-toolbelt`, which omits the
`license` field in its manifest but ships an MIT license file (Copyright (c) 2024
Hunter Johnston and Thomas G. Lopes). No copyleft licenses beyond MPL-2.0 appear
in the frontend tree.

Icons are provided by `@lucide/svelte` (ISC), derived from Feather Icons
(MIT, Copyright (c) 2013-2023 Cole Bemis). UI primitives derive from `bits-ui`
and shadcn-svelte, both MIT.

## 6. Bundled data and fixtures

OpenQuant ships no third-party market data.

| Asset | Origin | Status |
| --- | --- | --- |
| `frontend/src/lib/features/backtest/fixtures/sample-run.json` | Generated by OpenQuant (`data_version: synthetic-v1`, seeded RNG) | Synthetic. Covered by the OpenQuant license. Contains no real market prices. |
| `backend/datastore/seeds/sp500_membership.csv` | Hand-entered index membership seed | Ticker symbols and membership dates are facts, not copyrightable expression. See the trademark note below. |

"S&P 500" and "S&P" are registered trademarks of S&P Dow Jones Indices LLC.
OpenQuant uses the term only to name a data grouping and is not affiliated with,
endorsed by, or licensed by S&P Dow Jones Indices. The bundled file is a small
illustrative seed, not a licensed reproduction of the index constituent list.

## 7. Third-party data providers

Market data fetched at runtime is **not** covered by the OpenQuant license. It is
supplied by the provider you select, under that provider's terms, and you are
responsible for complying with them. OpenQuant does not redistribute this data;
it is retrieved directly by your own deployment.

| Provider | Accessed via | Terms |
| --- | --- | --- |
| Yahoo Finance | `yfinance` (Apache-2.0) | <https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html> — personal, non-commercial use. `yfinance` is not affiliated with or endorsed by Yahoo. |
| Binance | `python-binance` (MIT) | <https://www.binance.com/en/terms> |
| Twelve Data | Direct HTTPS, user-supplied API key | <https://twelvedata.com/terms> |

Yahoo!, Binance, and Twelve Data are trademarks of their respective owners.
OpenQuant is not affiliated with, endorsed by, or sponsored by any of them.

## Regenerating this file

Backend license identifiers are read from installed package metadata; frontend
identifiers come from each package's manifest. When metadata is missing or is not
a valid SPDX expression, the value is verified by reading the package's bundled
license text rather than inferred. Refresh this file whenever
`backend/requirements.txt` or `frontend/package.json` changes:

```bash
pip install -r backend/requirements.txt      # into the project virtualenv
npm --prefix frontend ci
```

then re-check each table against the installed metadata.
