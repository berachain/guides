#!/usr/bin/env node

/**
 * Berachain storage v2 snapshot restore helper.
 * Reads v2 catalog.csv, creates named empty datadirs, restores CL via curl|lz4|tar
 * and EL via bera-reth download --manifest-url.
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const DEFAULT_OUTPUT = 'downloads';
const V2_HEADER = [
    'type',
    'layer',
    'profile',
    'block_number',
    'size_bytes',
    'created_at',
    'object_key',
    'download_url',
    'role',
];
const VALID_ROLES = new Set(['el-manifest', 'cl-pruned', 'cl-archive']);

const RESTORE_PAIRING = {
    pruned: { elPreset: '--minimal', clRole: 'cl-pruned' },
    archive: { elPreset: '--archive', clRole: 'cl-pruned' },
};

function defaultCatalogUrl(network) {
    return `https://bera-snapshots.fsn1.your-objectstorage.com/v2/${network}/catalog.csv`;
}

function rethChainName(network) {
    return network === 'bepolia' ? 'bepolia' : network;
}

// Matches env.sh / setup-reth.sh / run-reth.sh: CHAIN is the Quickstart's
// established way to pick a network. --network/-n still overrides it below.
function defaultNetwork() {
    const envChain = process.env.CHAIN;
    if (envChain === 'mainnet' || envChain === 'bepolia') {
        return envChain;
    }
    return 'mainnet';
}

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        network: defaultNetwork(),
        snapshotType: 'pruned',
        outputDir: DEFAULT_OUTPUT,
        catalogUrl: null,
        beaconOnly: false,
        elOnly: false,
        fullCl: false,
        noDownload: false,
        rethBin: process.env.RETH_BIN || null,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
            case '--network':
            case '-n':
                if (i + 1 >= args.length) {
                    console.error('Error: --network requires a value (mainnet or bepolia)');
                    process.exit(1);
                }
                {
                    const val = args[++i];
                    if (!['mainnet', 'bepolia'].includes(val)) {
                        console.error('Error: --network must be "mainnet" or "bepolia"');
                        process.exit(1);
                    }
                    config.network = val;
                }
                break;
            case '--type':
            case '-t':
                if (i + 1 >= args.length) {
                    console.error('Error: --type requires a value (pruned or archive)');
                    process.exit(1);
                }
                config.snapshotType = args[++i];
                break;
            case '--output':
            case '-o':
                if (i + 1 >= args.length) {
                    console.error('Error: --output requires a directory path');
                    process.exit(1);
                }
                config.outputDir = args[++i];
                break;
            case '--catalog-url':
                if (i + 1 >= args.length) {
                    console.error('Error: --catalog-url requires a URL');
                    process.exit(1);
                }
                config.catalogUrl = args[++i];
                break;
            case '--reth-bin':
                if (i + 1 >= args.length) {
                    console.error('Error: --reth-bin requires a path');
                    process.exit(1);
                }
                config.rethBin = args[++i];
                break;
            case '--beacon-only':
                config.beaconOnly = true;
                break;
            case '--execution-only':
            case '--el-only':
                config.elOnly = true;
                break;
            case '--full-cl':
                config.fullCl = true;
                break;
            case '--no-download':
                config.noDownload = true;
                break;
            default:
                console.error(`Error: Unknown option ${arg}`);
                showHelp();
                process.exit(1);
        }
    }

    if (config.beaconOnly && config.elOnly) {
        console.error('Error: use only one of --beacon-only and --execution-only');
        process.exit(1);
    }
    if (!['pruned', 'archive'].includes(config.snapshotType)) {
        console.error('Error: type must be either "pruned" or "archive"');
        process.exit(1);
    }

    if (!config.catalogUrl) {
        config.catalogUrl = defaultCatalogUrl(config.network);
    }

    return config;
}

function showHelp() {
    const defBepolia = defaultCatalogUrl('bepolia');
    const defMainnet = defaultCatalogUrl('mainnet');
    console.log(`
Bera Snapshot Downloader (storage v2)

Restores beacon-kit and execution snapshots from the storage v2 catalog.csv.
Requires Node.js 18+, curl on PATH, lz4 and tar for CL extract, and optionally bera-reth for EL.

Usage: node fetch-berachain-snapshot-v2.js [options]

Options:
  -n, --network <network>     mainnet or bepolia (default: $CHAIN env var, or mainnet)
  -t, --type <type>           pruned or archive — EL preset only (default: pruned)
  -o, --output <dir>          parent directory for named datadirs (default: downloads)
      --catalog-url <url>     override catalog.csv URL
      --beacon-only           CL restore only
      --execution-only, --el-only
                              EL restore only
      --full-cl               select cl-archive instead of cl-pruned
      --no-download           print restore commands only
      --reth-bin <path>       bera-reth binary (default: PATH or RETH_BIN)
  -h, --help                  show this help

Catalog CSV: ${defMainnet} (mainnet), ${defBepolia} (bepolia)

Named directories under --output:
  <network>-<type>-el   execution datadir
  <network>-<type>-cl   consensus datadir
`);
}

function parseCatalog(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('catalog is empty or invalid');
    }

    const header = lines[0].split(',');
    if (header.length !== V2_HEADER.length || header.some((col, idx) => col !== V2_HEADER[idx])) {
        throw new Error(
            `invalid catalog header: expected ${V2_HEADER.join(',')}, got ${header.join(',')}`,
        );
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = line.split(',');
        if (fields.length !== V2_HEADER.length) {
            throw new Error(`catalog line ${i + 1}: expected ${V2_HEADER.length} columns`);
        }
        const row = {
            type: fields[0],
            layer: fields[1],
            profile: fields[2],
            blockNumber: fields[3],
            sizeBytes: fields[4],
            createdAt: fields[5],
            objectKey: fields[6],
            downloadUrl: fields[7],
            role: fields[8],
        };
        if (!VALID_ROLES.has(row.role)) {
            throw new Error(`catalog line ${i + 1}: invalid role ${row.role}`);
        }
        rows.push(row);
    }
    return rows;
}

function selectByRole(rows, role) {
    const matches = rows.filter((row) => row.role === role);
    if (matches.length !== 1) {
        throw new Error(`expected exactly one catalog row with role ${role}, found ${matches.length}`);
    }
    return matches[0];
}

function resolvePairing(config) {
    const base = RESTORE_PAIRING[config.snapshotType];
    const clRole = config.fullCl ? 'cl-archive' : base.clRole;
    return { elPreset: base.elPreset, clRole };
}

function namedDirs(config) {
    const base = path.resolve(config.outputDir);
    const suffix = `${config.network}-${config.snapshotType}`;
    return {
        elDir: path.join(base, `${suffix}-el`),
        clDir: path.join(base, `${suffix}-cl`),
    };
}

async function fetchText(url) {
    if (url.startsWith('file://')) {
        try {
            return fs.readFileSync(new URL(url), 'utf8');
        } catch (err) {
            throw new Error(err.message);
        }
    }
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`catalog request failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
}

function dirHasEntries(dirPath) {
    return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0;
}

function ensureEmptyDir(dirPath) {
    if (fs.existsSync(dirPath)) {
        if (dirHasEntries(dirPath)) {
            throw new Error(`target directory is not empty: ${dirPath}`);
        }
        return;
    }
    fs.mkdirSync(dirPath, { recursive: true });
}

function findRethBin(config) {
    if (config.rethBin) {
        try {
            fs.accessSync(config.rethBin, fs.constants.X_OK);
            return config.rethBin;
        } catch {
            return null;
        }
    }
    try {
        const found = child_process
            .execSync('command -v bera-reth', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            })
            .trim();
        return found || null;
    } catch {
        return null;
    }
}

function buildElCommand(config, manifestUrl, elDir, elPreset) {
    const chain = rethChainName(config.network);
    return `bera-reth download --chain ${chain} --manifest-url ${manifestUrl} --datadir ${elDir} ${elPreset}`;
}

function buildClCommand(clUrl, clDir, forDownload) {
    const curlFlags = forDownload ? '-L -C - -fsSL' : '-fsSL';
    return `curl ${curlFlags} ${clUrl} | lz4 -d | tar -x -C ${clDir}`;
}

function runClRestore(clUrl, clDir) {
    const cmd = `${buildClCommand(clUrl, clDir, true)}`;
    child_process.execSync(cmd, { stdio: 'inherit', shell: true });
}

function runElDownload(rethBin, config, manifestUrl, elDir, elPreset) {
    const chain = rethChainName(config.network);
    child_process.execSync(
        `"${rethBin}" download --chain ${chain} --manifest-url ${manifestUrl} --datadir ${elDir} ${elPreset}`,
        { stdio: 'inherit', shell: true },
    );
}

async function main() {
    const config = parseArgs();
    const { elPreset, clRole } = resolvePairing(config);
    const dirs = namedDirs(config);

    let catalogText;
    try {
        catalogText = await fetchText(config.catalogUrl);
    } catch (err) {
        if (config.network === 'mainnet') {
            console.error(
                `Error: storage v2 catalog unavailable for mainnet (${err.message}). Use fetch-berachain-snapshot.js for v1 snapshots.`,
            );
            process.exit(1);
        }
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    let rows;
    try {
        rows = parseCatalog(catalogText);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    let elManifest;
    let clRow;
    try {
        elManifest = selectByRole(rows, 'el-manifest');
        clRow = selectByRole(rows, clRole);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    const restoreEl = !config.beaconOnly;
    const restoreCl = !config.elOnly;

    if (config.noDownload) {
        if (restoreEl) {
            console.log(buildElCommand(config, elManifest.downloadUrl, dirs.elDir, elPreset));
        }
        if (restoreCl) {
            console.log(buildClCommand(clRow.downloadUrl, dirs.clDir, false));
        }
        process.exit(0);
    }

    if (restoreEl) {
        ensureEmptyDir(dirs.elDir);
    }
    if (restoreCl) {
        ensureEmptyDir(dirs.clDir);
    }

    if (restoreCl) {
        try {
            runClRestore(clRow.downloadUrl, dirs.clDir);
        } catch (err) {
            console.error(`Error: CL restore failed: ${err.message}`);
            process.exit(1);
        }
    }

    if (restoreEl) {
        const rethBin = findRethBin(config);
        if (!rethBin) {
            console.error('Warning: bera-reth not found on PATH; EL restore was skipped');
            console.log(buildElCommand(config, elManifest.downloadUrl, dirs.elDir, elPreset));
        } else {
            try {
                runElDownload(rethBin, config, elManifest.downloadUrl, dirs.elDir, elPreset);
            } catch (err) {
                console.error(`Error: bera-reth download failed: ${err.message}`);
                process.exit(1);
            }
        }
    }
}

process.on('SIGINT', () => {
    console.log('\nInterrupted. Exiting...');
    process.exit(0);
});

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
