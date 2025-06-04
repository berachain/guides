const { defineChain } = require('viem');

const bepolia = defineChain({
  id: 80069,
  name: 'Berachain Bepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'BERA',
    symbol: 'BERA',
  },
  rpcUrls: {
    default: {
      http: ['https://bepolia.rpc.berachain.com'],
    },
  },
  blockExplorers: {
    default: { 
      name: 'BeraScan', 
      url: 'https://testnet.berascan.com' 
    },
  },
});

module.exports = { bepolia }; 