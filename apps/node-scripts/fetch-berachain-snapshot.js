#!/usr/bin/env node

/**
 * Berachain snapshot restore. Reads index.csv, downloads .tar.lz4 snapshots
 * with resumable curl, and extracts them into $BEACOND_DATA / $RETH_DATA.
 * Index: mainnet uses snapshots.berachain.com; bepolia uses bepolia.snapshots.berachain.com.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const DEFAULT_OUTPUT = 'downloads';
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

function defaultIndexUrl(network) {
    const host =
        network === 'bepolia' ? 'bepolia.snapshots.berachain.com' : 'snapshots.berachain.com';
    return `https://${host}/index.csv`;
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
        el_client: 'reth',
        network: defaultNetwork(),
        snapshot_type: 'pruned',
        outputDir: DEFAULT_OUTPUT,
        beaconOnly: false,
        elOnly: false,
        noExtract: false,
        force: false,
        indexUrl: null,
        beacondData: process.env.BEACOND_DATA || null,
        rethData: process.env.RETH_DATA || null,
        networkFromFlag: false,
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
                    config.networkFromFlag = true;
                }
                break;
            case '--type':
            case '-t':
                if (i + 1 >= args.length) {
                    console.error('Error: --type requires a value (pruned or archive)');
                    process.exit(1);
                }
                config.snapshot_type = args[++i];
                break;
            case '--output':
            case '-o':
                if (i + 1 >= args.length) {
                    console.error('Error: --output requires a directory path');
                    process.exit(1);
                }
                config.outputDir = args[++i];
                break;
            case '--el-client':
                if (i + 1 >= args.length) {
                    console.error('Error: --el-client requires a value (e.g. reth)');
                    process.exit(1);
                }
                config.el_client = args[++i];
                break;
            case '--index-url':
                if (i + 1 >= args.length) {
                    console.error('Error: --index-url requires a URL');
                    process.exit(1);
                }
                config.indexUrl = args[++i];
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
            case '--no-extract':
                config.noExtract = true;
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
    if (!['pruned', 'archive'].includes(config.snapshot_type)) {
        console.error('Error: type must be either "pruned" or "archive"');
        process.exit(1);
    }

    if (!config.indexUrl) {
        config.indexUrl = defaultIndexUrl(config.network);
    }

    return config;
}

function showHelp() {
    const defMain = defaultIndexUrl('mainnet');
    const defBepolia = defaultIndexUrl('bepolia');
    console.log(`
Bera Snapshot Restore

Downloads beacon-kit and execution snapshots from the Berachain snapshot index (CSV)
and extracts them into $BEACOND_DATA and $RETH_DATA (source env.sh first).
Requires Node.js 18+, curl, lz4, and tar on PATH.

Usage: node fetch-berachain-snapshot.js [options]

Options:
  -n, --network <network>     mainnet or bepolia (default: $CHAIN env var, or mainnet)
  -t, --type <type>           pruned or archive (default: pruned)
  -o, --output <dir>          tarball cache directory (default: downloads)
      --el-client <name>      execution row prefix in CSV (default: reth)
      --beacond-data <dir>    consensus home (default: $BEACOND_DATA)
      --reth-data <dir>       execution datadir (default: $RETH_DATA)
      --index-url <url>       override index.csv URL
      --beacon-only           beacon-kit snapshot only
      --execution-only, --el-only
                              execution-layer snapshot only
      --no-extract            download tarballs and print extract commands; do not extract
      --force                 replace unexpected files in the target datadir
  -h, --help                  show this help

Index CSV: ${defMain} (mainnet), ${defBepolia} (bepolia)

Examples:
  . ./env.sh && node fetch-berachain-snapshot.js
  node fetch-berachain-snapshot.js -n bepolia -t pruned
  node fetch-berachain-snapshot.js --no-extract -o ./downloads
`);
}

function startDownload(mediaLink, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    console.log(`\nDownloading ${path.basename(destPath)}`);
    child_process.execSync(`curl -L -C - -o ${quote(destPath)} ${quote(mediaLink)}`, {
        stdio: 'inherit',
        shell: true,
    });
    console.log(`\n${path.basename(destPath)} - Complete`);
}

async function fetchText(url) {
    if (url.startsWith('file://')) {
        return fs.readFileSync(new URL(url), 'utf8');
    }
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Index request failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
}

function parseIndex(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('Invalid CSV format or no snapshots found');
    }

    const header = lines[0].split(',');
    const colUrl = header.indexOf('url');
    const colUrlS3 = header.indexOf('url_s3');
    const colType = header.indexOf('type');
    const colCreatedAt = header.indexOf('created_at');

    if (colUrl === -1 || colType === -1) {
        throw new Error('Unexpected CSV format — missing required columns');
    }

    return { lines, colUrl, colUrlS3, colType, colCreatedAt };
}

function selectLatest(parsed, beaconType, elType) {
    const snapshots = { beacon: null, el: null };
    const { lines, colUrl, colUrlS3, colType, colCreatedAt } = parsed;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = line.split(',');
        const type = fields[colType];
        const createdAt = fields[colCreatedAt];
        const url = fields[colUrl];
        const urlS3 = colUrlS3 !== -1 ? fields[colUrlS3] : '';
        const effectiveUrl = urlS3 || url;

        if (type === beaconType && (!snapshots.beacon || createdAt > snapshots.beacon.createdAt)) {
            snapshots.beacon = { url: effectiveUrl, createdAt };
        }
        if (type === elType && (!snapshots.el || createdAt > snapshots.el.createdAt)) {
            snapshots.el = { url: effectiveUrl, createdAt };
        }
    }

    return snapshots;
}

function firstPathComponent(member) {
    const trimmed = member.replace(/^\.\//, '').replace(/\/+$/, '');
    const slash = trimmed.indexOf('/');
    return slash === -1 ? trimmed : trimmed.slice(0, slash);
}

function listTarMembers(archivePath) {
    const out = child_process.execSync(`lz4 -dc ${quote(archivePath)} | tar -t`, {
        encoding: 'utf8',
        shell: true,
    });
    return out.split('\n').filter(Boolean);
}

function clExtractDir(members, beacondData) {
    const usesDataPrefix = members.some((member) => firstPathComponent(member) === 'data');
    return usesDataPrefix ? beacondData : path.join(beacondData, 'data');
}

function elExtractDir(members, rethData) {
    const usesDataPrefix = members.some((member) => firstPathComponent(member) === 'data');
    return usesDataPrefix ? path.dirname(rethData) : rethData;
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

function extractCommand(archivePath, destDir) {
    return `lz4 -dc ${quote(archivePath)} | tar -x -C ${quote(destDir)} --exclude=config --exclude=./config --exclude=config/priv_validator_key.json --exclude=config/jwt.hex`;
}

function runExtract(archivePath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    child_process.execSync(extractCommand(archivePath, destDir), {
        stdio: 'inherit',
        shell: true,
    });
}

function ensurePrivValidatorState(beacondData) {
    const statePath = path.join(beacondData, 'data', 'priv_validator_state.json');
    if (fs.existsSync(statePath)) {
        return;
    }
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
        statePath,
        `${JSON.stringify({ height: '0', round: 0, step: 0 })}\n`,
    );
    console.log(`Wrote genesis ${statePath}`);
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

async function main() {
    const config = parseArgs();
    const indexUrl = config.indexUrl;
    const restoreCl = !config.elOnly;
    const restoreEl = !config.beaconOnly;

    if (!config.noExtract) {
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
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    }

    const beacondData = config.beacondData ? path.resolve(config.beacondData) : null;
    const rethData = config.rethData ? path.resolve(config.rethData) : null;

    console.log('Bera Snapshot Restore');
    console.log('-------------------------');
    console.log(`Network: ${config.network}`);
    console.log(`Client: ${config.el_client}`);
    console.log(`Type: ${config.snapshot_type}`);
    console.log(`Tarball cache: ${path.resolve(config.outputDir)}`);
    if (restoreCl && beacondData) {
        console.log(`Beacon home: ${beacondData}`);
    }
    if (restoreEl && rethData) {
        console.log(`Reth datadir: ${rethData}`);
    }
    console.log(`Index: ${indexUrl}`);
    console.log('');
    console.log('Fetching snapshot index...');
    console.log('');

    let data;
    try {
        data = await fetchText(indexUrl);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    let parsed;
    try {
        parsed = parseIndex(data);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    const beaconType = `beacon-kit-${config.snapshot_type}`;
    const elType = `${config.el_client}-${config.snapshot_type}`;
    const snapshots = selectLatest(parsed, beaconType, elType);

    const downloadsToQueue = [];

    if (restoreCl) {
        if (!snapshots.beacon) {
            console.error(`Error: no snapshot found for ${beaconType}`);
            process.exit(1);
        }
        downloadsToQueue.push({
            name: snapshots.beacon.url.split('/').pop(),
            mediaLink: snapshots.beacon.url,
            kind: 'beacon',
        });
    }

    if (restoreEl) {
        if (!snapshots.el) {
            console.error(`Error: no snapshot found for ${elType}`);
            process.exit(1);
        }
        downloadsToQueue.push({
            name: snapshots.el.url.split('/').pop(),
            mediaLink: snapshots.el.url,
            kind: 'execution layer',
        });
    }

    console.log('Will download the following files:');
    downloadsToQueue.forEach((item) => {
        console.log(`  ${item.name} (${item.kind})`);
        console.log(`    URL: ${item.mediaLink}`);
    });
    console.log('');

    const downloaded = [];
    for (const item of downloadsToQueue) {
        const destPath = path.join(config.outputDir, item.name);
        console.log(`Starting download: ${item.name}`);
        try {
            startDownload(item.mediaLink, destPath);
        } catch (err) {
            console.error(`Error downloading ${item.name}: ${err.message}`);
            process.exit(1);
        }
        downloaded.push({ ...item, destPath: path.resolve(destPath) });
    }

    console.log('\nAll downloads completed!');

    if (config.noExtract) {
        for (const item of downloaded) {
            try {
                const members = listTarMembers(item.destPath);
                const dest =
                    item.kind === 'beacon'
                        ? clExtractDir(members, beacondData || '$BEACOND_DATA')
                        : elExtractDir(members, rethData || '$RETH_DATA');
                console.log(extractCommand(item.destPath, dest));
            } catch {
                const dest =
                    item.kind === 'beacon'
                        ? path.join(beacondData || '$BEACOND_DATA', 'data')
                        : rethData || '$RETH_DATA';
                console.log(extractCommand(item.destPath, dest));
            }
        }
        return;
    }

    const protectedBefore = restoreCl ? snapshotProtected(beacondData) : {};

    for (const item of downloaded) {
        try {
            const members = listTarMembers(item.destPath);
            if (item.kind === 'beacon') {
                const dest = clExtractDir(members, beacondData);
                const dataDir = path.join(beacondData, 'data');
                prepareTargetDir(
                    dataDir,
                    CL_DATA_EXPECTED_ENTRIES,
                    config.force,
                    'Beacon data dir',
                    new Set(['priv_validator_state.json']),
                );
                console.log(`\nExtracting ${item.name} into ${dest}`);
                runExtract(item.destPath, dest);
                ensurePrivValidatorState(beacondData);
            } else {
                const dest = elExtractDir(members, rethData);
                prepareTargetDir(rethData, EL_EXPECTED_ENTRIES, config.force, 'Reth datadir');
                console.log(`\nExtracting ${item.name} into ${dest}`);
                runExtract(item.destPath, dest);
            }
        } catch (err) {
            console.error(`Error: ${err.message}`);
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
    console.log('\nDownload interrupted. Exiting...');
    process.exit(0);
});

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
