---
description: "Guides v2 snapshot script: catalog, named clean dirs, bera-reth download unless --no-download or binary missing."
date: 2026-08-25
ref: BERA-912
---

# Brief: fetch-berachain-snapshot-v2 (guides)

## Premise-forcing

Mechanical/code-only. N/A. Public CLI in `berachain/guides`; operators restore official storage v2 snapshots into named directories.

## Problem

`apps/node-scripts/fetch-berachain-snapshot.js` reads v1 `index.csv` and curls whole-datadir tarballs (`reth-pruned` / `reth-archive`). Official Berachain-distributed snapshots are moving to storage v2: one `catalog.csv` generation, CL `.tar.lz4` companions, EL via `bera-reth download --manifest-url`. Curl of a v1 EL tarball is not a v2 restore. Operators following guides still have only the v1 downloader.

## Approach

After this work, `berachain/guides` ships `apps/node-scripts/fetch-berachain-snapshot-v2.js` (name locked). The v1 script is unchanged. The v2 script reads public storage v2 `catalog.csv`, creates **empty named directories**, restores CL by curl + extract into the CL dir, and restores EL by `bera-reth download --manifest-url --datadir` into the EL dir. `--type` chooses EL `--minimal` vs `--archive` only; CL defaults to `cl-pruned`; `--full-cl` selects `cl-archive`. `--no-download` prints those restore commands and does not fetch or extract. If `bera-reth` is not on PATH (and `--reth-bin` is unset/missing), EL is print-only; CL restore still runs unless `--no-download` or `--el-only`.

## Public Contract

- **New file:** `apps/node-scripts/fetch-berachain-snapshot-v2.js`. Node.js 18+, curl on PATH. `lz4` and `tar` on PATH for CL extract.
- **Catalog (single authoritative seam):** default `https://bera-snapshots.fsn1.your-objectstorage.com/v2/<chain>/catalog.csv`. `bepolia` maps to chain id folder `bepolia`. Override URL allowed. Header, exact order: `type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role`. Roles: `el-manifest`, `cl-pruned`, `cl-archive`, exactly one row per role per generation. Layout: `infra-snapshots/_worktrees/bare-metal/project/reference/storage-v2.md`. That file plus the live catalog are the only catalog contract for this script.
- **Directory names** (under `--output`, default `downloads`):
  - EL: `<output>/<network>-<type>-el`
  - CL: `<output>/<network>-<type>-cl`
  - Script creates each target as an **empty** directory. If the path exists and is not empty, fail closed (non-zero). Do not reuse a dirty datadir.
- **EL restore command** (run or print): `bera-reth download --chain <chain> --manifest-url <catalog el-manifest URL> --datadir <el-dir> --minimal|--archive` plus any non-interactive flag the shipped binary requires (`-y` if that is the current prompt skip). `--type pruned` → `--minimal`. `--type archive` → `--archive`.
- **CL restore command** (run or print): curl the catalog CL `.tar.lz4` (resume `-C -` when actually downloading), `lz4 -d | tar` into `<cl-dir>`. Default CL role is always `cl-pruned`. `cl-archive` is only when `--full-cl` (or equivalent spelling in allowed latitude) is set. `--type archive` does not select `cl-archive`.
- **`--no-download`:** print EL and CL restore commands (skipping the omitted side for `--beacon-only` / `--el-only`). Do not create dirs, curl, extract, or invoke `bera-reth`. Exit 0 after printing.
- **Missing `bera-reth`:** look up `bera-reth` on PATH, then `RETH_BIN` / `--reth-bin` if those flags exist. If none is an executable, print the EL command and do not fail for that reason. Still perform CL restore unless `--no-download` or `--el-only`.
- **v1 script:** unchanged.
- **Does not** curl v1 EL tarballs or fetch Reth objects with curl. EL objects only via `bera-reth download`.

## Artifacts

- **Consulted**: `infra-snapshots/_worktrees/bare-metal/project/reference/storage-v2.md` (authoritative catalog and pairing contract, ADR-005); berabox `scripts/lib/v2_catalog.py` on main as of https://github.com/berachain/berabox/pull/8 (`690fee9` — `RESTORE_PAIRING` matches this brief's table; corroborating Python, not this script's authority and not importable); `documentation/guides/apps/node-scripts/fetch-berachain-snapshot.js` (v1 CLI shape only, not a catalog model).
- **Create/update**: this brief; Proof Parade under `$ARTIFACT_DIR/demos/` at scaffold; code in `berachain/guides`.

