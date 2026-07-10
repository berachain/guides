#!/usr/bin/env node

/**
 * Sparkline view of validator vote participation over recent blocks.
 *
 * Makes chronically failing validators obvious: sort by misses, render a
 * per-block timeline (· = voted, x = missed).
 *
 * last_commit in block H records votes for block H-1.
 *
 * Usage: node validator-vote-sparklines.js [--blocks 100]
 */

const axios = require('axios');
const stringWidth = require('string-width');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { ValidatorNameDB, BlockFetcher, ConfigHelper } = require('./lib/shared-utils');
const { resolveValidatorNames, normalizeAddress: normalizeMetadataAddress } = require('./lib/metadata-validators');
const { loadDelegatedValidatorList, compressedPubkeyHex } = require('./lib/delegated-validators');

// Berachain mainnet CL RPC: flag 1 = absent, flags 4/5/6 = voted.
//
// Verified empirically 2026-07-09 against playground mainnet-snaps: sampled
// round-0 (no-retry) commits consistently show flag 5 carrying ~95% of total
// voting power. A round-0 commit requires >2/3 voting power to have signed,
// so the dominant flag must be "voted" — flag 5 cannot be "absent" (that
// would mean the network committed with ~5% participation, which is
// impossible). `verifyFlagQuorumInvariant` re-checks this at runtime so a
// future flag flip fails loudly instead of silently reporting everyone as
// offline (see git history: an earlier version of this file/HANDOFF.md had
// this exact inversion and it produced ~95% "miss" rates for every validator).
const ABSENT_FLAGS = new Set([1]);
const VOTED_FLAGS = new Set([4, 5, 6]);
const QUORUM_FRACTION = 2 / 3;
const VOTED = '·';
const MISSED = 'x';
const UNKNOWN = '?';
const BFT_ABSENT_THRESHOLD_PCT = 100 / 3;
const ABSENT_VP_SCALE_MIN = 20;
const ABSENT_VP_SCALE_MAX = 35;
const CONSENSUS_HEIGHT = 8;
const CONSENSUS_RAMP = ' ▏▎▍▌▋▊▉█';
const ROUND_OK = '·';
const ROUND_RETRY = 'X';
const THRESHOLD_MARK = '─';

function parseCommitRound(raw) {
  if (raw === undefined || raw === null) return 0;
  const value = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  return Number.isFinite(value) ? value : 0;
}

function computeAbsentVotingPowerPct(signatures, votingPowerData) {
  if (!Array.isArray(signatures) || !votingPowerData?.totalVotingPower) {
    return { absentPct: 0, absentPower: 0 };
  }

  let absentPower = 0;
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    if (!ABSENT_FLAGS.has(sig?.block_id_flag)) continue;
    const address = votingPowerData.addressByPosition.get(i);
    if (!address) continue;
    absentPower += votingPowerData.votingPowerByAddress.get(address) || 0;
  }

  const absentPct = (absentPower / votingPowerData.totalVotingPower) * 100;
  return { absentPct, absentPower };
}

function ratioToBftThreshold(absentPct) {
  if (BFT_ABSENT_THRESHOLD_PCT <= 0) return 0;
  return absentPct / BFT_ABSENT_THRESHOLD_PCT;
}

function ratioInDisplayBand(absentPct) {
  const span = ABSENT_VP_SCALE_MAX - ABSENT_VP_SCALE_MIN;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (absentPct - ABSENT_VP_SCALE_MIN) / span));
}

function overBftThreshold(absentPct) {
  return absentPct >= BFT_ABSENT_THRESHOLD_PCT;
}

function columnFillHeight(displayRatio) {
  if (displayRatio <= 0) return 0;
  if (displayRatio >= 1) return CONSENSUS_HEIGHT;
  return Math.max(1, Math.round(displayRatio * CONSENSUS_HEIGHT));
}

function verticalCellChar(entry, layerFromBottom, fillH) {
  if (layerFromBottom >= fillH) return ' ';
  if (entry.overThreshold) return '█';
  const frac = (layerFromBottom + 1) / Math.max(fillH, 1);
  const idx = Math.min(
    CONSENSUS_RAMP.length - 1,
    Math.max(1, Math.round(frac * (CONSENSUS_RAMP.length - 1))),
  );
  return CONSENSUS_RAMP[idx];
}

