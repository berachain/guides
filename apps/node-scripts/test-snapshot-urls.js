#!/usr/bin/env node
/**
 * Snapshot URL health test.
 *
 * For each network (mainnet, testnet) and each snapshot type, resolves the
 * effective download URL (preferring url_s3 over url), then verifies it is
 * reachable. By default it issues a HEAD request; with --download it pulls
 * 1 MB of data (or kills the connection after 20 seconds, whichever comes
 * first).
 *
 * Usage:
 *   node test-snapshot-urls.js            # HEAD-only (fast)
 *   node test-snapshot-urls.js --download # pull 1 MB / 20 s cap
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DOWNLOAD_MODE = process.argv.includes('--download');
const DOWNLOAD_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MB
const DOWNLOAD_TIMEOUT_MS = 20_000;

const INDEXES = {
    mainnet: 'https://snapshots.berachain.com/index.csv',
    testnet: 'https://bepolia.snapshots.berachain.com/index.csv',
};

const TYPES = [
    'beacon-kit-pruned',
    'beacon-kit-archive',
    'reth-pruned',
    'reth-archive',
];

// ── helpers ────────────────────────────────────────────────────────────────

function get(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        mod.get(url, resolve).on('error', reject);
    });
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        get(url).then(res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        }).catch(reject);
    });
}

function parseIndex(csv) {
    const lines = csv.trim().split('\n');
    const header = lines[0].split(',');
    const col = k => header.indexOf(k);

    const iType = col('type');
    const iUrl = col('url');
    const iS3 = col('url_s3');
    const iCreated = col('created_at');

    const latest = {};
    for (let i = 1; i < lines.length; i++) {
        const f = lines[i].trim().split(',');
        if (!f[iType]) continue;
        const type = f[iType];
        const created = f[iCreated];
        const url = f[iUrl];
        const s3 = iS3 !== -1 ? f[iS3] : '';
        const effective = s3 || url;
        const source = s3 ? 's3' : 'cdn';
        if (!latest[type] || created > latest[type].created) {
            latest[type] = { url, s3, effective, source, created };
        }
    }
    return latest;
}

// ── verification ───────────────────────────────────────────────────────────

function checkHead(url) {
    return new Promise((resolve) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(url, { method: 'HEAD' }, res => {
            res.resume();
            resolve({ ok: res.statusCode < 400, status: res.statusCode });
        });
        req.on('error', err => resolve({ ok: false, status: err.message }));
        req.setTimeout(15_000, () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
        req.end();
    });
}

function checkDownload(url) {
    return new Promise((resolve) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        let received = 0;
        let status = null;

        const req = mod.get(url, res => {
            status = res.statusCode;
            if (status >= 400) {
                res.resume();
                resolve({ ok: false, status, received: 0 });
                return;
            }
            res.on('data', chunk => {
                received += chunk.length;
                if (received >= DOWNLOAD_LIMIT_BYTES) {
                    req.destroy();
                    resolve({ ok: true, status, received });
                }
            });
            res.on('end', () => resolve({ ok: true, status, received }));
            res.on('error', err => resolve({ ok: false, status: err.message, received }));
        });

        req.on('error', err => {
            // destroyed intentionally after limit — treat as ok if we got data
            if (received >= DOWNLOAD_LIMIT_BYTES) {
                resolve({ ok: true, status, received });
            } else {
                resolve({ ok: false, status: err.message, received });
            }
        });

        const timer = setTimeout(() => {
            req.destroy();
            resolve({ ok: received > 0, status: `timeout@${received}b`, received });
        }, DOWNLOAD_TIMEOUT_MS);

        req.on('close', () => clearTimeout(timer));
    });
}

// ── formatting ─────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const DIM  = s => `\x1b[2m${s}\x1b[0m`;
const BOLD = s => `\x1b[1m${s}\x1b[0m`;

function fmtBytes(n) {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

// ── check with fallback ────────────────────────────────────────────────────

async function checkWithFallback(entry) {
    const check = DOWNLOAD_MODE ? checkDownload : checkHead;
    const candidates = [];

    if (entry.s3) candidates.push({ url: entry.s3, label: 's3 ' });
    if (entry.url && entry.url !== entry.s3) candidates.push({ url: entry.url, label: 'cdn' });

    for (const candidate of candidates) {
        const result = await check(candidate.url);
        if (result.ok) return { ...result, url: candidate.url, label: candidate.label, fellBack: candidate.label !== 's3 ' };
        // log the failed attempt inline
        const statusStr = typeof result.status === 'number' ? `HTTP ${result.status}` : result.status;
        console.log(`       ${FAIL} ${candidate.label} ${statusStr} — trying next`);
        console.log(`           ${DIM(candidate.url)}`);
    }

    // all candidates failed — report last one
    const last = candidates[candidates.length - 1];
    const result = await check(last.url);
    return { ...result, url: last.url, label: last.label, fellBack: false };
}

// ── main ───────────────────────────────────────────────────────────────────

async function run() {
    console.log(BOLD('\nSnapshot URL Health Test'));
    console.log(`Mode: ${DOWNLOAD_MODE ? `download (1 MB cap / ${DOWNLOAD_TIMEOUT_MS / 1000}s timeout)` : 'HEAD only'}`);
    console.log('');

    let failures = 0;

    for (const [network, indexUrl] of Object.entries(INDEXES)) {
        console.log(BOLD(`── ${network} (${indexUrl})`));

        let index;
        try {
            const csv = await fetchText(indexUrl);
            index = parseIndex(csv);
        } catch (err) {
            console.log(`  ${FAIL} Failed to fetch index: ${err.message}`);
            failures++;
            continue;
        }

        for (const type of TYPES) {
            const entry = index[type];
            if (!entry) {
                console.log(`  ${FAIL} ${type}: not found in index`);
                failures++;
                continue;
            }

            const result = await checkWithFallback(entry);

            const icon = result.ok ? PASS : FAIL;
            const extra = DOWNLOAD_MODE ? ` ${DIM(fmtBytes(result.received))}` : '';
            const statusStr = typeof result.status === 'number' ? `HTTP ${result.status}` : result.status;
            const fallbackNote = result.fellBack ? ` \x1b[33m(fell back to cdn)\x1b[0m` : '';

            console.log(`  ${icon} ${type.padEnd(22)} [${result.label}] ${statusStr}${extra}${fallbackNote}`);
            console.log(`       ${DIM(result.url)}`);

            if (!result.ok) failures++;
        }

        console.log('');
    }

    if (failures === 0) {
        console.log(`${PASS} All checks passed.\n`);
        process.exit(0);
    } else {
        console.log(`${FAIL} ${failures} check(s) failed.\n`);
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
