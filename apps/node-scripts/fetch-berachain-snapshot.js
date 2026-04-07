#!/usr/bin/env node

/**
 * Berachain snapshot downloader. No env.sh required.
 * Index: mainnet uses snapshots.berachain.com; testnet uses bepolia.snapshots.berachain.com.
 * Large downloads use curl (-C) for resume; install curl on PATH.
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const DEFAULT_OUTPUT = 'downloads';

function defaultIndexUrl(network) {
    const host =
        network === 'testnet' ? 'bepolia.snapshots.berachain.com' : 'snapshots.berachain.com';
    return `https://${host}/index.csv`;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        el_client: 'reth',
        network: 'mainnet',
        snapshot_type: 'pruned',
        outputDir: DEFAULT_OUTPUT,
        beaconOnly: false,
        elOnly: false
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
                    console.error('Error: --network requires a value (mainnet or testnet)');
                    process.exit(1);
                }
                {
                    const val = args[++i];
                    if (!['mainnet', 'testnet'].includes(val)) {
                        console.error('Error: --network must be "mainnet" or "testnet"');
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
            case '--beacon-only':
                config.beaconOnly = true;
                break;
            case '--execution-only':
            case '--el-only':
                config.elOnly = true;
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

    return config;
}

function showHelp() {
    const defMain = defaultIndexUrl('mainnet');
    const defTest = defaultIndexUrl('testnet');
    console.log(`
Bera Snapshot Downloader

Downloads beacon-kit and execution snapshots from the Berachain snapshot index (CSV).
Requires Node.js 18+ for index fetch and curl on PATH for resumable downloads.

Usage: node fetch-berachain-snapshot.js [options]

Options:
  -n, --network <network>     mainnet or testnet (default: mainnet)
  -t, --type <type>           pruned or archive (default: pruned)
  -o, --output <dir>          download directory (default: downloads)
      --el-client <name>      execution row prefix in CSV (default: reth)
      --beacon-only           beacon-kit snapshot only
      --execution-only, --el-only
                              execution-layer snapshot only
  -h, --help                  show this help

Index CSV: ${defMain} (mainnet), ${defTest} (testnet)

Examples:
  node fetch-berachain-snapshot.js
  node fetch-berachain-snapshot.js -n testnet -t archive -o /var/snapshots
  node fetch-berachain-snapshot.js --execution-only -o ./downloads
`);
}

function startDownload(mediaLink, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    console.log(`\nDownloading ${path.basename(destPath)}`);
    child_process.execSync(`curl -L -C - -o "${destPath}" "${mediaLink}"`, { stdio: 'inherit' });
    console.log(`\n✓ ${path.basename(destPath)} - Complete`);
}

async function fetchText(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Index request failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
}

async function main() {
    const config = parseArgs();
    const indexUrl = defaultIndexUrl(config.network);

    console.log('Bera Snapshot Downloader');
    console.log('-------------------------');
    console.log(`Network: ${config.network}`);
    console.log(`Client: ${config.el_client}`);
    console.log(`Type: ${config.snapshot_type}`);
    console.log(`Output: ${path.resolve(config.outputDir)}`);
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

    const lines = data.trim().split('\n');
    if (lines.length < 2) {
        console.error('Error: Invalid CSV format or no snapshots found');
        process.exit(1);
    }

    const header = lines[0].split(',');
    const colUrl = header.indexOf('url');
    const colUrlS3 = header.indexOf('url_s3');
    const colType = header.indexOf('type');
    const colSizeBytes = header.indexOf('size_bytes');
    const colCreatedAt = header.indexOf('created_at');

    if (colUrl === -1 || colType === -1) {
        console.error('Error: Unexpected CSV format — missing required columns');
        process.exit(1);
    }

    const beaconType = `beacon-kit-${config.snapshot_type}`;
    const elType = `${config.el_client}-${config.snapshot_type}`;
    const snapshots = { beacon: null, el: null };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = line.split(',');
        const type = fields[colType];
        const createdAt = fields[colCreatedAt];
        const url = fields[colUrl];
        const urlS3 = colUrlS3 !== -1 ? fields[colUrlS3] : '';
        const effectiveUrl = urlS3 || url;

        if (
            type === beaconType &&
            (!snapshots.beacon || createdAt > snapshots.beacon.createdAt)
        ) {
            snapshots.beacon = { url: effectiveUrl, createdAt };
        }
        if (type === elType && (!snapshots.el || createdAt > snapshots.el.createdAt)) {
            snapshots.el = { url: effectiveUrl, createdAt };
        }
    }

    const downloadsToQueue = [];

    if (!config.elOnly && snapshots.beacon) {
        const fileName = snapshots.beacon.url.split('/').pop();
        downloadsToQueue.push({
            name: fileName,
            mediaLink: snapshots.beacon.url,
            kind: 'beacon'
        });
    }

    if (!config.beaconOnly && snapshots.el) {
        const fileName = snapshots.el.url.split('/').pop();
        downloadsToQueue.push({
            name: fileName,
            mediaLink: snapshots.el.url,
            kind: 'execution layer'
        });
    }

    if (downloadsToQueue.length > 0) {
        console.log('Will download the following files:');
        downloadsToQueue.forEach((item) => {
            console.log(`  ${item.name} (${item.kind})`);
            console.log(`    URL: ${item.mediaLink}`);
        });
        console.log('');
    } else {
        console.log('Warning: No snapshots found matching the requested criteria.');
        if (!config.beaconOnly && !config.elOnly) {
            console.log(`  Looking for: ${beaconType} and ${elType}`);
        } else if (config.beaconOnly) {
            console.log(`  Looking for: ${beaconType}`);
        } else {
            console.log(`  Looking for: ${elType}`);
        }
        process.exit(0);
    }

    for (const item of downloadsToQueue) {
        const destPath = path.join(config.outputDir, item.name);
        console.log(`Starting download: ${item.name}`);
        try {
            startDownload(item.mediaLink, destPath);
        } catch (err) {
            console.error(`Error downloading ${item.name}: ${err.message}`);
            process.exit(1);
        }
    }

    console.log('\nAll downloads completed!');
}

process.on('SIGINT', () => {
    console.log('\nDownload interrupted. Exiting...');
    process.exit(0);
});

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
