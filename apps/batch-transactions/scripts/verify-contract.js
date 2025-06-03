const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const BATCH_TX_ADDRESS = '0x23ac058ef2dbcaeb0860f8667fda977bcf26e580';
const BATCH_TX_SOURCE = fs.readFileSync(path.join(__dirname, '../src/BatchTransaction.sol'), 'utf8');

async function verifyContract() {
  try {
    const response = await axios.get('https://api-testnet.berascan.com/api', {
      params: {
        apikey: 'QN7MFKS8DGD67A64A51FHT5AQE3AM3U8QV',
        module: 'contract',
        action: 'verifysourcecode',
        contractaddress: BATCH_TX_ADDRESS,
        sourceCode: BATCH_TX_SOURCE,
        codeformat: 'solidity-single-file',
        compilerversion: 'v0.8.19+commit.7dd6d404',
        optimizationUsed: 0,
        runs: 200,
        constructorArguements: '' // No constructor arguments
      }
    });

    console.log('Verification response:', response.data);
    
    if (response.data.status === '1') {
      console.log('Contract verification submitted successfully!');
      console.log('GUID:', response.data.result);
      console.log('Please wait a few minutes for the verification to complete.');
    } else {
      console.error('Verification failed:', response.data.message);
    }
  } catch (error) {
    console.error('Error verifying contract:', error.message);
  }
}

verifyContract(); 