# Isolated research recovery

This runbook extends the existing [backup mechanism](../README.md#back-up) and
[isolated restore drill](PUBLICATION_READINESS.md#repeatable-isolated-restore-drill-operator-run-never-run-by-preflight).
Use PostgreSQL dump/replay and ordinary offline file copies, not another database
or persistence service. A receipt proves byte integrity, **not** a coherent
cross-store snapshot, decryptability, successful database replay, hosted security,
provider access, or a completed browser restore. Keep those acceptance checks separate.

## What must survive together

| Store | Included evidence | Boundary |
| --- | --- | --- |
| PostgreSQL | Original account UUIDs, profiles, password hashes/refresh sessions, encrypted key records, saved strategies/scripts, ticker workspace data and migrations | Dump one complete compatible database. Preserve object owners/roles separately: `pg_dump` does not dump cluster roles. Expired sessions need normal sign-in. |
| `OPENQUANT_DATA_ROOT` | Whole tree, including datasets/manifests, `runs/owners/<sha256(account UUID)>/<run ID>/`, source/config/bars/results and `notebook-metadata.json` | Copy while every writer/job is quiesced. Account UUID spelling must remain unchanged. Never rename owner directories to transfer research. |
| Runtime secrets | Matching signing/encryption material | Compose stores generated secrets in `/app/data/secrets.json`; a normal shell launch defaults to `.openquant/secrets.json` outside the data root. Custom `OPENQUANT_SECRETS_FILE` and environment overrides must be inventoried explicitly. |
| Account-local browser research | Explicitly exported notebook metadata, drafts/workspaces, robustness receipt/review and Elements | Separate unencrypted private browser bundle; not in the server dump, not cloud sync. Unsaved/in-memory work is not captured. |

Never assign legacy unscoped runs or guest/unscoped browser records to an account.
They have no established owner. Preserve them separately, inaccessible through
account endpoints. A notebook reference does not grant snapshot access. HTML
robustness reports are source-free evidence; notebook exports are metadata-only;
neither alone can restore runnable research. CSV uploads must be retained privately
and re-uploaded; they are not carried by presets or the browser bundle.

## 1. Prepare and capture (operator only)

1. Use approved encrypted backup storage outside the checkout, with directory
   permissions `0700`, file permissions `0600` and `umask 077`. SQL, research source,
   manifest paths/hashes, keys and browser bundle payloads are private. Never attach,
   upload, log or commit them. Disable shell tracing. Retain originals until a
   restore has been verified and retention policy permits disposal.
2. Record code/image revision, PostgreSQL major, database/role identities, effective
   data/secrets paths, external secret version references, time and expected
   research/account counts privately. Use a compatible checkout/image for restore.
3. Explicitly stop/quiesce **all** app writers, worker jobs and scheduled processes.
   This is an operator decision: the helper never stops services. Keep PostgreSQL
   running. A PostgreSQL dump is internally consistent, but its timing does not
   synchronize the separate filesystem copy. No atomic cross-store backup is claimed.
4. Use the existing `pg_dump --clean --if-exists` and copy mechanism. For Compose,
   after the operator has stopped app writers:

   ```bash
   umask 077
   # These absolute directories must already be operator-owned and private.
   docker compose exec -T postgres sh -c \
     'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
     > /protected/backup/openquant.sql
   docker compose cp openquant:/app/data/. /protected/backup/app-data
   ```

   Check each exit code, including dump completion, before accepting the pair.
   Copying from the stopped app container is permitted. For a shell deployment,
   copy the complete configured data root and its separate `.openquant`/custom
   secret file. Preserve externally supplied signing/encryption keys through their
   approved secret-manager backup mechanism; backing up an unused generated file
   does **not** preserve overriding environment values. Never rotate missing keys
   to make old ciphertext appear recoverable.

## 2. Create a private integrity receipt

Run at the compatible checkout in a POSIX/Linux environment with no-follow file
support (unsupported platforms fail closed); no imports start the app or generate secrets:

```bash
.venv/bin/python -m backend.scripts.research_recovery capture --quiesced \
  --revision "$(git rev-parse HEAD)" \
  --data-root /protected/backup/app-data \
  --dump /protected/backup/openquant.sql \
  --secrets-file /protected/backup/app-data/secrets.json \
  --manifest /protected/backup/integrity.json
```

For a separate generated-secret file, pass its actual backup path instead.
The helper requires an existing runtime-format JSON file with valid signing and
encryption fields. It never reads environment secrets, creates key material or
copies keys. If effective secrets are only externally managed, do not export them
to plaintext solely for this helper or pass an unused generated file as evidence:
use the approved protected materialization mechanism if one exists; otherwise this
file-based receipt is not applicable to that configuration. Verify external version
references and decryption separately in the isolated instance.

The helper hashes the full tree, dump and supplied secrets, retaining empty
directories. It creates only a new `0600` receipt, exclusively: existing output,
output inside the data tree, symlinks, hardlinks, special files, changing files,
missing/invalid secrets and invalid revisions fail. It never executes SQL/code or
restores anything. Limits are 50,000 tree/file entries, 16 GiB combined input,
64 directory levels, 16 MiB receipt and 16 KiB secrets JSON. Beyond these limits,
use reviewed operator tooling; do not silently omit files. Paths must be trusted
and offline: this is not a defense against a hostile process replacing ancestor
directories during traversal. Receipts are not signed and are not an authenticity
guarantee against malicious replacement of both backup and receipt.

CLI output is fixed/redacted: success exits `0`, verification/input failure `1`,
missing offline confirmation or bad CLI arguments `2`. `--quiesced` is an operator
assertion, not a detected lock. Protect the receipt just like the backup.

## 3. Restore only into disposable fresh targets

Use a disposable VM/Docker context with **no source/production containers or
volumes**. A distinct Compose project is additional isolation, not sufficient
on its own. Pin the compatible images; use a free loopback port and an
operator-reviewed external override with `SEED_SYMBOLS_ON_STARTUP=0`, no public
exposure and independently enforced outbound denial (except the isolated DB).
Do not contact restored providers or perform trades. Review the existing Compose
identity migration dependency before allowing app startup.

Do not replay SQL into a populated database or copy files over a populated app-data
target. The following is an operator-run procedure, **not** an auto-restore CLI:

```bash
# On the disposable VM only. The override and backup exist outside the checkout.
export OPENQUANT_PORT=18080
drill() {
  docker compose -p openquant-restore-drill \
    -f docker-compose.yml -f /protected/operator/restore-drill.yml "$@"
}
read -r -p 'Disposable context, original writers offline, fresh empty targets? Type RESTORE: ' answer
test "$answer" = RESTORE || exit 1
drill up -d postgres
drill exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
drill create --no-deps openquant

# Reject any existing non-system relation before replay; inspect all other schema
# objects/volumes privately too. A fresh database from template0 is preferred.
empty=$(drill exec -T postgres sh -c \
  'psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';
SQL
)
test "$empty" = 0 || exit 1
# Inspect the newly allocated app_data volume offline: it must contain no files.
# If any target is populated, STOP; choose new infrastructure. Never auto-clean it.
drill exec -T postgres sh -c \
  'psql -X -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /protected/backup/openquant.sql
drill cp /protected/backup/app-data/. openquant:/app/data
# Restore a separate secrets file ONLY to its fresh, nonexistent target when used.
# Supply matching external secret versions using the approved mechanism.
```

SQL dumps are executable instructions: restore only a trusted backup. Ensure all
required owner/role names exist first; fresh drill credentials can differ, but do
not rewrite account UUIDs or silently change object ownership. `-X` avoids local
psql startup commands, `ON_ERROR_STOP` prevents continuing after failed SQL, and
`-1` makes compatible plain-dump replay transactional. This transaction does not
include the app-data copy. Any failure is a failed restore, not a usable target.

Copy the restored data tree back to a **new private inspection directory** while
writers are still offline and verify it against the original receipt and dump:

```bash
drill cp openquant:/app/data/. /protected/inspection/restored-app-data
.venv/bin/python -m backend.scripts.research_recovery verify --quiesced \
  --revision "$(git rev-parse HEAD)" \
  --data-root /protected/inspection/restored-app-data \
  --dump /protected/backup/openquant.sql \
  --secrets-file /protected/inspection/restored-app-data/secrets.json \
  --manifest /protected/backup/integrity.json
```

Verify mounted-file access for the app's UID `10001` privately before starting it;
hashes do not verify permissions/ownership. Avoid recursive permission changes to
the source. A missing/mismatched key is a failure; do not boot the app and let it
generate a replacement. Only after those checks, `drill up -d openquant`.

## 4. Meaningful recovery assertions

Maintain a private before/after witness rather than relying only on file existence:

- Compare restored account UUIDs and foreign-key associations, migration
  version/checksum rows, table/column schema, counts and content hashes of saved
  strategies/scripts, ticker workspaces, key ciphertext and profiles. A successful
  SQL exit alone is insufficient. Keep queries read-only and never print rows or
  connection strings into session logs.
- In the isolated environment with the original effective secrets, retrieve a
  bounded number of synthetic `api_keys.encrypted_key` records in a read-only DB
  transaction and call the existing `backend.core.encryption.decrypt_api_key`.
  Compare a synthetic expected plaintext **hash in memory**, not displayed keys.
  Do not call provider APIs. Bound the query (for example 1,001 records with a
  failure above 1,000); route exceptions to a fixed failure status without values.
  Validate missing secrets before importing runtime secret loading, which normally
  creates defaults on boot.
- Load the expected run through `RunStore(...).for_owner(original UUID).read(id)`;
  check source/config/params, bar/result hashes and notebook metadata. Account B
  must not acquire A's run; legacy runs stay unassigned. Notebook references remain
  separate from snapshot availability.
- Restart the isolated app/DB and repeat schema, identity, decryption and run reads.
  On synthetic infrastructure without new writes, stop/quiesce app writers and
  repeat the data/key receipt comparison. Do not compare a newly generated SQL
  dump byte-for-byte: dump formatting/session metadata can differ; compare the
  deterministic database witness instead.
- On **separate disposable copies**, alter a snapshot byte, remove secrets and
  supply a different encryption key. Each must fail integrity/decrypt checks
  without repair/rotation. Preserve originals; never corrupt the only backup.
- Record redacted counts, elapsed backup/replay/validation time, restart result and
  failed checks. Only remove drill volumes after explicit operator review, scoped
  to that disposable context; never delete source volumes as troubleshooting.

Use synthetic accounts and engine fixtures for a drill, not customer data. Synthetic
bar fixtures remain synthetic even when the native report format labels a provider.
No native-provider, hosted-security, 10 Hz performance or leak acceptance follows.

## Browser-local recovery inventory

`ID` below means the URI-encoded authenticated account ID, not a user-entered owner.

| Mechanism/key | Existing behavior and limits | Recovery coverage |
| --- | --- | --- |
| `openquant.research.v1:account:ID` | ResearchShelf v1; Strategy/Indicator drafts up to 1,000,000 characters each; up to ten presets with layout and both draft copies | Reload offers explicit draft recovery; Workspaces restores a preset after confirmation, never executes code; no built-in portable file transfer. |
| `openquant.runs.history:account:ID` | Up to 50 notebook references; metadata format v1, 6 MiB; 120-char labels, 12 tags of 600 chars, 10,000-char notes, one single baseline | Runs JSON export/import adds missing references without replacing notes; explicit server save replaces the whole metadata document; explicit load/replacement is owner/edit-fenced. Server copy included only in data-root backup. No snapshots/source/bars. |
| `openquant:robustness-review:v1:account:ID` | Latest native workspace receipt/context/review only; native limit 3,000,000 characters | Explicit restore retains original receipt, doesn't change inputs/run checks; mismatched/unavailable identity remains stale. HTML is not a rerunnable backup. |
| `openQuant.drawables.v2.user.ID` | Elements geometry/style/params; shipped tool schemas and migrations | Normal account-local reload only; no existing complete export UI. Unknown/unreadable entries may be ignored by native loaders, so bundle restore refuses unreadable categories rather than silently dropping them. |

Guest shelf/history, `openQuant.drawables.v2.guest` and legacy
`openQuant.drawables.v1` are **not** account-bundle sources. Device-global
`openquant:notes`, ticker groups/selections, correlation benchmarks, theme/chart
colours/templates/favourites and `openQuant.drawables.toolDefaults.v1` are also
excluded: they cannot establish an account owner. Pending ticker workspace writes
(`openQuant.tickerWorkspace.pending.v1.ID`)
are separate local retry state, not covered by the four-category bundle; flush
approved server saves or preserve them separately without adopting guest records.
Server-saved ticker workspace rows belong to the database backup. Volatile editor
changes, CSV payloads, pending requests and unsaved chart state need their own
explicit save/copy before capture. This is not an export of all localStorage.

## Account bundle module and parent integration contract

`frontend/src/lib/features/recovery/accountBundle.ts` provides transport and
preview only; it does not add UI, server endpoints, a second storage system,
automatic recovery or network calls. Coverage is precisely the four categories
above, not every browser preference. Bundle files contain account identity and
research payloads; they are private unencrypted files, not a token/credential vault.

- `exportAccountBundle(storage, readIdentity)` reads only those four exact account
  keys and returns `{ text, preview }`. Render the category/status/byte preview
  before offering an explicit private download. Unreadable raw originals are
  preserved in the export; they are marked unreadable and cannot be committed.
  Blocked/oversized reads fail; never create an incomplete success bundle.
- `prepareAccountRestore(text, storage, readIdentity)` validates version, owner,
  allowlist and limits and returns `{ preview, commit }` without writing. Caller
  must bound a selected file's size **before** reading it. Use authenticated
  identity `{ account, generation }`; increment generation on every account/session
  boundary, including A → B → A. Guest/null owners and cross-owner bundles fail.
- Render preview, choose a **fresh account-local target** with none of these four
  keys, explicitly confirm offline/quiesced browser writers, then call
  `commit({ confirmed: true, writersPaused: true })`. No populated target is ever
  replaced, including unreadable existing bytes. New intervening edits or identity
  changes invalidate the staged restore. Do not clear storage to force a restore;
  preserve/export originals and use a disposable profile/origin instead.
- Pause autosaves, pending notebook loads, robustness saves and annotation writes
  throughout preview/commit. After success reload/rehydrate through native loaders;
  draft/report/preset activation remains explicit and must not execute research.
  Do not keep old live state that can immediately overwrite restored bytes.
- localStorage multi-key writes are **not atomic**. Quota/blocked writes fail and
  perform best-effort rollback of only the exact bytes just written. Failed rollback
  can leave partial records: preserve the original bundle and use a new fresh
  target; never report success or discard the original after such an error.
- Limits: 48 MiB UTF-8 bundle; shelf 24 MiB; notebook 6 MiB; robustness 3,000,000
  UTF-8 bytes (stricter than the native character bound); Elements 4 MiB and 2,000
  entries. Source category validation reuses existing layout/notebook/report/tool
  validators. The receipt's owner string is a transport fence, not authorization
  to server research; changing JSON cannot transfer snapshot access.

Parent browser acceptance scenarios: export/recover all four categories for A in
a disposable fresh profile; verify code, layout, notes/baseline/decision, Elements
and original report/review after reload; activation stays explicit and runs nothing.
Check guest and B exclusion, A → B → A while previewed, intervening edits, unreadable
source/target preservation, bad version/shape, oversized files, storage quota/blocked
access and partial rollback. Verify original server snapshots are still authorized
only by restored account identity, not imported browser metadata. Do not attach
research-bearing exports/screenshots in test evidence.

## Local shell validation versus a complete drill

```bash
.venv/bin/python -m pytest backend/tests/test_research_recovery.py
npm --prefix frontend run test:ci -- src/lib/features/recovery/accountBundle.test.ts
```

Backend tests include a disposable filesystem drill using native RunStore snapshots,
notebook metadata and AES-GCM synthetic ciphertext. Two fresh Python processes
verify restored source/bars/notebook/decryption without a warmed key cache; damaged
code/dump/key, missing keys, unsafe files and bounds fail. Its explicitly named SQL
stub is **not** PostgreSQL evidence. Browser-module tests use bounded in-memory
storage and native loaders, not a mounted browser. These tests do not claim a full
database/app/browser restore or service restart. The complete drill requires all
assertions above on available isolated infrastructure and parent browser validation.

Official references: [PostgreSQL SQL dump/restore](https://www.postgresql.org/docs/16/backup-dump.html),
[psql failure/transaction options](https://www.postgresql.org/docs/16/app-psql.html).