## Context Payload

- **Target Files**: `berachain/guides` `apps/node-scripts/fetch-berachain-snapshot-v2.js` plus tests beside `test-snapshot-urls.js` if that pattern fits. Do not modify infra-snapshots publish.
- **Required Context**: live `https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/catalog.csv` and `storage-v2.md` — together the only catalog seam for this script; v1 script for CLI shape only. Berabox `v2_catalog.py` on main now parses that same live header (`RESTORE_PAIRING` matches). This script still does not import or shell out to it; mirror the table in Node.
- **Discussion Decisions**:
  - New script, not a rewrite of v1. Lead locked.
  - EL default is restore via `bera-reth download` into a clean named datadir when the binary is present. Lead locked 2026-08-25 (`/plan` invoke).
  - `--no-download` prints extract/restore commands only. Lead locked.
  - Partial restore: missing binary is exit 0 with stderr that EL was skipped; no resume flag; dirty-dir fail-closed on retry. Lead locked 2026-08-25 (SK-2 keep-manual).
  - Language: Node 18+ sibling. Steward default; Lead did not contradict.
  - Flags: `--network bepolia|mainnet`, `--type pruned|archive`, `--output`, `--beacon-only`, `--execution-only` / `--el-only`, plus `--no-download`. `--reth-bin` optional.
  - `--type` selects EL only: `pruned` → `--minimal`, `archive` → `--archive`. CL is always `cl-pruned` unless `--full-cl` (or equivalent) selects `cl-archive`. Same table as `storage-v2.md` `storage_mode` (`minimal`/`pruned` → `cl-pruned` + `--minimal`; `archive` → `cl-pruned` + `--archive`; `full_archive` → `cl-archive` + `--archive`). Mirror that table in Node; this script is standalone and does not import or shell out to berabox Python. Lead locked 2026-08-25 (`/plan` split-flags).
  - Mainnet: no v2 catalog on cron. Fail closed; name the v1 script. No silent v1 fallback. Covered by AC-10 / TP-7.
- **Dependency / Technology Decisions**: no new npm deps. curl + Node fetch. `lz4`, `tar` for CL extract. `bera-reth` optional at runtime.
- **External References**: https://docs.berachain.com/nodes/operations/quickstart#step-6-fetch-snapshots-optional (docs rewrite is a later PR).

## Demonstration Plan

- **Proof Parade path:** `$ARTIFACT_DIR/demos/BERA-912-fetch-berachain-snapshot-v2.md`
- [ ] **VC-1** Shape: integration-shaped (live catalog + local dirs). Medium: terminal session. Live crossing: public `catalog.csv`. Both steps are required; neither substitutes for the other.
  - **Step 1** `--no-download` against the live bepolia catalog: printed EL and CL restore commands carry live catalog URLs and the named dirs; no dirs created, nothing fetched.
  - **Step 2** default run into a temp `--output`: both named dirs created empty, then the CL side actually restored from the live `cl-pruned` object (CL dir non-empty afterward). EL side depends on the binary and is captured either way — present: EL dir populated by `bera-reth download`; absent: EL command printed plus the stderr skip line, with the CL dir still non-empty. A missing-binary run is a labeled sub-exhibit of Step 2, not a replacement for it.

## Test Plan

- [ ] **TP-1** Fixture catalog: `--type pruned` selects `el-manifest` + `--minimal` + `cl-pruned`; `--type archive` selects `el-manifest` + `--archive` + `cl-pruned`; `--full-cl` (with either type) selects `cl-archive`.
- [ ] **TP-2** Missing catalog / missing role / dirty target dir: non-zero.
- [ ] **TP-3** `--beacon-only` and `--el-only` mutually exclusive.
- [ ] **TP-4** `--no-download`: stdout contains `bera-reth download` and the CL extract pipeline; no curl of payload in that mode (mock/spy or PATH stub).
- [ ] **TP-5** No `bera-reth` on PATH: EL command printed; stderr states EL was skipped; process still succeeds (exit 0) if CL side is in scope.
- [ ] **TP-6** v1 `fetch-berachain-snapshot.js` bytes unchanged.
- [ ] **TP-7** `--network mainnet` against a missing or failed v2 catalog: non-zero; stderr names `fetch-berachain-snapshot.js`; no fetch of v1 `index.csv` or v1 EL tarballs.
- [ ] **TP-8** PATH stub `bera-reth` that exits 0 and records argv: default (not `--no-download`) invokes that binary with `--manifest-url`, `--datadir` pointing at the named EL dir, and `--minimal` or `--archive` per `--type`. No live snapshot download required.
- [ ] **TP-9** Default run against a temp `--output`: both `<output>/<network>-<type>-el` and `<output>/<network>-<type>-cl` exist and were created empty by the script before any restore wrote into them (AC-4 full claim, both sides).
- [ ] **TP-10** Default run with a fixture CL tarball and spied `curl`/`lz4`/`tar`: the CL pipeline runs with the catalog `cl-pruned` URL and extracts into the CL dir, and the CL dir is non-empty afterward.
- [ ] **TP-11** No `bera-reth` on PATH, CL in scope: TP-10's CL extract still runs and the CL dir is non-empty, while the EL dir stays empty (AC-7 full claim, not just exit 0).

