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
        
        if (input === '--' || !input) {
            // Read from stdin
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


function listAllClients(peers) {
    console.log('=== All Clients Found ===\n');
    
    const clientCounts = {};
    const clientDetails = {};
    
    peers.forEach((peer, index) => {
        const clientName = peer.name || 'Unknown';
        const enode = peer.enode;
        
        if (!clientCounts[clientName]) {
            clientCounts[clientName] = 0;
            clientDetails[clientName] = [];
        }
        
        clientCounts[clientName]++;
        clientDetails[clientName].push({
            index: index + 1,
            enode: enode,
            name: peer.name,
            remoteAddress: peer.network?.remoteAddress || 'Unknown'
        });
    });
    
    // Sort clients by count (descending)
    const sortedClients = Object.entries(clientCounts)
        .sort(([,a], [,b]) => b - a);
    
    sortedClients.forEach(([clientName, count]) => {
        console.log(`${clientName}: ${count} peers`);
        console.log('  Examples:');
        clientDetails[clientName].slice(0, 3).forEach(detail => {
            console.log(`    ${detail.index}. ${detail.name}`);
            console.log(`       ${detail.enode}`);
        });
        if (clientDetails[clientName].length > 3) {
            console.log(`    ... and ${clientDetails[clientName].length - 3} more`);
        }
        console.log('');
    });
    
    console.log(`Total peers: ${peers.length}`);
    console.log(`Unique clients: ${Object.keys(clientCounts).length}`);
}

function cleanClients(peers) {
    console.log('=== Cleaning Non-Whitelisted Clients ===\n');
    console.log('Whitelisted clients:', ALLOWED_CLIENTS.join(', '));
    console.log('');
    
    const peersToRemove = [];
    const clientStats = {};
    
    peers.forEach((peer, index) => {
        const clientName = peer.name || 'Unknown';
        
        if (!clientStats[clientName]) {
            clientStats[clientName] = { total: 0, whitelisted: 0, toRemove: 0 };
        }
        clientStats[clientName].total++;
        
        if (ALLOWED_CLIENTS.includes(clientName)) {
            clientStats[clientName].whitelisted++;
        } else {
            clientStats[clientName].toRemove++;
            peersToRemove.push({
                index: index + 1,
                enode: peer.enode,
                clientName: clientName,
                name: peer.name
            });
        }
    });
    
    // Show statistics
    console.log('Client Statistics:');
    Object.entries(clientStats).forEach(([clientName, stats]) => {
        const status = ALLOWED_CLIENTS.includes(clientName) ? '✓ WHITELISTED' : '✗ TO REMOVE';
        console.log(`  ${clientName}: ${stats.total} total, ${stats.whitelisted} whitelisted, ${stats.toRemove} to remove [${status}]`);
    });
    
    console.log(`\nTotal peers to remove: ${peersToRemove.length}`);
    console.log(`Total peers to keep: ${peers.length - peersToRemove.length}`);
    
    if (peersToRemove.length > 0) {
        console.log('\n=== admin.removePeer() Commands ===\n');
        peersToRemove.forEach(peer => {
            console.log(`admin.removePeer("${peer.enode}");`);
        });
    } else {
        console.log('\nNo peers need to be removed - all clients are whitelisted!');
    }
}

function showUsage() {
    console.log('Peer Filter Tool - Analyze and filter Ethereum peer connections');
    console.log('');
    console.log('USAGE:');
    console.log('  node peer-filter.js <mode> [input]');
    console.log('');
    console.log('MODES:');
    console.log('  list    List all client types found in the peer log');
    console.log('  clean   Generate admin.removePeer() commands for non-whitelisted clients');
    console.log('');
    console.log('INPUT:');
    console.log('  <file>  Read peer data from specified file');
    console.log('  --      Read peer data from stdin (standard input)');
    console.log('  (none)  Read peer data from stdin (if no input specified)');
    console.log('');
    console.log('EXAMPLES:');
    console.log('  # Read from file');
    console.log('  node peer-filter.js list seed-reth-1-peers.log');
    console.log('  node peer-filter.js clean seed-reth-1-peers.log');
    console.log('');
    console.log('  # Read from stdin using redirection');
    console.log('  node peer-filter.js list < seed-reth-1-peers.log');
    console.log('  node peer-filter.js clean -- < seed-reth-1-peers.log');
    console.log('');
    console.log('  # Read from stdin with explicit --');
    console.log('  cat seed-reth-1-peers.log | node peer-filter.js list --');
    console.log('  cat seed-reth-1-peers.log | node peer-filter.js clean --');
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
    if (!['list', 'clean'].includes(mode.toLowerCase())) {
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
        case 'list':
            listAllClients(peers);
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
    listAllClients,
    cleanClients,
    ALLOWED_CLIENTS
};
