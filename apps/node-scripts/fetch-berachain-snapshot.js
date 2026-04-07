#!/usr/bin/env node

/**
 * Standalone Berachain snapshot downloader. No env.sh or other repo files required.
 * Requires Node.js 18+ (global fetch + stream helpers).
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const { Readable } = require('stream');

const DEFAULT_INDEX = 'https://snapshots.berachain.com/index.csv';
const DEFAULT_OUTPUT = 'downloads';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        el_client: 'reth',
        snapshot_chain: 'bera-snapshot',
        snapshot_type: 'pruned',
        outputDir: DEFAULT_OUTPUT,
        indexUrl: DEFAULT_INDEX,
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
                    const network = args[++i];
                    config.snapshot_chain =
                        network === 'testnet' ? 'bera-testnet-snapshot' : 'bera-snapshot';
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
            case '--index-url':
                if (i + 1 >= args.length) {
                    console.error('Error: --index-url requires a URL');
                    process.exit(1);
                }
                config.indexUrl = args[++i];
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
            case '--geography':
            case '-g':
                if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    i++;
                }
                console.error(
                    'Warning: --geography is deprecated and ignored (single index endpoint).'
                );
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
    console.log(`
Bera Snapshot Downloader

Standalone script: no env file or other repo files required (Node.js 18+).

Usage: node fetch-berachain-snapshot.js [options]

Options:
  -n, --network <network>     mainnet or testnet (default: mainnet)
  -t, --type <type>           pruned or archive (default: pruned)
  -o, --output <dir>          download directory (default: downloads)
      --index-url <url>       snapshot index CSV URL (default: ${DEFAULT_INDEX})
      --el-client <name>      execution snapshot type prefix in index (default: reth)
      --beacon-only           download only the beacon-kit snapshot
      --execution-only, --el-only
                              download only the execution-layer snapshot
  -h, --help                  show this help

Deprecated (ignored):
  -g, --geography             kept for backward compatibility

Examples:
  node fetch-berachain-snapshot.js
  node fetch-berachain-snapshot.js -n testnet -t archive -o /var/snapshots
  node fetch-berachain-snapshot.js --execution-only -o ./downloads
`);
}

async function fetchText(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Index request failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
}

async function downloadToFile(url, destPath) {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
        throw new Error('Empty response body');
    }
    const nodeStream = Readable.fromWeb(res.body);
    await pipeline(nodeStream, createWriteStream(destPath));
}

const config = parseArgs();

console.log('Bera Snapshot Downloader');
console.log('-------------------------');
console.log(`Network: ${config.snapshot_chain === 'bera-snapshot' ? 'mainnet' : 'testnet'}`);
console.log(`Client: ${config.el_client}`);
console.log(`Type: ${config.snapshot_type}`);
console.log(`Output: ${path.resolve(config.outputDir)}`);
console.log(`Index: ${config.indexUrl}`);
console.log('');

async function main() {
    console.log('Fetching snapshot index...');
    console.log('');

    let data;
    try {
        data = await fetchText(config.indexUrl);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }

    const lines = data.trim().split('\n');
    if (lines.length < 2) {
        console.error('Error: Invalid CSV format or no snapshots found');
        process.exit(1);
    }

    const beaconType = `beacon-kit-${config.snapshot_type}`;
    const elType = `${config.el_client}-${config.snapshot_type}`;

    const snapshots = { beacon: null, el: null };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = line.split(',');
        if (fields.length < 7) continue;

        const type = fields[0];
        const createdAt = fields[4];
        const url = fields[6];

        if (
            type === beaconType &&
            (!snapshots.beacon || createdAt > snapshots.beacon.createdAt)
        ) {
            snapshots.beacon = { url, createdAt };
        }
        if (type === elType && (!snapshots.el || createdAt > snapshots.el.createdAt)) {
            snapshots.el = { url, createdAt };
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
        const filePath = path.join(config.outputDir, item.name);
        console.log(`Starting download: ${item.name}`);
        try {
            console.log(`\nDownloading ${item.name}`);
            await downloadToFile(item.mediaLink, filePath);
            console.log(`\n✓ ${item.name} - Complete`);
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
