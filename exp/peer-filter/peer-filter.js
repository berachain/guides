#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Hardcoded whitelist of allowed client names
const ALLOWED_CLIENTS = [
    'BeraGeth',
    'reth/v1.6.0-48941e6'
];

function parsePeerLog(input) {
    try {
        let data;
        
        if (!input) {
            // Read from stdin when no input provided
            data = fs.readFileSync(0, 'utf8');
        } else {
            // Read from file
            if (!fs.existsSync(input)) {
                console.error(`Error: File '${input}' not found`);
                process.exit(1);
            }
            data = fs.readFileSync(input, 'utf8');
        }
        
        const json = JSON.parse(data);
        return json.result || [];
    } catch (error) {
        console.error('Error reading or parsing peer log:', error.message);
        process.exit(1);
    }
}


function summary(peers) {
    console.log('=== Peer Summary ===\n');
    
    const clientCounts = {};
    const clientDetails = {};
    let totalPeers = peers.length;
    let whitelistedPeers = 0;
    let nonWhitelistedPeers = 0;
    
    peers.forEach((peer, index) => {
        const clientName = peer.name || 'Unknown';
        const enode = peer.enode;
        
        if (!clientCounts[clientName]) {
            clientCounts[clientName] = { count: 0, whitelisted: false, details: [] };
        }
        
        clientCounts[clientName].count++;
        clientCounts[clientName].details.push({
            index: index + 1,
            enode: enode,
            name: peer.name,
            remoteAddress: peer.network?.remoteAddress || 'Unknown'
        });
        
        if (ALLOWED_CLIENTS.includes(clientName)) {
            clientCounts[clientName].whitelisted = true;
            whitelistedPeers++;
        } else {
            nonWhitelistedPeers++;
        }
    });
    
    // Sort clients by count (descending)
    const sortedClients = Object.entries(clientCounts)
        .sort(([,a], [,b]) => b.count - a.count);
    
    console.log('Found Clients:');
    sortedClients.forEach(([clientName, data]) => {
        const status = data.whitelisted ? '✓ KEEP' : '✗ REMOVE';
        console.log(`  ${clientName}: ${data.count} peers [${status}]`);
    });
    
    console.log('\nSummary:');
    console.log(`  Total peers: ${totalPeers}`);
    console.log(`  To keep: ${whitelistedPeers} (${((whitelistedPeers/totalPeers)*100).toFixed(1)}%)`);
    console.log(`  To remove: ${nonWhitelistedPeers} (${((nonWhitelistedPeers/totalPeers)*100).toFixed(1)}%)`);
    console.log(`  Unique clients: ${Object.keys(clientCounts).length}`);
}

function cleanClients(peers) {
    const peersToRemove = [];
    
    peers.forEach((peer) => {
        const clientName = peer.name || 'Unknown';
        
        if (!ALLOWED_CLIENTS.includes(clientName)) {
            peersToRemove.push(peer.enode);
        }
    });
    
    if (peersToRemove.length > 0) {
        peersToRemove.forEach(enode => {
            console.log(`admin.removePeer("${enode}");`);
        });
    }
}

function showUsage() {
    console.log('Peer Filter Tool - Analyze and filter Ethereum peer connections');
    console.log('');
    console.log('USAGE:');
    console.log('  node peer-filter.js <mode> [file]');
    console.log('');
    console.log('MODES:');
    console.log('  summary Show found clients and keep/remove statistics');
    console.log('  clean   Generate admin.removePeer() commands for non-whitelisted clients');
    console.log('');
    console.log('INPUT:');
    console.log('  <file>  Read peer data from specified file');
    console.log('  (none)  Read peer data from stdin');
    console.log('');
    console.log('EXAMPLES:');
    console.log('  # Read from file');
    console.log('  node peer-filter.js summary seed-reth-1-peers.log');
    console.log('  node peer-filter.js clean seed-reth-1-peers.log');
    console.log('');
    console.log('  # Read from stdin');
    console.log('  cat seed-reth-1-peers.log | node peer-filter.js summary');
    console.log('  cat seed-reth-1-peers.log | node peer-filter.js clean');
    console.log('  node peer-filter.js summary < seed-reth-1-peers.log');
    console.log('  node peer-filter.js clean < seed-reth-1-peers.log');
    console.log('');
    console.log('WHITELISTED CLIENTS:');
    ALLOWED_CLIENTS.forEach(client => {
        console.log(`  ${client}`);
    });
    console.log('');
    console.log('INPUT FORMAT:');
    console.log('  Expects JSON with structure: {"result": [{"enode": "...", "name": "...", ...}]}');
    console.log('  Compatible with admin.peers JSON-RPC response format');
}

function main() {
    const args = process.argv.slice(2);
    
    // Handle help options
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        showUsage();
        process.exit(0);
    }
    
    if (args.length < 1 || args.length > 2) {
        showUsage();
        process.exit(1);
    }
    
    const [mode, input] = args;
    
    // Validate mode
    if (!['summary', 'clean'].includes(mode.toLowerCase())) {
        console.error(`Error: Unknown mode '${mode}'`);
        showUsage();
        process.exit(1);
    }
    
    const peers = parsePeerLog(input);
    
    if (peers.length === 0) {
        console.log('No peers found in the input');
        return;
    }
    
    switch (mode.toLowerCase()) {
        case 'summary':
            summary(peers);
            break;
        case 'clean':
            cleanClients(peers);
            break;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    parsePeerLog,
    summary,
    cleanClients,
    ALLOWED_CLIENTS
};
