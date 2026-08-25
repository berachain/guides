# Proof Parade: fetch-berachain-snapshot-v2 (guides)

**Brief**: `project/briefs/fetch-berachain-snapshot-v2.md`
**Task**: BERA-912
**Date**: 2026-08-25
**Scaffold drafted by**: Steward
**Evidence captured by**: Implementor

<!-- Proof Parade: Lead-comprehension artifact. Evidence Index maps every AC and VC to What-landed and/or an Exhibit (not appendix-only). ACs: named tests. VCs: the surface driven live. Steward scaffolds contracts→slots; Implementor fills. -->

## Evidence Index

| Criterion | Planned evidence | Captured evidence | What it proves |
|---|---|---|---|
| AC-1 | What-landed + new script path | What landed § CLI; `apps/node-scripts/fetch-berachain-snapshot-v2.js` | v2 entrypoint exists |
| AC-2 | TP-6 byte identity | TP-6 named test | v1 script unchanged |
| AC-3 | TP-1 / TP-7 no `index.csv` | TP-1, TP-7 named tests | catalog roles only |
| AC-4 | TP-9 named dirs empty + TP-10 CL restore + TP-2 dirty fail; Exhibit Step 2 | TP-9, TP-10, TP-2; VC-1 Step 2 driver (Steward) | empty named dirs, restore into them, fail-closed dirty |
| AC-5 | TP-8 stub argv; never v1 EL tarball | TP-8, TP-4 | EL via `bera-reth download --manifest-url` |
| AC-6 | TP-4 | TP-4 | `--no-download` prints only |
| AC-7 | TP-5 exit 0 + stderr skip, TP-11 CL populated / EL empty; Exhibit Step 2 sub-exhibit | TP-5, TP-11; VC-1 Step 2 driver (Steward) | missing binary: skip EL, still restore CL |
| AC-8 | TP-2 | TP-2 | catalog/role/dirty named on stderr |
| AC-9 | this Parade | this file | CLI seam visible to Lead |
| AC-10 | TP-7 | TP-7 | mainnet fail-closed names v1 script |
| AC-11 | TP-1 `--type archive` vs `--full-cl` | TP-1 (archive + `--full-cl` rows) | CL archive is opt-in |
| TP-9 | named test: both dirs created empty | TP-9 | dir contract observed, not assumed |
| TP-10 | named test: CL curl/lz4/tar spy | TP-10 | CL pipeline really runs |
| TP-11 | named test: missing binary, CL populated | TP-11 | partial restore shape |
| VC-1 | Exhibit: terminal session, Step 1 print + Step 2 restore | **Pending Steward live capture** (drivers below) | live catalog; named dirs; CL restored |

Every AC and every VC gets an Index row whose Captured column points at **What landed** and/or an **Exhibit**. The Reproduction appendix is not a substitute for an Index row.

**AC captured evidence** is a named test. **VC captured evidence** is the thing itself, driven: a terminal session against the live catalog.

## What landed

- **New CLI (AC-1):** `apps/node-scripts/fetch-berachain-snapshot-v2.js` — flags: `--network mainnet|bepolia`, `--type pruned|archive` (EL preset only), `--output` (default `downloads`), `--catalog-url`, `--beacon-only`, `--el-only`, `--full-cl`, `--no-download`, `--reth-bin` / `RETH_BIN`. Default catalog: `https://bera-snapshots.fsn1.your-objectstorage.com/v2/<chain>/catalog.csv`.
- **Named dirs (AC-4):** `<output>/<network>-<type>-el` and `<output>/<network>-<type>-cl`; created empty before restore; non-empty existing path fails closed.
- **EL invoke (AC-5, AC-7):** `bera-reth download --chain <chain> --manifest-url <url> --datadir <el-dir> --minimal|--archive` when binary present; otherwise print command + stderr `bera-reth not found on PATH; EL restore was skipped`.
- **CL pairing (AC-11):** `--type` maps EL only (`pruned`→`--minimal`+`cl-pruned`, `archive`→`--archive`+`cl-pruned`); `--full-cl` selects `cl-archive`.
- **Mainnet (AC-10):** missing/failed v2 catalog exits non-zero; stderr names `fetch-berachain-snapshot.js`; no v1 fallback.

## Exhibits

### Exhibit: live catalog terminal session (VC-1)

**What the Lead should see/feel:** Step 1, `--no-download` against live `v2/bepolia/catalog.csv`, prints restore commands carrying the live URLs and the named dirs, creating nothing. Step 2, the default run into a temp `--output`, creates both named dirs empty and restores the live `cl-pruned` object into the CL dir. The EL side is captured either way: populated by `bera-reth download`, or printed with its stderr skip line while the CL dir is still non-empty.

**Maps to:** VC-1, AC-4, AC-6, AC-7
**Captured:** Pending Steward orchestration before Done. Runnable drivers are in Reproduction appendix; do not treat fixture/stub proof as VC-1 met.

```text
[Steward: capture Step 1 --no-download transcript + Step 2 restore transcript here]
```

## Reproduction appendix

- **Repository worktree:** `/Users/camembearbera/src/infrastructure/guides/_worktrees/BERA-912` (branch `feat/BERA-912`)
- **Named tests:** `node apps/node-scripts/test-fetch-berachain-snapshot-v2.js` (TP-1..TP-11)
- **VC drivers (Steward-owned, live catalog):**
  - **VC-1 Step 1:** `cd /Users/camembearbera/src/infrastructure/guides/_worktrees/BERA-912/apps/node-scripts && node fetch-berachain-snapshot-v2.js --network bepolia --no-download` — expect stdout with live manifest URL, live `cl-pruned` tarball URL, and named dirs under `downloads/`; no directories created under cwd.
  - **VC-1 Step 2:** `tmpdir=$(mktemp -d) && cd /Users/camembearbera/src/infrastructure/guides/_worktrees/BERA-912/apps/node-scripts && node fetch-berachain-snapshot-v2.js --network bepolia --output "$tmpdir/dl" && ls -la "$tmpdir/dl/bepolia-pruned-el" "$tmpdir/dl/bepolia-pruned-cl"` — expect both named dirs; CL dir non-empty after live extract; EL dir populated if `bera-reth` on PATH, else stderr skip line and printed EL command with empty EL dir.
- **Commands (non-battery):** live catalog URL `https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/catalog.csv`

## Known Gaps

- **VC-1** integration transcript not captured by Implementor; Steward drives Step 1/2 against live catalog before Done.
- Live `bera-reth download` of a full snapshot is not required in CI (TP-8 stub). When no binary is available, VC-1 Step 2 still proves the dir contract and the CL restore; the EL invoke rests on TP-8 argv rather than a live pull.
- Resume/skip-complete is out of scope; dirty-dir retry is fail-closed.
