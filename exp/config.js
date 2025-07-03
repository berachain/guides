// Shared configuration for all Berachain experiments
const path = require('path');

// Default environment configuration
const config = {
  // RPC URLs - defaults to your preferred local endpoints
  EL_ETHRPC_URL: process.env.EL_ETHRPC_URL || 'http://10.147.18.191:40003',
  CL_ETHRPC_URL: process.env.CL_ETHRPC_URL || 'http://10.147.18.191:40000',
  
  // ABI directory
  ABIS_DIR: process.env.ABIS_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', 'src/abis/'),
  
  // Network configuration
  CHAIN_ID: process.env.CHAIN_ID || 80094, // Mainnet by default
  
  // Optional: Funding account for testing
  FUNDING_PRIVATE_KEY: process.env.FUNDING_PRIVATE_KEY,
  
  // Network presets
  networks: {
    mainnet: {
      el: 'http://10.147.18.191:40003',
      cl: 'http://10.147.18.191:40000',
      chainId: 80094
    },
    bepolia: {
      el: 'https://bepolia.rpc.berachain.com',
      cl: 'http://localhost:41000',
      chainId: 80064
    }
  }
};

module.exports = config; 