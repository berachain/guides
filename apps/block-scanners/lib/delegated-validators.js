/**
 * Parses a valrel-style delegated-validator CSV (Name, CometBFT Pubkey, ...)
 * and matches rows against live CL validators by BLS pubkey — the only
 * reliable key shared between the CSV and the CL /validators response.
 *
 * "CometBFT Pubkey" in valrel's export is the same compressed BLS12-381 G1
 * point used as `id` in berachain/metadata, NOT a derived CometBFT address.
 * Operator Address (an EVM address) lives in a different namespace and
 * cannot be compared to consensus addresses, so it is not used for matching.
 */

const fs = require('fs');
const { compressClPubkey } = require('./metadata-validators');

function splitCsvLine(line) {
  // Values in this export never contain commas (semicolons are used instead,
  // e.g. "DeFimans Co.; Ltd"), so a plain split is sufficient and avoids
  // pulling in a CSV dependency for one file format.
  return line.split(',').map((cell) => cell.trim());
}

function normalizePubkeyHex(value) {
  if (!value) return null;
  return value.replace(/^0x/i, '').toLowerCase();
}

function parseDelegatedValidatorsCsv(content) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const isHeader = header.includes('name') && header.some((h) => h.includes('pubkey') || h.includes('pub key'));
  const dataLines = isHeader ? lines.slice(1) : lines;

  const nameIdx = isHeader ? header.indexOf('name') : 0;
  const pubkeyIdx = isHeader
    ? header.findIndex((h) => h.includes('pubkey') || h.includes('pub key'))
    : 1;

  const rows = [];
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    const name = cells[nameIdx];
    const pubkeyHex = normalizePubkeyHex(cells[pubkeyIdx]);
    if (!name && !pubkeyHex) continue;
    rows.push({ name: name || null, pubkeyHex: pubkeyHex || null });
  }
  return rows;
}

/**
 * Loads a delegated-validator list from disk. Accepts either the valrel
 * CSV export (Name, CometBFT Pubkey, ...) or a plain-text list (one name or
 * pubkey/address per line) for ad-hoc filtering.
 *
 * Returns { byPubkey: Set<hex>, byName: Set<lowercase>, rows }.
 */
function loadDelegatedValidatorList(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const looksLikeCsv = content.split('\n', 1)[0].toLowerCase().includes('cometbft pubkey')
    || content.split('\n', 1)[0].toLowerCase().includes('pub key');

  const byPubkey = new Set();
  const byName = new Set();
  let rows = [];

  if (looksLikeCsv) {
    rows = parseDelegatedValidatorsCsv(content);
    for (const row of rows) {
      if (row.pubkeyHex) byPubkey.add(row.pubkeyHex);
      if (row.name) byName.add(row.name.toLowerCase());
    }
  } else {
    // Plain list: each line could be a name or a pubkey/address.
    for (const raw of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const normalized = normalizePubkeyHex(raw);
      if (/^[0-9a-f]{96}$/.test(normalized)) {
        byPubkey.add(normalized);
      } else {
        byName.add(raw.toLowerCase());
      }
      rows.push({ name: raw, pubkeyHex: null });
    }
  }

  return { byPubkey, byName, rows };
}

/**
 * Compresses a CL /validators pub_key (base64, BLS12-381 raw) to the same
 * hex form used by valrel's CometBFT Pubkey column and berachain/metadata.
 */
function compressedPubkeyHex(clValidator) {
  const compressed = compressClPubkey(clValidator.pub_key?.value ?? clValidator.pub_key);
  return compressed ? normalizePubkeyHex(compressed) : null;
}

module.exports = {
  parseDelegatedValidatorsCsv,
  loadDelegatedValidatorList,
  compressedPubkeyHex,
  normalizePubkeyHex,
};
