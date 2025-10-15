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
console.log(`Geography: ${config.geography}`);
console.log('');

function startDownload(mediaLink, fileName) {
	const filePath = `downloads/${fileName}`;
	fs.mkdirSync('downloads', { recursive: true });
	
	console.log(`\nDownloading ${fileName}`);
	child_process.execSync(`curl -L -C - -o "${filePath}" "${mediaLink}"`, { stdio: 'inherit' });
	console.log(`\n✓ ${fileName} - Complete`);
}

// Fetch bucket contents and start downloads
// Both mainnet and testnet append geography
const bucketName = `${config.snapshot_chain}-${config.geography}`;

const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o`;
console.log('Fetching bucket contents from:');
console.log(`  ${bucketUrl}`);
console.log('');

const req = https.request({
	hostname: 'storage.googleapis.com',
	path: `/storage/v1/b/${bucketName}/o`,
	method: 'GET',
	headers: { 'Accept': 'application/json' }
}, async (res) => {
	let data = '';
	res.on('data', chunk => data += chunk);
	res.on('end', async () => {
		const parsedData = JSON.parse(data);
		const directoryStructure = {};
		
		parsedData.items?.forEach(item => {
			const pathParts = item.name.split('/');
			const fileName = pathParts.pop();
			const directoryPath = pathParts.join('/');
			
			if (!directoryStructure[directoryPath]) {
				directoryStructure[directoryPath] = [];
			}
			
			// Skip SHA256 files
			if (!fileName.endsWith('.sha256')) {
				directoryStructure[directoryPath].push({
					name: fileName,
					size: item.size,
					timeCreated: item.timeCreated,
					mediaLink: item.mediaLink
				});
			}
		});
		
		// Directory structure:
		// Both mainnet and testnet:
		//   - Beacon CL: beacon-kit/<type> (client-independent)
		//   - Execution EL: bera-<client>/<type>
		const dir_keys = {
			beacon_key: `beacon-kit/${config.snapshot_type}`,
			el_key: `bera-${config.el_client}/${config.snapshot_type}`
		};

		// Find the files to download and log their URLs
		const downloadsToQueue = [];
		const MIN_SIZE_BYTES = 1024 * 1024; // 1 MB minimum
		
		for (const key in dir_keys) {
			const dir = dir_keys[key];
			if (directoryStructure[dir]) {
				// Filter out small files (likely placeholder/stub files)
				const files = directoryStructure[dir].filter(f => parseInt(f.size) >= MIN_SIZE_BYTES);
				if (files.length === 0) {
					console.log(`Warning: No valid snapshots found in ${dir} (all files < 1MB)`);
					continue;
				}
				files.sort((a, b) => new Date(b.timeCreated) - new Date(a.timeCreated));
				const latest = files[0];
				downloadsToQueue.push({
					name: latest.name,
					mediaLink: latest.mediaLink,
					dir: dir
				});
			}
		}

		if (downloadsToQueue.length > 0) {
			console.log('Will download the following files:');
			downloadsToQueue.forEach(item => {
				console.log(`  ${item.name} from ${item.dir}`);
				console.log(`    URL: ${item.mediaLink}`);
			});
			console.log('');
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