## Acceptance Criteria

Boxes stay `[ ]` until Implementor.

- [ ] **AC-1** New v2 script exists in `apps/node-scripts/` and is the only new public entrypoint this brief adds.
- [ ] **AC-2** v1 `fetch-berachain-snapshot.js` is byte-identical to baseline.
- [ ] **AC-3** Script reads catalog rows by `role`; it does not parse v1 `index.csv`.
- [ ] **AC-4** Default (no `--no-download`): creates empty `<output>/<network>-<type>-{el,cl}` and restores into them. Existing non-empty path fails closed.
- [ ] **AC-5** EL restore is `bera-reth download --manifest-url` into the EL dir. Never curl `reth-pruned` / `reth-archive` tarballs. Never treat `manifest.json` as a packed datadir.
- [ ] **AC-6** `--no-download` prints the restore commands and performs no fetch, extract, or `bera-reth` invoke.
- [ ] **AC-7** Missing `bera-reth` executable: print EL command; do not fail for missing binary; stderr states EL was skipped; CL restore still runs when in scope. No resume/skip-complete flag. A later retry against a non-empty dir still fails closed (AC-4).
- [ ] **AC-8** Missing catalog, HTTP failure, missing required role, or dirty target dir: non-zero stderr that names the gap.
- [ ] **AC-9** Proof Parade demonstrates the new CLI seam.
- [ ] **AC-10** `--network mainnet` with a missing or failed v2 catalog exits non-zero. stderr names the v1 script `fetch-berachain-snapshot.js`. No silent v1 `index.csv` or v1 EL tarball fallback.
- [ ] **AC-11** `--type archive` does not restore `cl-archive`. `cl-archive` requires `--full-cl` (or the locked equivalent flag).

## Validation Criteria

- [ ] **VC-1** Shape: integration-shaped. Medium: terminal session. Live bepolia catalog. Lead sees the Step 1 print and the Step 2 restore: named dirs created empty, CL dir non-empty from the live `cl-pruned` object, and the EL side either populated or printed with its stderr skip line. Parade exhibit: terminal transcript per step. Steward drives this before Done; it is not first-run during the Lead's walk.

## Tracking

- **Task ref**: BERA-912
- **Task body (tracker)**: `briefs/fetch-berachain-snapshot-v2.md` under infra-vertical `$ARTIFACT_DIR`. Implement in `berachain/guides`.

## NOT in Scope

- Docs quickstart Step 6 rewrite: later PR after this script lands.
- Removing `/v2/docs.html` generator.
- Changing v1 `index.csv` publish or `fetch-berachain-snapshot.js`.
- Mainnet v2 publish enablement.
- Resume / skip-complete / retry-only-missing-side helper.
- **Allowed latitude**: `--full-cl` flag spelling; `--reth-bin` vs `RETH_BIN`; help text; fixture layout; test runner; whether `-y` is passed to `bera-reth download`.

## Error & Failure Map

- Catalog fetch fail / non-CSV / missing role: non-zero, no success.
- Target dir exists and is not empty: non-zero, do not write into it.
- CL curl or extract fail: non-zero; do not delete a successful EL dir.
- `bera-reth download` fail (binary found): non-zero; do not delete a successful CL dir.
- Binary missing: not an error; print EL command; stderr states EL was skipped.

## References

- `infra-snapshots/_worktrees/bare-metal/project/reference/storage-v2.md` — catalog and pairing authority
- https://github.com/berachain/berabox/pull/8 — merged `690fee9`; `RESTORE_PAIRING` on main matches this table; still not importable from this script
- https://github.com/berachain/guides/blob/main/apps/node-scripts/fetch-berachain-snapshot.js
- https://github.com/berachain/infra-snapshots/pull/44
