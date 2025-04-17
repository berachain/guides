#!/opt/homebrew/bin/node

const el_node_type = 'reth' || 'geth';
const snapshot_type = "bera-testnet-snapshot" || "bera-snapshot";
const geography = "na" || 'eu' || 'as'; // North America, EU, Asia

const https = require('https');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

console.log('Bera Snapshot Downloader');
console.log('-------------------------');

function startDownload(mediaLink, fileName) {
	const filePath = `downloads/${fileName}`;
	fs.mkdirSync('downloads', { recursive: true });
	
	console.log(`\nDownloading ${fileName}`);
	child_process.execSync(`curl -L -C - -o "${filePath}" "${mediaLink}"`, { stdio: 'inherit' });
	console.log(`\n✓ ${fileName} - Complete`);
}

// Fetch bucket contents and start downloads
console.log('Fetching bucket contents...');
const req = https.request({
	hostname: 'storage.googleapis.com',
	path: `/storage/v1/b/${snapshot_type}-${geography}/o`,
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
		
		const dir_keys = {
			beacon_key: `beacon_${el_node_type}/pruned`,
			el_key: `${el_node_type}/pruned`
		};

		// Download files sequentially
		for (const key in dir_keys) {
			const dir = dir_keys[key];
			if (directoryStructure[dir]) {
				const files = directoryStructure[dir];
				files.sort((a, b) => new Date(b.timeCreated) - new Date(a.timeCreated));
				console.log(`Found ${files[0].name} in ${dir}`);
				try {
					await startDownload(files[0].mediaLink, files[0].name);
				} catch (err) {
					console.error(`Error downloading ${files[0].name}: ${err.message}`);
					process.exit(1);
				}
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
