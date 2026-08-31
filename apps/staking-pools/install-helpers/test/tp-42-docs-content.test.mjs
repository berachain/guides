import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(HERE, '..', 'README.md');

/**
 * installation.mdx lives in the sibling `docs` repo, not in this one — this
 * task's changes to it land on branch docs/staking-pool-install-cli. Try,
 * in order: an explicit override, that branch's worktree (this task's
 * amendment, while the docs PR is still open), then docs `main` (where the
 * same content lives once that PR merges). Skip rather than fail if none
 * of those resolve, since this repo alone can't guarantee docs is checked
 * out at all — same assumption the anvil harness already makes for
 * `contracts-staking-pools`.
 */
const INSTALLATION_MDX_CANDIDATES = [
  process.env.INSTALLATION_MDX_PATH,
  join(HERE, '../../../../../../../docs/_worktrees/staking-pool-install-cli/nodes/staking-pools/installation.mdx'),
  join(HERE, '../../../../../../../docs/nodes/staking-pools/installation.mdx'),
].filter(Boolean);
const INSTALLATION_MDX_PATH = INSTALLATION_MDX_CANDIDATES.find(existsSync);

const readme = readFileSync(README_PATH, 'utf8');
const haveInstallationMdx = Boolean(INSTALLATION_MDX_PATH);
const installationMdx = haveInstallationMdx ? readFileSync(INSTALLATION_MDX_PATH, 'utf8') : '';

describe('TP-11 README.md: no stale phrases, replacement language present', () => {
  it('Phase B: no mention of probing fee candidates; direct-read language present', () => {
    assert.ok(!/probe candidates/i.test(readme));
    assert.ok(!/tried up to 0\.01 BERA/i.test(readme));
    assert.ok(/read the current fee directly from the contract/i.test(readme));
    assert.ok(/getWithdrawalRequestFee/.test(readme));
  });

  it('Phase C: no stale "--finalize always needs an id" summary; finalize-all is documented as the no-id default', () => {
    assert.ok(!/`--finalize` calls `finalizeWithdrawalRequest`\.\s*Pass exactly one of those three/i.test(readme));
    assert.ok(/finalize every ready request/i.test(readme));
    assert.ok(/finalizeWithdrawalRequests\(uint256\[\]\)/.test(readme));
    assert.ok(/requestIds/.test(readme));
  });

  it('Phase A: signing preference is documented as a flag/env default, not a question', () => {
    assert.ok(!/asks.*ledger.*or.*(your own|private) key/i.test(readme));
    assert.ok(/--signing-preference key/.test(readme));
    assert.ok(/never asked for interactively|never.*read a key either way/i.test(readme));
  });

  it('Phase D: each of the five standalone commands documents the scenario-file fallback', () => {
    const scenarioMentions = readme.match(/scenario file/gi) ?? [];
    assert.ok(scenarioMentions.length >= 5, `expected >=5 scenario-file mentions, found ${scenarioMentions.length}`);
    assert.ok(/--scenario PATH/.test(readme));
  });
});

describe('TP-11 installation.mdx: no stale phrases, replacement language present', { skip: !haveInstallationMdx }, () => {
  it('Phase A: no mention of a signing-preference prompt being asked', () => {
    assert.ok(!/asks once.*whether you'?re signing with a Ledger/i.test(installationMdx));
    assert.ok(!/Ledger \[Enter\] or type key/i.test(installationMdx));
    assert.ok(/never asks which one you'?ll use/i.test(installationMdx));
  });

  it('Phase C: unstake example updated to finalize-all default, not a required id', () => {
    assert.ok(/unstake --finalize --from 0xHOLDER/.test(installationMdx));
  });

  it('Phase D: names the five scenario-file-fallback commands and deploy as the exception', () => {
    assert.ok(/scenario file `install` already wrote/i.test(installationMdx));
    assert.ok(/`deploy` is the one exception/i.test(installationMdx));
  });
});