function colorizeVerticalCell(entry, layerFromBottom, fillH, colors) {
  const { cRed, cYellow, cGreen, cDim, cBold, cReset } = colors;
  const ch = verticalCellChar(entry, layerFromBottom, fillH);
  if (ch === ' ') return ' ';

  const r = entry.displayRatio;
  if (entry.overThreshold) {
    return `${cBold}${cRed}${ch}${cReset}`;
  }
  const layerPct = ABSENT_VP_SCALE_MIN + r * (ABSENT_VP_SCALE_MAX - ABSENT_VP_SCALE_MIN);
  if (layerPct >= BFT_ABSENT_THRESHOLD_PCT - 1 || r >= 0.85) {
    return `${cRed}${ch}${cReset}`;
  }
  if (layerPct >= BFT_ABSENT_THRESHOLD_PCT - 4 || r >= 0.55) {
    return `${cYellow}${ch}${cReset}`;
  }
  if (r >= 0.2) {
    return `${cGreen}${ch}${cReset}`;
  }
  return `${cDim}${ch}${cReset}`;
}

function consensusGlyphForRatio(ratio) {
  if (ratio >= 1) return '█';
  const idx = Math.min(
    CONSENSUS_RAMP.length - 1,
    Math.max(0, Math.round(ratio * (CONSENSUS_RAMP.length - 1))),
  );
  return CONSENSUS_RAMP[idx];
}

function buildConsensusTimeline(windows, votingPowerData) {
  return windows.map((window) => {
    const { absentPct } = computeAbsentVotingPowerPct(window.signatures, votingPowerData);
    const displayRatio = ratioInDisplayBand(absentPct);
    const bftRatio = ratioToBftThreshold(absentPct);
    const commitRound = parseCommitRound(window.commitRound);
    return {
      votedOnHeight: window.votedOnHeight,
      absentPct,
      displayRatio,
      bftRatio,
      overThreshold: overBftThreshold(absentPct),
      commitRound,
      roundRetry: commitRound >= 1,
      glyph: consensusGlyphForRatio(displayRatio),
    };
  });
}

function sparklinePrefixWidth(nameWidth = 24) {
  return nameWidth + 1 + 8 + 1 + 6 + 1 + 4 + 1 + 4 + 1;
}

async function getVotingPowerData(height, baseUrl) {
  const response = await axios.get(`${baseUrl}/validators?per_page=99&height=${height}`);
  const validators = response.data.result.validators;

  const votingPowerByAddress = new Map();
  const addressByPosition = new Map();
  const pubkeyHexByAddress = new Map();
  let totalVotingPower = 0;

  validators.forEach((validator, index) => {
    const power = parseInt(validator.voting_power, 10);
    votingPowerByAddress.set(validator.address, power);
    addressByPosition.set(index, validator.address);
    pubkeyHexByAddress.set(validator.address, compressedPubkeyHex(validator));
    totalVotingPower += power;
  });

  return {
    votingPowerByAddress,
    addressByPosition,
    pubkeyHexByAddress,
    totalVotingPower,
    blockHeight: height,
  };
}

/**
 * Runtime sanity check: on any round-0 (no-retry) commit, the voting power
 * behind VOTED_FLAGS must clear the BFT quorum. If it consistently doesn't,
 * ABSENT_FLAGS/VOTED_FLAGS are almost certainly assigned backwards.
 */
function verifyFlagQuorumInvariant(windows, votingPowerData) {
  const round0 = windows.filter((w) => (w.commitRound || 0) === 0);
  const sample = round0.slice(-Math.min(20, round0.length));
  if (sample.length === 0 || !votingPowerData.totalVotingPower) {
    return { checked: 0, failures: 0, ok: true };
  }

  let failures = 0;
  for (const window of sample) {
    let votedPower = 0;
    for (let i = 0; i < window.signatures.length; i++) {
      const sig = window.signatures[i];
      if (!VOTED_FLAGS.has(sig?.block_id_flag)) continue;
      const address = votingPowerData.addressByPosition.get(i);
      if (!address) continue;
      votedPower += votingPowerData.votingPowerByAddress.get(address) || 0;
    }
    if (votedPower / votingPowerData.totalVotingPower < QUORUM_FRACTION) failures++;
  }

  return { checked: sample.length, failures, ok: failures / sample.length < 0.5 };
}

