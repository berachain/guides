#!/usr/bin/env node

/**
 * Berachain storage v2 snapshot restore. Reads catalog.csv, restores CL via
 * curl|lz4|tar into $BEACOND_DATA, and EL via bera-reth download --manifest-url
 * into $RETH_DATA. Catalog shape is the same for bepolia and mainnet.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

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
const PROTECTED_RELATIVE = ['config/priv_validator_key.json', 'config/jwt.hex'];
const EL_EXPECTED_ENTRIES = new Set([
    'db',
    'rocksdb',
    'blobstore',
    'static_files',
    'reth.toml',
    'logs',
    'ocvm_logs',
    'invalid_block_hooks',
    'exex',
]);
const CL_DATA_EXPECTED_ENTRIES = new Set([
    'blockstore.db',
    'application.db',
    'state.db',
    'deposits.db',
    'evidence.db',
    'cs.wal',
    'tx_index.db',
    'snapshots',
]);

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

function defaultNetwork() {
    const envChain = process.env.CHAIN;
    if (envChain === 'mainnet' || envChain === 'bepolia') {
        return envChain;
    }
    return 'mainnet';
}

function quote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        network: defaultNetwork(),
        snapshotType: 'pruned',
        catalogUrl: null,
        beaconOnly: false,
        elOnly: false,
        fullCl: false,
        noDownload: false,
        force: false,
        rethBin: process.env.RETH_BIN || null,
        beacondData: process.env.BEACOND_DATA || null,
        rethData: process.env.RETH_DATA || null,
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
            case '--beacond-data':
                if (i + 1 >= args.length) {
                    console.error('Error: --beacond-data requires a directory path');
                    process.exit(1);
                }
                config.beacondData = args[++i];
                break;
            case '--reth-data':
                if (i + 1 >= args.length) {
                    console.error('Error: --reth-data requires a directory path');
                    process.exit(1);
                }
                config.rethData = args[++i];
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
            case '--no-extract':
                config.noDownload = true;
                break;
            case '--force':
                config.force = true;
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
Bera Snapshot Restore (storage v2)

Restores beacon-kit and execution snapshots from catalog.csv into $BEACOND_DATA
and $RETH_DATA (source env.sh first). Catalog URL shape is the same for both networks.
Requires Node.js 18+, curl, lz4, and tar on PATH, and bera-reth for EL restore.

Usage: node fetch-berachain-snapshot-v2.js [options]

Options:
  -n, --network <network>     mainnet or bepolia (default: $CHAIN env var, or mainnet)
  -t, --type <type>           pruned or archive — EL preset only (default: pruned)
      --catalog-url <url>     override catalog.csv URL
      --beacond-data <dir>    consensus home (default: $BEACOND_DATA)
      --reth-data <dir>       execution datadir (default: $RETH_DATA)
      --beacon-only           CL restore only
      --execution-only, --el-only
                              EL restore only
      --full-cl               select cl-archive instead of cl-pruned
      --no-download, --no-extract
                              print restore commands only
      --force                 replace unexpected files in the target datadir
      --reth-bin <path>       bera-reth binary (default: PATH or $RETH_BIN)
  -h, --help                  show this help

Catalog CSV: ${defMainnet} (mainnet), ${defBepolia} (bepolia)

Examples:
  . ./env.sh && node fetch-berachain-snapshot-v2.js
  node fetch-berachain-snapshot-v2.js -n bepolia -t pruned
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

function listTopLevel(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    return fs.readdirSync(dirPath);
}

function prepareTargetDir(dirPath, expectedNames, force, label, keepNames = new Set()) {
    fs.mkdirSync(dirPath, { recursive: true });
    const entries = listTopLevel(dirPath);
    if (entries.length === 0) {
        return;
    }
    const unexpected = entries.filter(
        (name) => !expectedNames.has(name) && !keepNames.has(name),
    );
    if (unexpected.length > 0 && !force) {
        throw new Error(
            `${label} has unexpected contents (${unexpected.join(', ')}). Pass --force to replace.`,
        );
    }
    for (const name of entries) {
        if (keepNames.has(name)) {
            continue;
        }
        if (force || expectedNames.has(name)) {
            fs.rmSync(path.join(dirPath, name), { recursive: true, force: true });
        }
    }
}

function fingerprint(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotProtected(beacondData) {
    const snaps = {};
    for (const rel of PROTECTED_RELATIVE) {
        const filePath = path.join(beacondData, rel);
        snaps[filePath] = fingerprint(filePath);
    }
    return snaps;
}

function assertProtectedUnchanged(before) {
    for (const [filePath, hash] of Object.entries(before)) {
        const after = fingerprint(filePath);
        if (hash && after !== hash) {
            throw new Error(`refused to overwrite protected file: ${filePath}`);
        }
        if (hash && !after) {
            throw new Error(`protected file missing after extract: ${filePath}`);
        }
    }
}

function ensurePrivValidatorState(beacondData) {
    const statePath = path.join(beacondData, 'data', 'priv_validator_state.json');
    if (fs.existsSync(statePath)) {
        return;
    }
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify({ height: '0', round: 0, step: 0 })}\n`);
    console.log(`Wrote genesis ${statePath}`);
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

function assertRethSupportsManifest(rethBin) {
    let help;
    try {
        help = child_process.execSync(`${quote(rethBin)} download --help`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        throw new Error(`could not run ${rethBin} download --help: ${err.message}`);
    }
    if (!help.includes('--manifest-url')) {
        throw new Error(
            `${rethBin} does not support download --manifest-url. Storage v2 EL restore needs a bera-reth newer than v1.4.4.`,
        );
    }
}

function requireTool(name) {
    try {
        child_process.execSync(`command -v ${name}`, {
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: true,
        });
    } catch {
        throw new Error(`${name} is required on PATH`);
    }
}

function clExtractDir(beacondData) {
    return path.join(beacondData, 'data');
}

function tarExcludeFlags() {
    return '--exclude=config --exclude=./config --exclude=config/priv_validator_key.json --exclude=config/jwt.hex';
}

function buildElCommand(config, manifestUrl, elDir, elPreset) {
    const chain = rethChainName(config.network);
    return `bera-reth download --chain ${chain} --manifest-url ${manifestUrl} --datadir ${elDir} ${elPreset}`;
}

function buildClCommand(clUrl, clDir, forDownload) {
    const curlFlags = forDownload ? '-L -C - -fsSL' : '-fsSL';
    return `curl ${curlFlags} ${clUrl} | lz4 -d | tar -x -C ${clDir} ${tarExcludeFlags()}`;
}

function runClRestore(clUrl, clDir) {
    child_process.execSync(buildClCommand(clUrl, clDir, true), { stdio: 'inherit', shell: true });
}

function runElDownload(rethBin, config, manifestUrl, elDir, elPreset) {
    const chain = rethChainName(config.network);
    child_process.execSync(
        `${quote(rethBin)} download --chain ${quote(chain)} --manifest-url ${quote(manifestUrl)} --datadir ${quote(elDir)} ${elPreset}`,
        { stdio: 'inherit', shell: true },
    );
}

async function main() {
    const config = parseArgs();
    const { elPreset, clRole } = resolvePairing(config);
    const restoreEl = !config.beaconOnly;
    const restoreCl = !config.elOnly;

    if (!config.noDownload) {
        if (restoreCl && !config.beacondData) {
            console.error('Error: set BEACOND_DATA or pass --beacond-data (source env.sh)');
            process.exit(1);
        }
        if (restoreEl && !config.rethData) {
            console.error('Error: set RETH_DATA or pass --reth-data (source env.sh)');
            process.exit(1);
        }
        try {
            requireTool('lz4');
            requireTool('tar');
            requireTool('curl');
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    }

    const beacondData = config.beacondData ? path.resolve(config.beacondData) : null;
    const rethData = config.rethData ? path.resolve(config.rethData) : null;
    const clDir = beacondData ? clExtractDir(beacondData) : path.join('$BEACOND_DATA', 'data');
    const elDir = rethData || '$RETH_DATA';

    console.log('Bera Snapshot Restore (storage v2)');
    console.log('-------------------------');
    console.log(`Network: ${config.network}`);
    console.log(`Type: ${config.snapshotType}`);
    if (restoreCl && beacondData) {
        console.log(`Beacon home: ${beacondData}`);
    }
    if (restoreEl && rethData) {
        console.log(`Reth datadir: ${rethData}`);
    }
    console.log(`Catalog: ${config.catalogUrl}`);
    console.log('');

    let catalogText;
    try {
        catalogText = await fetchText(config.catalogUrl);
    } catch (err) {
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

    if (config.noDownload) {
        if (restoreEl) {
            console.log(buildElCommand(config, elManifest.downloadUrl, elDir, elPreset));
        }
        if (restoreCl) {
            console.log(buildClCommand(clRow.downloadUrl, clDir, false));
        }
        process.exit(0);
    }

    let rethBin = null;
    if (restoreEl) {
        rethBin = findRethBin(config);
        if (!rethBin) {
            console.error('Error: bera-reth not found. Set RETH_BIN or pass --reth-bin.');
            process.exit(1);
        }
        try {
            assertRethSupportsManifest(rethBin);
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    }

    const protectedBefore = restoreCl ? snapshotProtected(beacondData) : {};

    try {
        if (restoreCl) {
            prepareTargetDir(
                clDir,
                CL_DATA_EXPECTED_ENTRIES,
                config.force,
                'Beacon data dir',
                new Set(['priv_validator_state.json']),
            );
        }
        if (restoreEl) {
            prepareTargetDir(rethData, EL_EXPECTED_ENTRIES, config.force, 'Reth datadir');
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    if (restoreCl) {
        try {
            console.log(`\nExtracting CL snapshot into ${clDir}`);
            runClRestore(clRow.downloadUrl, clDir);
            ensurePrivValidatorState(beacondData);
        } catch (err) {
            console.error(`Error: CL restore failed: ${err.message}`);
            process.exit(1);
        }
    }

    if (restoreEl) {
        try {
            console.log(`\nDownloading EL snapshot into ${rethData}`);
            runElDownload(rethBin, config, elManifest.downloadUrl, rethData, elPreset);
        } catch (err) {
            console.error(`Error: bera-reth download failed: ${err.message}`);
            process.exit(1);
        }
    }

    try {
        assertProtectedUnchanged(protectedBefore);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    console.log('\nSnapshot restore complete.');
}

process.on('SIGINT', () => {
    console.log('\nInterrupted. Exiting...');
    process.exit(0);
});

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
