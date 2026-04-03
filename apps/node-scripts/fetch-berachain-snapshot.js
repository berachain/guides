#!/opt/homebrew/bin/node

const https = require('https');
const fs = require('fs');
const child_process = require('child_process');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        el_client: 'reth',
        network: 'mainnet',
        snapshot_type: 'pruned'
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
                if (i + 1 < args.length) {
                    const val = args[++i];
                    if (!['mainnet', 'testnet'].includes(val)) {
                        console.error('Error: --network must be "mainnet" or "testnet"');
                        process.exit(1);
                    }
                    config.network = val;
                } else {
                    console.error('Error: --network requires a value (mainnet or testnet)');
                    process.exit(1);
                }
                break;
            case '--geography':
            case '-g':
                // Deprecated flag — accepted silently for backwards compatibility
                if (i + 1 < args.length) i++;
                break;
            case '--type':
            case '-t':
                if (i + 1 < args.length) {
                    config.snapshot_type = args[++i];
                } else {
                    console.error('Error: --type requires a value (pruned or archive)');
                    process.exit(1);
                }
                break;
            default:
                console.error(`Error: Unknown option ${arg}`);
                showHelp();
                process.exit(1);
        }
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

Downloads Berachain snapshots for beacon and execution clients.

Usage: ./fetch-berachain-snapshot.js [options]

Options:
  -n, --network <network>    Network: mainnet or testnet (default: mainnet)
  -t, --type <type>          Snapshot type: pruned or archive (default: pruned)
  -h, --help                 Show this help message

Examples:
  ./fetch-berachain-snapshot.js                        # Download reth pruned mainnet
  ./fetch-berachain-snapshot.js -n testnet -t archive  # Download reth archive testnet
    `);
}

const config = parseArgs();

const indexHostname = config.network === 'testnet'
    ? 'bepolia.snapshots.berachain.com'
    : 'snapshots.berachain.com';

console.log('Bera Snapshot Downloader');
console.log('-------------------------');
console.log(`Network: ${config.network}`);
console.log(`Client: ${config.el_client}`);
console.log(`Type: ${config.snapshot_type}`);
console.log('');

function startDownload(mediaLink, fileName) {
	const filePath = `downloads/${fileName}`;
	fs.mkdirSync('downloads', { recursive: true });
	
	console.log(`\nDownloading ${fileName}`);
	child_process.execSync(`curl -L -C - -o "${filePath}" "${mediaLink}"`, { stdio: 'inherit' });
	console.log(`\n✓ ${fileName} - Complete`);
}

// Fetch snapshot index
const indexUrl = `https://${indexHostname}/index.csv`;
console.log('Fetching snapshot index from:');
console.log(`  ${indexUrl}`);
console.log('');

const req = https.request({
	hostname: indexHostname,
	path: '/index.csv',
	method: 'GET',
	headers: { 'Accept': 'text/csv' }
}, async (res) => {
	let data = '';
	res.on('data', chunk => data += chunk);
	res.on('end', async () => {
		// Parse CSV: type,size_bytes,block_number,version,created_at,sha256,url,url_s3
		const lines = data.trim().split('\n');
		if (lines.length < 2) {
			console.error('Error: Invalid CSV format or no snapshots found');
			process.exit(1);
		}

		// Determine column indices from header
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

		// Map to snapshot service type names
		const beaconType = `beacon-kit-${config.snapshot_type}`;
		const elType = `${config.el_client}-${config.snapshot_type}`;
		
		const snapshots = {
			beacon: null,
			el: null
		};
		
		// Parse CSV (skip header)
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;
			
			const fields = line.split(',');
			const type = fields[colType];
			const sizeBytes = parseInt(fields[colSizeBytes]);
			const createdAt = fields[colCreatedAt];
			const url = fields[colUrl];
			// Prefer S3 URL when available — direct object storage, no proxy
			const urlS3 = colUrlS3 !== -1 ? fields[colUrlS3] : '';
			const effectiveUrl = urlS3 || url;
			
			// Find latest snapshot for each type
			if (type === beaconType && (!snapshots.beacon || createdAt > snapshots.beacon.createdAt)) {
				snapshots.beacon = { url: effectiveUrl, createdAt, sizeBytes };
			}
			if (type === elType && (!snapshots.el || createdAt > snapshots.el.createdAt)) {
				snapshots.el = { url: effectiveUrl, createdAt, sizeBytes };
			}
		}
		
		const downloadsToQueue = [];
		
		if (snapshots.beacon) {
			const fileName = snapshots.beacon.url.split('/').pop();
			downloadsToQueue.push({
				name: fileName,
				mediaLink: snapshots.beacon.url,
				type: 'beacon'
			});
		}
		
		if (snapshots.el) {
			const fileName = snapshots.el.url.split('/').pop();
			downloadsToQueue.push({
				name: fileName,
				mediaLink: snapshots.el.url,
				type: 'execution layer'
			});
		}

		if (downloadsToQueue.length > 0) {
			console.log('Will download the following files:');
			downloadsToQueue.forEach(item => {
				console.log(`  ${item.name} (${item.type})`);
				console.log(`    URL: ${item.mediaLink}`);
			});
			console.log('');
		} else {
			console.log('Warning: No snapshots found matching the requested criteria.');
			console.log(`  Looking for: ${beaconType} and ${elType}`);
			process.exit(0);
		}

		// Download files sequentially
		for (const item of downloadsToQueue) {
			console.log(`Starting download: ${item.name}`);
			try {
				await startDownload(item.mediaLink, item.name);
			} catch (err) {
				console.error(`Error downloading ${item.name}: ${err.message}`);
				process.exit(1);
			}
		}
		console.log('\nAll downloads completed!');
		process.exit(0);
	});
});

req.on('error', (err) => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});

req.end();

// Handle Ctrl+C
process.on('SIGINT', function() {
	console.log('\nDownload interrupted. Exiting...');
	process.exit(0);
});
