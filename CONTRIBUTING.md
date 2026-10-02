# Contributing to OpenQuant

Thanks for your interest in OpenQuant. This guide covers local setup, the checks
your change must pass, and how to get a pull request merged.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Found a security vulnerability?** Do **not** open an issue or pull request.
  Follow [SECURITY.md](SECURITY.md) to report it privately.
- **Planning something large?** Open an issue first and describe the approach.
  A short discussion up front is cheaper than a rewrite after review.
- **Small fix?** Just send the pull request. Typos, broken links, and obvious
  bugs do not need an issue.

## Local setup

You need Python 3.12+, Node.js 20+, and Docker (only for the Compose path).

```bash
git clone https://github.com/AlexAlexBabarika/openQuant.git
cd openQuant

python3 -m venv .venv
source .venv/bin/activate                      # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt

npm --prefix frontend ci
```

CI runs Python 3.12 and Node 20. Newer versions generally work, but reproduce
against those before reporting a CI-only failure.

### Running the app

Backend and frontend together, with hot reload:

```bash
./run.sh                 # add --install to install dependencies first
```

The Vite dev server listens on `http://localhost:5173` and proxies `/auth`,
`/user`, `/data`, `/health`, and `/ws` to the backend on port 8000.

To run them separately:

```bash
PYTHONPATH=. python run_backend.py     # backend on http://127.0.0.1:8000
npm --prefix frontend run dev          # frontend on http://localhost:5173
```

To exercise the shipped deployment path instead:

```bash
docker compose up -d --build           # http://localhost:8000
```

Stopping containers preserves your data. Deleting the named volume
(`docker compose down --volumes`) permanently resets OpenQuant.

## Checks your change must pass

Run the checks for the areas you touched. All commands run from the repository
root.

### Backend

```bash
ruff format backend/          # apply formatting (CI runs --check)
ruff check backend/           # lint
mypy backend/                 # type check
pytest backend/tests          # 455 tests
```

### Frontend

```bash
npm --prefix frontend run check                        # svelte-check
npx --prefix frontend prettier --write --ignore-unknown frontend/
npx --prefix frontend vitest run --root frontend       # 218 tests, non-watch
npm --prefix frontend run build                        # production build
```

`npm --prefix frontend test` starts vitest in watch mode. Use `vitest run` for a
single pass.

### Optional: pre-commit

The repository ships a [pre-commit](https://pre-commit.com) config that runs
ruff, prettier, and whitespace hooks on staged files:

```bash
pip install pre-commit && pre-commit install
```

### What CI enforces today

The backend workflow runs formatting, linting, typing, `pytest`, and a fresh
PostgreSQL migration check. The frontend workflow runs `svelte-check`, Prettier,
the production build, and `vitest run`. A Docker workflow builds and smoke-tests
`linux/amd64` and `linux/arm64`. A weekly security workflow runs dependency,
secret, and image scans.

## Code style

Match the surrounding code. The configured tools are the arbiter:

- **Python** — `ruff` for formatting and linting (`E`, `F`; `E501` disabled), and
  `mypy` per `mypy.ini`. Type annotations are encouraged but not mandatory.
- **Svelte / TypeScript** — `prettier` with 2-space indentation, semicolons,
  single quotes, and avoided arrow parens (`.prettierrc.json`).
- **Svelte components** — this project uses **Svelte 5 runes** (`$state`,
  `$derived`, `$props`). Do not add Svelte 4 stores or `export let` props to new
  code.

## Testing expectations

- Bug fixes should come with a test that fails before the fix and passes after.
- New backend behaviour belongs in `backend/tests/`.
- New frontend logic belongs next to the module it covers, as
  `<module>.test.ts`. Logic lives in `frontend/src/lib/`, which is where it is
  practical to test — prefer extracting logic there over testing components.
- Do not commit tests that reach the network. Provider calls must be stubbed.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep the change focused. Unrelated refactors, formatting sweeps, and
   dependency bumps belong in separate pull requests.
3. Run the relevant checks above.
4. Sign off your commits (see below).
5. Open the pull request against `main`, fill in the template, and describe what
   you changed and how you verified it.

Maintainers review on a best-effort volunteer basis. If a pull request goes quiet
for two weeks, a polite ping on the thread is welcome.

### Commit messages

Write a short imperative subject line, optionally prefixed with a scope:

```
fix(chart): keep crosshair aligned after interval change
```

### Developer Certificate of Origin

OpenQuant uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) rather than a CLA. There is nothing to sign and no account to create — you
certify that you wrote the contribution, or otherwise have the right to submit it
under the project's license, by adding a `Signed-off-by` line to each commit:

```
Signed-off-by: Your Name <your.email@example.com>
```

Git adds this line automatically with `-s`:

```bash
git commit -s -m "fix(chart): keep crosshair aligned after interval change"
```

The name and email must be real and must match your Git author identity. To fix
missing sign-offs on commits you have already made:

```bash
git rebase --signoff main
```

Contributions are accepted under the Apache License 2.0, the same license the
project is distributed under. You retain copyright in your contribution.

## Adding dependencies

Dependencies affect image size, security surface, and license compliance, so
they get extra scrutiny. Before adding one, check whether the existing stack
already covers the need.

If you do add one:

- **Backend** — add the pinned dependency to `backend/requirements.in`, then
  regenerate the hashed `backend/requirements.txt`. Development-only tools go in
  `backend/requirements-dev.txt`.
- **Frontend** — add it with `npm --prefix frontend install` and commit the
  updated `package-lock.json`.
- **License** — only permissive licenses (MIT, BSD, Apache-2.0, ISC) are accepted
  without discussion. Anything copyleft (GPL, AGPL, LGPL, MPL) must be raised in
  the pull request, because it carries redistribution obligations for everyone
  shipping the Docker image. Update
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same pull request.

Never commit secrets, API keys, `.env` files, database dumps, or real account
data. The repository is scanned with gitleaks across its full history.

## Project layout

```
backend/          FastAPI app: routes, market data, backtesting, datastore
  tests/          pytest suite
frontend/src/
  components/     Svelte components, grouped by UI area
  lib/features/   Feature logic and state (the testable layer)
  lib/components/ Reusable UI primitives (shadcn-svelte)
shared/           Types shared between backend and frontend
database/         PostgreSQL initialisation
docker-compose.yml
```

## Licensing of contributions

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE) and that your `Signed-off-by` line certifies the
Developer Certificate of Origin. See [TRADEMARKS.md](TRADEMARKS.md) for what the
license does and does not grant regarding the project name.
