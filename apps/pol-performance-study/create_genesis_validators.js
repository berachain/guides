#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Configuration
const API_URL = 'http://34.159.172.173:26657/validators?height=5&per_page=99';
const BEACON_DEPOSIT_ADDRESS = '0x4242424242424242424242424242424242424242';
const RPC_URL = 'https://rpc.berachain.com';

// Helper function to fetch data from URL
function fetchData(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', (err) => reject(err));
  });
}

// Helper function to execute cast call
function getOperator(pubkey) {
  return new Promise((resolve, reject) => {
    // Remove '0x' prefix if present and add it back to ensure consistent format
    const formattedPubkey = pubkey.startsWith('0x') ? pubkey : `0x${pubkey}`;
    
    const args = [
      'call',
      BEACON_DEPOSIT_ADDRESS,
      'getOperator(bytes)',
      formattedPubkey,
      '--rpc-url',
      RPC_URL
    ];
    
    execFile('cast', args, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing cast command: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        resolve(''); // Return empty string on error to continue processing
      } else {
        // Strip out the 24 leading 0's in the operator address
        // Operator addresses are 42 chars (with 0x), so we want to keep the last 20 bytes (40 chars)
        const fullAddress = stdout.trim();
        if (fullAddress.length >= 42) {
          // Keep 0x prefix and the last 40 characters (20 bytes)
          const strippedAddress = '0x' + fullAddress.slice(-40);
          resolve(strippedAddress);
        } else {
          resolve(fullAddress); // Return as is if format is unexpected
        }
      }
    });
  });
}

async function main() {
  try {
    // Step 1: Read balidators.csv
    console.log('Reading balidators.csv...');
    const balidatorsData = fs.readFileSync('balidators.csv', 'utf8');
    const balidators = parse(balidatorsData, { columns: false });
    
    // Create a map of address to validator info
    const validatorsMap = {};
    for (let i = 1; i < balidators.length; i++) { // Skip header row
      const row = balidators[i];
      if (row[1]) { // If address is not empty
        validatorsMap[row[1]] = {
          title: row[0] || 'Unknown',
          pubkey: row[2] || ''
        };
      }
    }
    
    // Step 2: Fetch validators from API
    console.log('Fetching validators from API...');
    const validatorsData = await fetchData(API_URL);
    const validators = validatorsData.result.validators;
    
    
    // Step 4: Process validators and get operator addresses
    console.log('Processing validators and fetching operator addresses...');
    const outputData = [];
    
    for (const validator of validators) {
      const address = validator.address;
      
      // Find matching validator in balidators.csv
      let title = 'Unknown';
      let pubkey = validator.pub_key.value;
      
      if (validatorsMap[address]) {
        title = validatorsMap[address].title;
        pubkey = validatorsMap[address].pubkey || pubkey;
      }
      
      // Get operator address from BeaconDeposit contract
      const operatorAddress = await getOperator(pubkey);
      
      outputData.push([
        address,
        title,
        pubkey,
        operatorAddress
      ]);
    }
    
    // Step 5: Write output to CSV
    console.log('Writing to genesis_validators.csv...');
    const header = ['CometBFT Address', 'Name', 'CometBFT Pubkey', 'Operator Address'];
    const csvContent = stringify([header, ...outputData]);
    
    fs.writeFileSync('genesis_validators.csv', csvContent);
    console.log('CSV file genesis_validators.csv has been generated successfully.');
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();