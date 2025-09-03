// Shared configuration for all Berachain experiments
const path = require('path');

// Load .env file if it exists
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (e) {
  // dotenv not installed or .env not found, continue with process.env
}

// Consolidated configuration with environment variable overrides
const config = {
  // 1) Chain configuration first
  networks: {
    mainnet: {
      name: 'Berachain Mainnet',
      el: process.env.MAINNET_EL_URL || 'http://37.27.231.195:59830',  // bb-mainnet-reth EL RPC
      cl: process.env.MAINNET_CL_URL || 'http://37.27.231.195:59820',  // bb-mainnet-reth CL RPC
    },
    bepolia: {
      name: 'Berachain Bepolia Testnet', 
      el: process.env.BEPOLIA_EL_URL || 'http://37.27.231.195:59870',  // bb-testnet-reth EL RPC
      cl: process.env.BEPOLIA_CL_URL || 'http://37.27.231.195:59860',  // bb-testnet-reth CL RPC
    }
  },
  
  // Helper function to get chain configuration
  getChain: function(chainName = 'mainnet') {
    return this.networks[chainName] || this.networks.mainnet;
  },
  
  // Helper function to get the appropriate RPC URL based on chain
  getRpcUrl: function(type = 'el', chainName = 'mainnet') {
    const chain = this.getChain(chainName);
    switch (type) {
      case 'el': return chain.el;
      case 'cl': return chain.cl;
      default: return chain.el;
    }
  },
  
  // Backward compatibility (deprecated - use getChain)
  getNetwork: function(networkName = 'mainnet') {
    return this.getChain(networkName);
  },

  // 2) Directories next
  ABIS_DIR: process.env.ABIS_DIR || (function() {
    if (process.env.ABIS_DIR && process.env.ABIS_DIR.startsWith('~/')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '', process.env.ABIS_DIR.slice(2));
    }
    return path.join(__dirname, 'doc-abis');
  })(),
  VALIDATOR_DB_PATH: process.env.VALIDATOR_DB_PATH || path.join(__dirname, '../cometbft-decoder/validators_correlated.db'),

  // 3) Other settings
  DEFAULT_BLOCK_COUNT: parseInt(process.env.DEFAULT_BLOCK_COUNT) || 1000,
  FUNDING_PRIVATE_KEY: process.env.FUNDING_PRIVATE_KEY
};

// Shareable helper (moved from shared-utils): centralize access patterns here
config.ConfigHelper = {
  getChainConfig(chainName = 'mainnet') {
    return config.getChain(chainName);
  },
  getRpcUrl(type = 'el', chainName = 'mainnet') {
    return config.getRpcUrl(type, chainName);
  },
  // For scanners, the CL RPC is used to fetch blocks (/block)
  getBlockScannerUrl(chainName = 'mainnet') {
    return config.getRpcUrl('cl', chainName);
  },
  getValidatorDbPath() {
    return config.VALIDATOR_DB_PATH;
  },
  getDefaultBlockCount() {
    return config.DEFAULT_BLOCK_COUNT;
  }
};

module.exports = config; 
