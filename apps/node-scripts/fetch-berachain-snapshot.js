#!/opt/homebrew/bin/node

const https = require('https');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        el_client: 'reth',
        snapshot_chain: 'bera-snapshot',
        geography: 'na',
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
            case '--client':
            case '-c':
                if (i + 1 < args.length) {
                    config.el_client = args[++i];
                } else {
                    console.error('Error: --client requires a value (reth or geth)');
                    process.exit(1);
                }
                break;
            case '--network':
            case '-n':
                if (i + 1 < args.length) {
                    const network = args[++i];
                    config.snapshot_chain = network === 'testnet' ? 'bera-testnet-snapshot' : 'bera-snapshot';
                } else {
                    console.error('Error: --network requires a value (mainnet or testnet)');
                    process.exit(1);
                }
                break;
            case '--geography':
            case '-g':
                if (i + 1 < args.length) {
                    config.geography = args[++i];
                } else {
                    console.error('Error: --geography requires a value (na, eu, or as)');
                    process.exit(1);
                }
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

    // Validate arguments
    if (!['reth', 'geth'].includes(config.el_client)) {
        console.error('Error: client must be either "reth" or "geth"');
        process.exit(1);
    }
    if (!['na', 'eu', 'as'].includes(config.geography)) {
        console.error('Error: geography must be "na", "eu", or "as"');
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

Downloads Berachain snapshots for beacon and execution clients.

Usage: ./fetch-berachain-snapshot.js [options]

Options:
  -c, --client <client>      Execution client: reth or geth (default: reth)
  -n, --network <network>    Network: mainnet or testnet (default: mainnet)
  -g, --geography <geo>      Geography: na, eu, or as (default: na)
  -t, --type <type>         Snapshot type: pruned or archive (default: pruned)
  -h, --help                Show this help message

Examples:
  ./fetch-berachain-snapshot.js                    # Download reth pruned mainnet from NA
  ./fetch-berachain-snapshot.js -c geth            # Download geth pruned mainnet from NA
  ./fetch-berachain-snapshot.js -n testnet -t archive  # Download reth archive testnet from NA
  ./fetch-berachain-snapshot.js -c geth -n testnet -g eu -t archive  # Download geth archive testnet from EU
    `);
}

const config = parseArgs();

console.log('Bera Snapshot Downloader');
console.log('-------------------------');
console.log(`Network: ${config.snapshot_chain === 'bera-snapshot' ? 'mainnet' : 'testnet'}`);
console.log(`Client: ${config.el_client}`);
console.log(`Type: ${config.snapshot_type}`);
if (config.geography !== 'na') {
    console.log(`Note: --geography parameter is deprecated and ignored (new service uses single endpoint)`);
}
console.log('');

function startDownload(mediaLink, fileName) {
	const filePath = `downloads/${fileName}`;
	fs.mkdirSync('downloads', { recursive: true });
	
	console.log(`\nDownloading ${fileName}`);
	child_process.execSync(`curl -L -C - -o "${filePath}" "${mediaLink}"`, { stdio: 'inherit' });
	console.log(`\n✓ ${fileName} - Complete`);
}

// Fetch snapshot index from snapshots.berachain.com
const indexUrl = 'https://snapshots.berachain.com/index.csv';
console.log('Fetching snapshot index from:');
console.log(`  ${indexUrl}`);
console.log('');

const req = https.request({
	hostname: 'snapshots.berachain.com',
	path: '/index.csv',
	method: 'GET',
	headers: { 'Accept': 'text/csv' }
}, async (res) => {
	let data = '';
	res.on('data', chunk => data += chunk);
	res.on('end', async () => {
		// Parse CSV: type,size_bytes,block_number,version,created_at,sha256,url
		const lines = data.trim().split('\n');
		if (lines.length < 2) {
			console.error('Error: Invalid CSV format or no snapshots found');
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
			
			// Simple CSV parsing (assuming no quoted commas in our data)
			const fields = line.split(',');
			if (fields.length < 7) continue;
			
			const type = fields[0];
			const sizeBytes = parseInt(fields[1]);
			const createdAt = fields[4];
			const url = fields[6];
			
			// Find latest snapshot for each type
			if (type === beaconType && (!snapshots.beacon || createdAt > snapshots.beacon.createdAt)) {
				snapshots.beacon = { url, createdAt, sizeBytes };
			}
			if (type === elType && (!snapshots.el || createdAt > snapshots.el.createdAt)) {
				snapshots.el = { url, createdAt, sizeBytes };
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
