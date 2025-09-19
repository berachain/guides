#!/usr/bin/env node

/**
 * IPC Client - Connect to geth/reth IPC endpoint and retrieve basic information
 * 
 * Usage: 
 *   node ipc-client.js [command] [ipc-path]
 *   IPC_SOCKET=/path/to/socket.ipc node ipc-client.js [command]
 * 
 * Commands:
 *   info (default)         - Show client version, block number, and peer count
 *   peer-summary           - Show peer statistics and client breakdown
 *   peer-list             - Show full enode and client details for all peers
 *   peer-purge-dry-run    - Show how many peers would be removed by filter
 *   peer-purge            - Remove unwanted peers based on whitelist filter
 * 
 * Examples:
 *   node ipc-client.js /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc
 *   node ipc-client.js peer-summary /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc
 *   IPC_SOCKET=/storage/berabox/installations/bb-mainnet-reth/runtime/ipc/reth.ipc node ipc-client.js peer-purge-dry-run
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

// Hardcoded whitelist of allowed client names (from peer-filter inspiration)
const ALLOWED_CLIENTS = [
    'BeraGeth',
    'BeraReth', 
    'bera-reth',
    'reth/v1.6.0-48941e6',
    'reth/v1.7.0-9d56da5'
];

class IPCClient {
    constructor(ipcPath) {
        this.ipcPath = ipcPath;
        this.socket = null;
        this.requestId = 1;
        this.pendingRequests = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            // Check if IPC socket exists
            if (!fs.existsSync(this.ipcPath)) {
                reject(new Error(`IPC socket not found at: ${this.ipcPath}`));
                return;
            }

            this.socket = net.createConnection(this.ipcPath);
            
            this.socket.on('connect', () => {
                console.log(`✅ Connected to geth IPC at: ${this.ipcPath}`);
                resolve();
            });

            this.socket.on('error', (err) => {
                reject(new Error(`Failed to connect to IPC: ${err.message}`));
            });

            this.socket.on('data', (data) => {
                this.handleResponse(data.toString());
            });

            this.socket.on('close', () => {
                console.log('🔌 IPC connection closed');
            });
        });
    }

    handleResponse(data) {
        try {
            // Handle multiple JSON responses in one data chunk
            const lines = data.trim().split('\n');
            
            for (const line of lines) {
                if (line.trim()) {
                    const response = JSON.parse(line);
                    
                    if (response.id && this.pendingRequests.has(response.id)) {
                        const { resolve, reject } = this.pendingRequests.get(response.id);
                        this.pendingRequests.delete(response.id);
                        
                        if (response.error) {
                            reject(new Error(response.error.message || 'RPC Error'));
                        } else {
                            resolve(response.result);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Error parsing response:', err.message);
        }
    }

    sendRequest(method, params = []) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            const request = {
                jsonrpc: '2.0',
                method: method,
                params: params,
                id: id
            };

            this.pendingRequests.set(id, { resolve, reject });
            
            const requestString = JSON.stringify(request) + '\n';
            this.socket.write(requestString);
            
            // Set timeout for request
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout for method: ${method}`));
                }
            }, 10000); // 10 second timeout
        });
    }

    async getClientVersion() {
        try {
            return await this.sendRequest('web3_clientVersion');
        } catch (err) {
            throw new Error(`Failed to get client version: ${err.message}`);
        }
    }

    async getBlockNumber() {
        try {
            const blockHex = await this.sendRequest('eth_blockNumber');
            return parseInt(blockHex, 16);
        } catch (err) {
            throw new Error(`Failed to get block number: ${err.message}`);
        }
    }

    async getPeerCount() {
        try {
            const peerCountHex = await this.sendRequest('net_peerCount');
            return parseInt(peerCountHex, 16);
        } catch (err) {
            throw new Error(`Failed to get peer count: ${err.message}`);
        }
    }

    async getPeers() {
        try {
            return await this.sendRequest('admin_peers');
        } catch (err) {
            throw new Error(`Failed to get peers: ${err.message}`);
        }
    }

    async getAllInfo() {
        try {
            console.log('📊 Fetching client information...\n');
            
            const [clientVersion, blockNumber, peerCount] = await Promise.all([
                this.getClientVersion(),
                this.getBlockNumber(),
                this.getPeerCount()
            ]);

            console.log('='.repeat(60));
            console.log('🔍 CLIENT INFORMATION');
            console.log('='.repeat(60));
            console.log(`📱 Client Version:    ${clientVersion}`);
            console.log(`🧱 Current Block:     ${blockNumber.toLocaleString()}`);
            console.log(`👥 Connected Peers:   ${peerCount}`);
            console.log('='.repeat(60));

            return {
                clientVersion,
                blockNumber,
                peerCount
            };
        } catch (err) {
            throw new Error(`Failed to retrieve information: ${err.message}`);
        }
    }

    async peerSummary() {
        try {
            console.log('📊 Fetching peer information...\n');
            
            const peers = await this.getPeers();
            
            if (!peers || peers.length === 0) {
                console.log('❌ No peers connected');
                return { peers: [], summary: { total: 0 } };
            }

            console.log('='.repeat(80));
            console.log('👥 PEER SUMMARY');
            console.log('='.repeat(80));

            // Analyze peers
            const summary = this.analyzePeers(peers);
            
            // Display summary
            console.log(`📊 Total Peers:       ${summary.total}`);
            console.log(`🏢 Unique Networks:   ${summary.networks.size}`);
            console.log(`📡 Protocols:         ${Array.from(summary.protocols).join(', ')}`);
            console.log(`📥 Inbound:           ${summary.inbound}`);
            console.log(`📤 Outbound:          ${summary.outbound}`);
            console.log(`🔒 Trusted:           ${summary.trusted}`);
            console.log('');

            // Show client breakdown table
            if (summary.clients.size > 0) {
                console.log('🖥️  Client Types:');
                console.log('┌─────────────────────────────┬───────┬─────────┐');
                console.log('│ Client                      │ Count │ Percent │');
                console.log('├─────────────────────────────┼───────┼─────────┤');
                
                const sortedClients = Array.from(summary.clients.entries())
                    .sort((a, b) => b[1] - a[1]);
                
                sortedClients.forEach(([client, count]) => {
                    const percentage = ((count / summary.total) * 100).toFixed(1);
                    console.log(`│ ${client.padEnd(27)} │ ${count.toString().padStart(5)} │ ${(percentage + '%').padStart(7)} │`);
                });
                
                console.log('└─────────────────────────────┴───────┴─────────┘');
                console.log('');
            }

            // Show version breakdown table
            if (summary.versions.size > 0) {
                console.log('📦 Client Versions:');
                console.log('┌──────────────────────────────────────────────────────────────────────┬───────┬─────────┐');
                console.log('│ Version                                                              │ Count │ Percent │');
                console.log('├──────────────────────────────────────────────────────────────────────┼───────┼─────────┤');
                
                const sortedVersions = Array.from(summary.versions.entries())
                    .sort((a, b) => b[1] - a[1]);
                
                sortedVersions.forEach(([version, count]) => {
                    const percentage = ((count / summary.total) * 100).toFixed(1);
                    const truncatedVersion = version.length > 68 ? version.substring(0, 65) + '...' : version;
                    console.log(`│ ${truncatedVersion.padEnd(68)} │ ${count.toString().padStart(5)} │ ${(percentage + '%').padStart(7)} │`);
                });
                
                console.log('└──────────────────────────────────────────────────────────────────────┴───────┴─────────┘');
            }

            return { peers, summary };
        } catch (err) {
            throw new Error(`Failed to retrieve peer information: ${err.message}`);
        }
    }

    async peerList() {
        try {
            console.log('📊 Fetching peer information...\n');
            
            const peers = await this.getPeers();
            
            if (!peers || peers.length === 0) {
                console.log('❌ No peers connected');
                return { peers: [] };
            }

            console.log('='.repeat(160));
            console.log('📋 ALL PEER DETAILS');
            console.log('='.repeat(160));
            console.log('Enode'.padEnd(110) + 'Client'.padEnd(50));
            console.log('-'.repeat(160));
            
            peers.forEach((peer, index) => {
                const enode = peer.enode || 'Unknown';
                const name = peer.name || 'Unknown';
                
                console.log(
                    enode.padEnd(110) + 
                    name.padEnd(50)
                );
            });

            console.log('='.repeat(160));
            console.log(`Total: ${peers.length} peers`);

            return { peers };
        } catch (err) {
            throw new Error(`Failed to retrieve peer list: ${err.message}`);
        }
    }

    async peerPurgeDryRun() {
        try {
            console.log('📊 Analyzing peers for removal...\n');
            
            const peers = await this.getPeers();
            
            if (!peers || peers.length === 0) {
                console.log('❌ No peers connected');
                return { peers: [], toRemove: [] };
            }

            const toRemove = [];
            const toKeep = [];

            peers.forEach(peer => {
                const clientName = peer.name || 'Unknown';
                const isWhitelisted = ALLOWED_CLIENTS.some(allowed => clientName.includes(allowed));
                
                if (!isWhitelisted) {
                    toRemove.push(peer);
                } else {
                    toKeep.push(peer);
                }
            });

            console.log('='.repeat(80));
            console.log('🧹 PEER PURGE DRY RUN');
            console.log('='.repeat(80));
            console.log(`📊 Total Peers:       ${peers.length}`);
            console.log(`✅ To Keep:           ${toKeep.length} (${((toKeep.length/peers.length)*100).toFixed(1)}%)`);
            console.log(`❌ To Remove:         ${toRemove.length} (${((toRemove.length/peers.length)*100).toFixed(1)}%)`);
            console.log('');

            if (toRemove.length > 0) {
                console.log('❌ Peers to be removed:');
                const clientCounts = {};
                toRemove.forEach(peer => {
                    const clientName = peer.name || 'Unknown';
                    clientCounts[clientName] = (clientCounts[clientName] || 0) + 1;
                });

                Object.entries(clientCounts)
                    .sort((a, b) => b[1] - a[1])
                    .forEach(([client, count]) => {
                        console.log(`   ${client}: ${count} peers`);
                    });
            }

            console.log('='.repeat(80));

            return { peers, toRemove, toKeep };
        } catch (err) {
            throw new Error(`Failed to analyze peers for removal: ${err.message}`);
        }
    }

    async peerPurge() {
        try {
            console.log('📊 Analyzing and removing unwanted peers...\n');
            
            const peers = await this.getPeers();
            
            if (!peers || peers.length === 0) {
                console.log('❌ No peers connected');
                return { peers: [], removed: [] };
            }

            const toRemove = [];
            peers.forEach(peer => {
                const clientName = peer.name || 'Unknown';
                const isWhitelisted = ALLOWED_CLIENTS.some(allowed => clientName.includes(allowed));
                
                if (!isWhitelisted) {
                    toRemove.push(peer);
                }
            });

            console.log('='.repeat(80));
            console.log('🧹 PEER PURGE (LIVE)');
            console.log('='.repeat(80));
            console.log(`📊 Total Peers:       ${peers.length}`);
            console.log(`❌ Removing:          ${toRemove.length}`);
            console.log('');

            const removed = [];
            for (const peer of toRemove) {
                if (peer.enode) {
                    try {
                        console.log(`🗑️  Removing: ${peer.name} (${peer.network?.remoteAddress})`);
                        await this.sendRequest('admin_removePeer', [peer.enode]);
                        removed.push(peer);
                    } catch (err) {
                        console.log(`❌ Failed to remove ${peer.name}: ${err.message}`);
                    }
                }
            }

            console.log('');
            console.log(`✅ Successfully removed ${removed.length} peers`);
            console.log('='.repeat(80));

            return { peers, removed };
        } catch (err) {
            throw new Error(`Failed to purge peers: ${err.message}`);
        }
    }

    analyzePeers(peers) {
        const summary = {
            total: peers.length,
            networks: new Set(),
            protocols: new Set(),
            clients: new Map(),
            versions: new Map(),
            inbound: 0,
            outbound: 0,
            trusted: 0
        };

        peers.forEach(peer => {
            // Extract unique IP addresses
            if (peer.network?.remoteAddress) {
                const ip = peer.network.remoteAddress.split(':')[0];
                summary.networks.add(ip);
            }

            // Extract protocols
            if (peer.protocols) {
                Object.keys(peer.protocols).forEach(protocol => {
                    summary.protocols.add(protocol);
                });
            }

            // Extract client types and versions
            if (peer.name) {
                const clientName = peer.name.split('/')[0]; // Get base client name
                summary.clients.set(clientName, (summary.clients.get(clientName) || 0) + 1);
                
                // Track full client version strings
                const fullVersion = peer.name;
                summary.versions.set(fullVersion, (summary.versions.get(fullVersion) || 0) + 1);
            }

            // Connection direction
            if (peer.network?.inbound === true) {
                summary.inbound++;
            } else {
                summary.outbound++;
            }

            // Trusted peers
            if (peer.network?.trusted === true) {
                summary.trusted++;
            }
        });

        return summary;
    }

    disconnect() {
        if (this.socket) {
            this.socket.end();
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    // Parse command and IPC path
    let command = 'info';
    let ipcPath = process.env.IPC_SOCKET;
    
    if (args.length === 1) {
        // Either command or ipc-path
        if (args[0].includes('/') || args[0].includes('\\')) {
            ipcPath = args[0];
        } else {
            command = args[0];
        }
    } else if (args.length === 2) {
        // command and ipc-path
        command = args[0];
        ipcPath = args[1];
    } else if (args.length === 0 && !ipcPath) {
        // No args and no env var
        showUsage();
        process.exit(1);
    }
    
    if (!ipcPath) {
        console.error('❌ Error: IPC path is required');
        showUsage();
        process.exit(1);
    }

    // Validate command
    const validCommands = ['info', 'peer-summary', 'peer-list', 'peer-purge-dry-run', 'peer-purge'];
    if (!validCommands.includes(command)) {
        console.error(`❌ Error: Invalid command '${command}'`);
        console.error(`Valid commands: ${validCommands.join(', ')}`);
        process.exit(1);
    }

    const client = new IPCClient(ipcPath);

    try {
        await client.connect();
        
        switch (command) {
            case 'peer-summary':
                await client.peerSummary();
                break;
            case 'peer-list':
                await client.peerList();
                break;
            case 'peer-purge-dry-run':
                await client.peerPurgeDryRun();
                break;
            case 'peer-purge':
                await client.peerPurge();
                break;
            default:
                await client.getAllInfo();
                break;
        }
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    } finally {
        client.disconnect();
        // Ensure we exit cleanly
        process.exit(0);
    }
}

function showUsage() {
    console.error('');
    console.error('Usage:');
    console.error('  node ipc-client.js [command] [ipc-path]');
    console.error('  IPC_SOCKET=/path/to/socket.ipc node ipc-client.js [command]');
    console.error('');
    console.error('Commands:');
    console.error('  info (default)         - Show client version, block number, and peer count');
    console.error('  peer-summary           - Show peer statistics and client breakdown');
    console.error('  peer-list             - Show full enode and client details for all peers');
    console.error('  peer-purge-dry-run    - Show how many peers would be removed by filter');
    console.error('  peer-purge            - Remove unwanted peers based on whitelist filter');
    console.error('');
    console.error('Examples:');
    console.error('  node ipc-client.js /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc');
    console.error('  node ipc-client.js peer-summary /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc');
    console.error('  IPC_SOCKET=/storage/berabox/installations/bb-mainnet-reth/runtime/ipc/reth.ipc node ipc-client.js peer-purge-dry-run');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = IPCClient;