function classifySlot(sig) {
  if (!sig) return 'unknown';
  if (ABSENT_FLAGS.has(sig.block_id_flag)) return 'missed';
  if (VOTED_FLAGS.has(sig.block_id_flag)) return 'voted';
  return 'unknown';
}

function slotChar(status) {
  if (status === 'voted') return VOTED;
  if (status === 'missed') return MISSED;
  return UNKNOWN;
}

function longestMissStreak(timeline) {
  let best = 0;
  let current = 0;
  for (const ch of timeline) {
    if (ch === MISSED) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function trailingMissStreak(timeline) {
  let streak = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i] !== MISSED) break;
    streak++;
  }
  return streak;
}

async function fetchCommitWindows(blockFetcher, headHeight, blockCount) {
  const windows = Math.min(blockCount, headHeight);
  const heights = [];
  for (let h = headHeight; h > headHeight - windows; h--) {
    heights.push(h);
  }

  const results = new Array(heights.length);
  const concurrency = 20;
  let index = 0;

  async function worker() {
    while (index < heights.length) {
      const i = index++;
      const height = heights[i];
      const blockData = await blockFetcher.getBlock(height);
      const block = blockData?.result?.block;
      if (!block) {
        throw new Error(`Failed to fetch block ${height}`);
      }
      results[i] = {
        commitHeight: height,
        votedOnHeight: height - 1,
        signatures: block.last_commit?.signatures || [],
        commitRound: block.last_commit?.round,
      };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Oldest block first (left → right sparkline).
  return results.reverse();
}

function recordBlock(validators, signatures, votingPowerData) {
  for (let i = 0; i < signatures.length; i++) {
    const address = votingPowerData.addressByPosition.get(i);
    if (!address) continue;

    const status = classifySlot(signatures[i]);
    if (!validators.has(address)) {
      validators.set(address, {
        address,
        pubkeyHex: votingPowerData.pubkeyHexByAddress.get(address) || null,
        timeline: [],
        misses: 0,
        votes: 0,
        votingPower: votingPowerData.votingPowerByAddress.get(address) || 0,
      });
    }

    const entry = validators.get(address);
    const ch = slotChar(status);
    entry.timeline.push(ch);
    if (status === 'missed') entry.misses++;
    else if (status === 'voted') entry.votes++;
  }
}

function isDeadValidator(row) {
  return row.opportunities > 0 && row.misses >= row.opportunities;
}

function isExitedValidator(row) {
  return (row.votingPower || 0) === 0;
}

function validatorCategory(entry) {
  const opportunities = entry.timeline.length;
  if (opportunities > 0 && entry.misses >= opportunities) return 'dead';
  if (entry.misses > 0) return 'partial';
  return 'perfect';
}

function resolveCategoryFilter(argv, hasFilterFile) {
  const explicit = argv.dead || argv.all;

  if (hasFilterFile && !explicit) {
    return { dead: true, partial: true, perfect: true };
  }
  if (argv.all) {
    return { dead: true, partial: true, perfect: true };
  }
  if (argv.dead) {
    return { dead: true, partial: false, perfect: false };
  }
  return { dead: true, partial: true, perfect: false };
}

function formatCategoryFilter(categories) {
  if (categories.dead && categories.partial && categories.perfect) return 'all';
  if (categories.dead && !categories.partial && !categories.perfect) return 'dead';
  if (categories.dead && categories.partial && !categories.perfect) return 'missed';
  const labels = [];
  if (categories.dead) labels.push('dead');
  if (categories.partial) labels.push('partial');
  if (categories.perfect) labels.push('perfect');
  return labels.join(' + ') || 'none';
}

function matchesCategory(entry, categories) {
  const cat = validatorCategory(entry);
  if (cat === 'dead') return categories.dead;
  if (cat === 'partial') return categories.partial;
  return categories.perfect;
}

async function buildSparklines({ baseUrl, blockCount, categories, activeOnly }) {
  const blockFetcher = new BlockFetcher(baseUrl);
  const headHeight = await blockFetcher.getCurrentBlock();
  if (!headHeight) {
    throw new Error('Failed to fetch latest block height');
  }

  const windows = await fetchCommitWindows(blockFetcher, headHeight, blockCount);
  const votingPowerData = await getVotingPowerData(headHeight, baseUrl);

  const validators = new Map();
  for (const window of windows) {
    recordBlock(validators, window.signatures, votingPowerData);
  }

  const rows = Array.from(validators.values())
    .filter((v) => matchesCategory(v, categories))
    .filter((v) => !activeOnly || v.votingPower > 0)
    .map((v) => {
      const opportunities = v.timeline.length;
      const missRatePct = opportunities > 0 ? (v.misses / opportunities) * 100 : 0;
      return {
        ...v,
        opportunities,
        missRatePct,
        dead: v.misses >= opportunities && opportunities > 0,
        exited: (v.votingPower || 0) === 0,
        longestStreak: longestMissStreak(v.timeline),
        trailingStreak: trailingMissStreak(v.timeline),
        sparkline: v.timeline.join(''),
      };
    })
    .sort((a, b) => {
      if (b.trailingStreak !== a.trailingStreak) return b.trailingStreak - a.trailingStreak;
      if (b.misses !== a.misses) return b.misses - a.misses;
      return b.missRatePct - a.missRatePct;
    });

  return {
    headHeight,
    blockCount: windows.length,
    startBlock: windows[0]?.votedOnHeight ?? null,
    endBlock: windows[windows.length - 1]?.votedOnHeight ?? null,
    validatorsShown: rows.length,
    categories,
    activeOnly,
    windows,
    consensusTimeline: buildConsensusTimeline(windows, votingPowerData),
    flagQuorumCheck: verifyFlagQuorumInvariant(windows, votingPowerData),
    rows, // Sliced to --top in main(), after filtering.
  };
}

function formatValidatorLabel(name, row) {
  let label = name;
  if (isExitedValidator(row)) label = `${label} (out)`;
  if (isDeadValidator(row)) label = `† ${label}`;
  return label;
}

function pad(str, width) {
  const s = String(str);
  if (s.length >= width) return s.slice(0, width);
  return s.padEnd(width, ' ');
}

function truncateToDisplayWidth(str, width) {
  if (width <= 0) return '';
  if (stringWidth(str) <= width) return str;

  let result = '';
  for (const char of str) {
    const next = result + char;
    const nextWidth = stringWidth(next);
    if (nextWidth > width) {
      if (width >= 1 && stringWidth(`${result}…`) <= width) {
        return `${result}…`;
      }
      return result;
    }
    result = next;
  }
  return result;
}

function padDisplay(str, width) {
  const s = truncateToDisplayWidth(String(str), width);
  let padding = Math.max(0, width - stringWidth(s));
  // Flag sequences (regional indicators) render one column wider than string-width reports.
  if (/\p{Regional_Indicator}/u.test(s)) {
    padding += 1;
  }
  return s + ' '.repeat(padding);
}

function printConsensusStrip(consensusTimeline, nameWidth = 24) {
  if (!consensusTimeline?.length) return;

  const cRed = '\x1b[31m';
  const cGreen = '\x1b[32m';
  const cYellow = '\x1b[33m';
  const cDim = '\x1b[2m';
  const cBold = '\x1b[1m';
  const cReset = '\x1b[0m';
  const colors = { cRed, cYellow, cGreen, cDim, cBold, cReset };

  const prefix = sparklinePrefixWidth(nameWidth);

  // Top guide: 33% BFT line (~87% up the 20–35% band).
  const thresholdRow = consensusTimeline.map((entry) => {
    if (entry.overThreshold) {
      return `${cBold}${cRed}${THRESHOLD_MARK}${cReset}`;
    }
    return `${cDim}${THRESHOLD_MARK}${cReset}`;
  }).join('');
  console.log(`${pad('33% BFT', prefix)}${thresholdRow}`);

  // Vertical tanks: 20% = empty, 35% = full (zoom on danger band).
  for (let layer = CONSENSUS_HEIGHT - 1; layer >= 0; layer--) {
    const label = layer === CONSENSUS_HEIGHT - 1 ? pad('20–35% VP', prefix) : pad('', prefix);
    const cells = consensusTimeline.map((entry) => {
      const fillH = columnFillHeight(entry.displayRatio);
      return colorizeVerticalCell(entry, layer, fillH, colors);
    }).join('');
    console.log(`${label}${cells}`);
  }

  // Round retry row: X when block n+1 last_commit.round ≥ 1.
  const roundRow = consensusTimeline.map((entry) => {
    if (entry.roundRetry) {
      return `${cBold}${cRed}${ROUND_RETRY}${cReset}`;
    }
    return `${cDim}${ROUND_OK}${cReset}`;
  }).join('');
  console.log(`${pad('ROUND≥1', prefix)}${roundRow}`);

  const peak = consensusTimeline.reduce(
    (best, entry) => (entry.absentPct > best.absentPct ? entry : best),
    consensusTimeline[0],
  );
  const roundRetries = consensusTimeline.filter((entry) => entry.roundRetry).length;
  const minAbsent = Math.min(...consensusTimeline.map((e) => e.absentPct));
  const aboveScale = minAbsent > ABSENT_VP_SCALE_MAX;

  console.log(
    `${cDim}Peak absent VP: ${peak.absentPct.toFixed(1)}% · scale ${ABSENT_VP_SCALE_MIN}–${ABSENT_VP_SCALE_MAX}% · `
    + `Round retries: ${roundRetries}/${consensusTimeline.length}${cReset}`,
  );
  if (aboveScale) {
    console.log(
      `${cDim}All blocks above scale ceiling (${minAbsent.toFixed(1)}% min) — columns pegged; gradation appears when absent VP enters ${ABSENT_VP_SCALE_MIN}–${ABSENT_VP_SCALE_MAX}%.${cReset}`,
    );
  }
  console.log('');
}

function printReport(result, nameByAddress, chainName, { showConsensus, filterLabel } = {}) {
  const cRed = '\x1b[31m';
  const cGreen = '\x1b[32m';
  const cYellow = '\x1b[33m';
  const cBold = '\x1b[1m';
  const cReset = '\x1b[0m';

  function colorizeSparkline(sparkline) {
    let colored = '';
    for (const char of sparkline) {
      if (char === VOTED) colored += `${cGreen}${char}${cReset}`;
      else if (char === MISSED) colored += `${cRed}${char}${cReset}`;
      else colored += `${cYellow}${char}${cReset}`;
    }
    return colored;
  }

  console.log(`Chain: ${chainName}`);
  console.log(`Head: ${result.headHeight}`);
  console.log(`Window: ${result.blockCount} blocks (${result.startBlock} → ${result.endBlock}, old → new)`);
  if (filterLabel) {
    console.log(`Filter: ${filterLabel}`);
  }
  console.log(`Showing: ${formatCategoryFilter(result.categories)}${result.activeOnly ? ' (active set)' : ''}: ${result.validatorsShown}`);
  const deadCount = result.rows.filter((row) => row.dead).length;
  if (deadCount > 0) {
    console.log(`Dead (100% miss in window): ${deadCount}`);
  }
  if (result.flagQuorumCheck && !result.flagQuorumCheck.ok) {
    console.log(
      `${cBold}${cRed}⚠ SANITY CHECK FAILED: voted-flag voting power missed BFT quorum on `
      + `${result.flagQuorumCheck.failures}/${result.flagQuorumCheck.checked} round-0 blocks sampled. `
      + `ABSENT_FLAGS/VOTED_FLAGS are likely inverted — do not trust these results.${cReset}`,
    );
  }

  const nowStreaking = result.rows.filter((row) => row.trailingStreak > 0);
  if (filterLabel) {
    if (nowStreaking.length > 0) {
      console.log(
        `${cBold}${cRed}⚠ ${nowStreaking.length} of ${result.rows.length} watched validators are mid-miss-streak right now.${cReset}`,
      );
    } else {
      console.log(`${cGreen}✓ No watched validators are currently missing votes.${cReset}`);
    }
  }
  console.log(`Legend: ${cGreen}${VOTED} voted${cReset}   ${cRed}${MISSED} missed${cReset}   ${cYellow}${UNKNOWN} unknown${cReset}   † dead`);
  console.log('');

  const nameWidth = 24;
  if (showConsensus) {
    printConsensusStrip(result.consensusTimeline, nameWidth);
  }

  if (result.rows.length === 0) {
    console.log('No validators match the selected categories in this window.');
    return;
  }

  console.log(
    `${padDisplay('VALIDATOR', nameWidth)} ${pad('MISS', 8)} ${pad('RATE', 6)} ${pad('MAX', 4)} ${pad('NOW', 4)} SPARKLINE`
  );
  console.log('-'.repeat(nameWidth + 8 + 6 + 4 + 4 + 2 + result.blockCount));

  for (const row of result.rows) {
    const baseName = nameByAddress.get(normalizeMetadataAddress(row.address)) || row.address.slice(0, 12);
    const name = formatValidatorLabel(baseName, row);
    const missLabel = `${row.misses}/${row.opportunities}`;
    const rateLabel = `${row.missRatePct.toFixed(0)}%`;
    const nameCell = row.dead
      ? `${cRed}${padDisplay(name, nameWidth)}${cReset}`
      : padDisplay(name, nameWidth);
    const nowCell = row.trailingStreak > 0
      ? `${cBold}${cRed}${pad(row.trailingStreak, 4)}${cReset}`
      : pad(row.trailingStreak, 4);
    console.log(
      `${nameCell} ${pad(missLabel, 8)} ${pad(rateLabel, 6)} ${pad(row.longestStreak, 4)} ${nowCell} ${colorizeSparkline(row.sparkline)}`
    );
  }
}

function buildArgv() {
  return yargs(hideBin(process.argv))
    .scriptName('validator-vote-sparklines')
    .usage('$0 [options]')
    .option('blocks', {
      alias: 'b',
      type: 'number',
      default: 100,
      describe: 'Number of recent blocks in each sparkline',
    })
    .option('chain', {
      alias: 'c',
      type: 'string',
      default: 'mainnet',
      choices: ['mainnet', 'bepolia'],
      describe: 'Network to scan',
    })
    .option('dead', {
      type: 'boolean',
      describe: 'Show only dead validators (100% miss in window, marked †)',
    })
    .option('all', {
      type: 'boolean',
      describe: 'Show entire active set, including perfect voters (0 misses)',
    })
    .option('all-validators', {
      type: 'boolean',
      default: false,
      describe: 'Include exited validators (voting_power=0)',
    })
    .option('top', {
      alias: 'n',
      type: 'number',
      default: 30,
      describe: 'Maximum validators to print',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'JSON output',
    })
    .option('filter-file', {
      type: 'string',
      describe: 'Watch only these validators: a valrel delegated_validators.csv export (matched by BLS pubkey) or a plain-text list of names/pubkeys (one per line). Shows the full watched roster unless category flags are set.',
    })
    .option('consensus', {
      type: 'boolean',
      default: false,
      describe: 'Also print the network-wide absent-voting-power/BFT-threshold strip (off by default; unrelated to per-validator tracking)',
    })
    .option('alert-on-streak', {
      type: 'number',
      describe: 'Exit 1 if any watched validator has a current (NOW) miss streak ≥ N (for cron/alerting; use with --filter-file)',
    })
    .example('$0', 'Validators with any miss in the last 100 blocks')
    .example('$0 --dead', 'Only validators that missed every block')
    .example('$0 --all', 'Full active set, including perfect voters')
    .example('$0 --filter-file delegated_validators.csv', 'Valrel: full status of a watched validator roster')
    .strict()
    .help()
    .alias('help', 'h')
    .argv;
}

async function main() {
  const argv = buildArgv();
  const chainConfig = ConfigHelper.getChainConfig(argv.chain);
  const baseUrl = ConfigHelper.getBlockScannerUrl(argv.chain);

  let delegatedList = null;
  if (argv['filter-file']) {
    try {
      delegatedList = loadDelegatedValidatorList(argv['filter-file']);
    } catch (e) {
      console.error(`Failed to read filter file: ${e.message}`);
      process.exit(1);
    }
  }

  const categories = resolveCategoryFilter(argv, !!delegatedList);

  const result = await buildSparklines({
    baseUrl,
    blockCount: argv.blocks,
    categories,
    activeOnly: !argv['all-validators'],
  });

  if (!argv.json && !result.flagQuorumCheck.ok) {
    console.error(
      `WARNING: flag-quorum sanity check failed on ${result.flagQuorumCheck.failures}/${result.flagQuorumCheck.checked} `
      + 'round-0 blocks. ABSENT_FLAGS/VOTED_FLAGS may be inverted; results below may be nonsense.',
    );
  }

  if (delegatedList) {
    result.rows = result.rows.filter((row) => {
      const pubkeyMatch = row.pubkeyHex && delegatedList.byPubkey.has(row.pubkeyHex);
      return pubkeyMatch;
    });
    // Pubkey-only pass first (robust); fall back to name matching for rows
    // whose pubkey didn't resolve (metadata/RPC hiccup) using resolved names.
  }

  const validatorDB = new ValidatorNameDB();
  const addresses = result.rows.map((row) => row.address);
  const { names: nameByAddress, metadataSource } = await resolveValidatorNames(
    argv.chain,
    baseUrl,
    result.headHeight,
    addresses,
    { validatorDB },
  );

  let filterLabel = null;
  if (delegatedList) {
    filterLabel = `${argv['filter-file']} (${delegatedList.byPubkey.size || delegatedList.byName.size} watched validators, matched by BLS pubkey)`;
  }

  // Now apply top slicing
  result.rows = result.rows.slice(0, argv.top);

  if (!argv.json && metadataSource) {
    console.error(`Names: berachain/metadata (${metadataSource})`);
  }

  const alertThreshold = argv['alert-on-streak'];
  const breachingRows = alertThreshold !== undefined
    ? result.rows.filter((row) => row.trailingStreak >= alertThreshold)
    : [];

  if (argv.json) {
    const payload = {
      chain: argv.chain,
      chain_name: chainConfig.name,
      rpc_url: baseUrl,
      head_height: result.headHeight,
      block_count: result.blockCount,
      start_block: result.startBlock,
      end_block: result.endBlock,
      legend: { voted: VOTED, missed: MISSED, unknown: UNKNOWN },
      filter_file: argv['filter-file'] || null,
      categories: formatCategoryFilter(categories),
      flag_quorum_check: result.flagQuorumCheck,
      ...(argv.consensus ? {
        consensus: result.consensusTimeline.map((entry) => ({
          block: entry.votedOnHeight,
          absent_vp_pct: Number(entry.absentPct.toFixed(2)),
          display_ratio_20_35: Number(entry.displayRatio.toFixed(3)),
          bft_ratio: Number(entry.bftRatio.toFixed(3)),
          over_33pct_threshold: entry.overThreshold,
          commit_round: entry.commitRound,
          round_retry: entry.roundRetry,
        })),
      } : {}),
      rows: result.rows.map((row) => ({
        address: row.address,
        name: nameByAddress.get(normalizeMetadataAddress(row.address)) || null,
        misses: row.misses,
        opportunities: row.opportunities,
        miss_rate_pct: Number(row.missRatePct.toFixed(2)),
        dead: row.dead,
        exited: row.exited,
        longest_miss_streak: row.longestStreak,
        trailing_miss_streak: row.trailingStreak,
        sparkline: row.sparkline,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printReport(result, nameByAddress, chainConfig.name, { showConsensus: argv.consensus, filterLabel });
  }

  if (alertThreshold !== undefined && breachingRows.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`validator-vote-sparklines failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  ABSENT_FLAGS,
  MISSED,
  VOTED,
  buildConsensusTimeline,
  buildSparklines,
  columnFillHeight,
  formatCategoryFilter,
  longestMissStreak,
  matchesCategory,
  padDisplay,
  resolveCategoryFilter,
  validatorCategory,
  verifyFlagQuorumInvariant,
  printConsensusStrip,
  trailingMissStreak,
};
