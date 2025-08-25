#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

// Simple SQLite wrapper using sqlite3 command
class SimpleDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async run(sql, params = []) {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
      // Escape parameters and build SQL
      let finalSql = sql;
      if (params.length > 0) {
        // Simple parameter substitution for basic usage
        for (let i = 0; i < params.length; i++) {
          const param = params[i].toString().replace(/'/g, "''"); // Escape single quotes
          finalSql = finalSql.replace('?', `'${param}'`);
        }
      }

      const sqlite = spawn('sqlite3', [this.dbPath, finalSql]);
      let output = '';
      let error = '';

      sqlite.stdout.on('data', (data) => {
        output += data.toString();
      });

      sqlite.stderr.on('data', (data) => {
        error += data.toString();
      });

      sqlite.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`SQLite error: ${error}`));
        }
      });
    });
  }

  close() {
    // No-op for command line sqlite3
  }
}

// GraphQL query from the curl request
const query = {
  "operationName": "GetValidators",
  "variables": {
    "sortBy": "lastDayDistributedBGTAmount",
    "sortOrder": "desc",
    "chain": "BERACHAIN",
    "where": {},
    "skip": 0,
    "pageSize": 1000
  },
  "query": `query GetValidators($where: GqlValidatorFilter, $sortBy: GqlValidatorOrderBy = lastDayDistributedBGTAmount, $sortOrder: GqlValidatorOrderDirection = desc, $pageSize: Int, $skip: Int, $search: String, $chain: GqlChain) {
  validators: polGetValidators(
    where: $where
    orderBy: $sortBy
    orderDirection: $sortOrder
    first: $pageSize
    skip: $skip
    search: $search
    chain: $chain
  ) {
    pagination {
      currentPage
      totalCount
      totalPages
      pageSize
      __typename
    }
    validators {
      ...ApiValidator
      __typename
    }
    __typename
  }
}

fragment ApiValidator on GqlValidator {
  ...ApiValidatorMinimal
  operator
  rewardAllocationWeights {
    ...ApiRewardAllocationWeight
    __typename
  }
  lastBlockUptime {
    isActive
    __typename
  }
  metadata {
    name
    logoURI
    website
    description
    __typename
  }
  __typename
}

fragment ApiValidatorMinimal on GqlValidator {
  id
  pubkey
  operator
  metadata {
    name
    logoURI
    __typename
  }
  dynamicData {
    activeBoostAmount
    usersActiveBoostCount
    queuedBoostAmount
    usersQueuedBoostCount
    allTimeDistributedBGTAmount
    rewardRate
    stakedBeraAmount
    lastDayDistributedBGTAmount
    activeBoostAmountRank
    boostApr
    commissionOnIncentives
    __typename
  }
  __typename
}

fragment ApiRewardAllocationWeight on GqlValidatorRewardAllocationWeight {
  percentageNumerator
  validatorId
  receivingVault {
    ...ApiVault
    __typename
  }
  receiver
  startBlock
  __typename
}

fragment ApiVault on GqlRewardVault {
  id: vaultAddress
  vaultAddress
  address: vaultAddress
  isVaultWhitelisted
  dynamicData {
    allTimeReceivedBGTAmount
    apr
    bgtCapturePercentage
    bgtCapturePerBlock
    activeIncentivesValueUsd
    activeIncentivesRateUsd
    bgtCapturePerBlock
    tvl
    __typename
  }
  stakingToken {
    address
    name
    symbol
    decimals
    __typename
  }
  metadata {
    name
    logoURI
    url
    protocolName
    protocolIcon
    description
    categories
    action
    __typename
  }
  activeIncentives {
    ...ApiVaultIncentive
    __typename
  }
  __typename
}

fragment ApiVaultIncentive on GqlRewardVaultIncentive {
  active
  remainingAmount
  remainingAmountUsd
  incentiveRate
  incentiveRateUsd
  tokenAddress
  token {
    address
    name
    symbol
    decimals
    __typename
  }
  __typename
}`
};

// Introspection query to explore the schema
const introspectionQuery = {
  "query": `query IntrospectionQuery {
    __schema {
      types {
        name
        description
        fields {
          name
          description
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  }`
};

// Try to get more detailed validator info
const detailedValidatorQuery = {
  "operationName": "GetDetailedValidator",
  "variables": {
    "chain": "BERACHAIN",
    "where": {},
    "skip": 0,
    "pageSize": 1
  },
  "query": `query GetDetailedValidator($where: GqlValidatorFilter, $chain: GqlChain, $pageSize: Int, $skip: Int) {
    validators: polGetValidators(
      where: $where
      first: $pageSize
      skip: $skip
      chain: $chain
    ) {
      validators {
        id
        pubkey
        operator
        address
        proposer_address
        consensus_address
        bech32_address
        hex_address
        metadata {
          name
          logoURI
          website
          description
        }
        dynamicData {
          activeBoostAmount
          stakedBeraAmount
        }
      }
    }
  }`
};

// Try to explore the valStats field
const valStatsQuery = {
  "operationName": "GetValidatorStats",
  "variables": {
    "chain": "BERACHAIN",
    "where": {},
    "skip": 0,
    "pageSize": 1
  },
  "query": `query GetValidatorStats($where: GqlValidatorFilter, $chain: GqlChain, $pageSize: Int, $skip: Int) {
    validators: polGetValidators(
      where: $where
      first: $pageSize
      skip: $skip
      chain: $chain
    ) {
      validators {
        id
        pubkey
        operator
        valStats {
          __typename
        }
        metadata {
          name
        }
      }
    }
  }`
};

// Request options matching the curl command
const requestOptions = {
  hostname: 'api.berachain.com',
  port: 443,
  path: '/',
  method: 'POST',
  headers: {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'origin': 'https://hub.berachain.com',
    'priority': 'u=1, i',
    'referer': 'https://hub.berachain.com/',
    'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
  }
};

function makeRequest() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(query);
    requestOptions.headers['content-length'] = Buffer.byteLength(postData);

    const req = https.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function fetchAllValidators() {
  try {
    console.log('Fetching validators from Berachain GraphQL API...');
    
    // First, let's try to introspect the schema to see what's available
    console.log('\n--- Trying GraphQL Introspection ---');
    try {
      const introspectionOptions = { ...requestOptions };
      const introspectionPostData = JSON.stringify(introspectionQuery);
      introspectionOptions.headers['content-length'] = Buffer.byteLength(introspectionPostData);
      
      const introspectionResponse = await new Promise((resolve, reject) => {
        const req = https.request(introspectionOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse introspection JSON: ${e.message}`));
              }
            } else {
              reject(new Error(`Introspection HTTP ${res.statusCode}: ${data}`));
            }
          });
        });
        req.on('error', reject);
        req.write(introspectionPostData);
        req.end();
      });
      
      console.log('Introspection response received');
      if (introspectionResponse.data && introspectionResponse.data.__schema) {
        const validatorType = introspectionResponse.data.__schema.types.find(t => t.name === 'GqlValidator');
        if (validatorType) {
          console.log('\nAvailable fields for GqlValidator:');
          validatorType.fields.forEach(field => {
            console.log(`  - ${field.name}: ${field.type.name || field.type.kind}`);
          });
        }
      }
    } catch (introspectionError) {
      console.log('Introspection failed (this is normal for production APIs):', introspectionError.message);
    }
    
    // Now try the detailed validator query
    console.log('\n--- Trying Detailed Validator Query ---');
    try {
      const detailedOptions = { ...requestOptions };
      const detailedPostData = JSON.stringify(detailedValidatorQuery);
      detailedOptions.headers['content-length'] = Buffer.byteLength(detailedPostData);
      
      const detailedResponse = await new Promise((resolve, reject) => {
        const req = https.request(detailedOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse detailed JSON: ${e.message}`));
              }
            } else {
              reject(new Error(`Detailed query HTTP ${res.statusCode}: ${data}`));
            }
          });
        });
        req.on('error', reject);
        req.write(detailedPostData);
        req.end();
      });
      
      console.log('Detailed validator response received');
      if (detailedResponse.data && detailedResponse.data.validators && detailedResponse.data.validators.validators) {
        const firstValidator = detailedResponse.data.validators.validators[0];
        console.log('\nDetailed validator fields available:');
        console.log(Object.keys(firstValidator));
        console.log('\nFirst validator data:');
        console.log(JSON.stringify(firstValidator, null, 2));
      }
    } catch (detailedError) {
      console.log('Detailed query failed:', detailedError.message);
    }
    
    // Now try the valStats query
    console.log('\n--- Trying ValStats Query ---');
    try {
      const valStatsOptions = { ...requestOptions };
      const valStatsPostData = JSON.stringify(valStatsQuery);
      valStatsOptions.headers['content-length'] = Buffer.byteLength(valStatsPostData);
      
      const valStatsResponse = await new Promise((resolve, reject) => {
        const req = https.request(valStatsOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse valStats JSON: ${e.message}`));
              }
            } else {
              reject(new Error(`ValStats query HTTP ${res.statusCode}: ${data}`));
            }
          });
        });
        req.on('error', reject);
        req.write(valStatsPostData);
        req.end();
      });
      
      console.log('ValStats response received');
      if (valStatsResponse.data && valStatsResponse.data.validators && valStatsResponse.data.validators.validators) {
        const firstValidator = valStatsResponse.data.validators.validators[0];
        console.log('\nValStats validator fields available:');
        console.log(Object.keys(firstValidator));
        if (firstValidator.valStats) {
          console.log('\nValStats fields available:');
          console.log(Object.keys(firstValidator.valStats));
          console.log('\nValStats data:');
          console.log(JSON.stringify(firstValidator.valStats, null, 2));
        }
      }
    } catch (valStatsError) {
      console.log('ValStats query failed:', valStatsError.message);
    }
    
    // Now proceed with the original query
    console.log('\n--- Fetching Validators with Original Query ---');
    const response = await makeRequest();
    
    if (!response.data || !response.data.validators) {
      throw new Error('Invalid response structure');
    }

    const { validators, pagination } = response.data.validators;
    
    console.log(`Found ${validators.length} validators (page 1 of ${pagination.totalPages})`);
    console.log(`Total validators: ${pagination.totalCount}`);

    // Check if we need more pages
    const allValidators = [...validators];
    
    if (pagination.totalPages > 1) {
      console.log('Fetching additional pages...');
      
      for (let page = 2; page <= pagination.totalPages; page++) {
        const pageQuery = { ...query };
        pageQuery.variables.skip = (page - 1) * pagination.pageSize;
        
        console.log(`Fetching page ${page}/${pagination.totalPages}...`);
        
        const pageOptions = { ...requestOptions };
        const pagePostData = JSON.stringify(pageQuery);
        pageOptions.headers['content-length'] = Buffer.byteLength(pagePostData);
        
        const pageResponse = await new Promise((resolve, reject) => {
          const req = https.request(pageOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error(`Failed to parse JSON: ${e.message}`));
                }
              } else {
                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              }
            });
          });
          
          req.on('error', reject);
          req.write(pagePostData);
          req.end();
        });
        
        if (pageResponse.data && pageResponse.data.validators) {
          allValidators.push(...pageResponse.data.validators.validators);
        }
        
        // Small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Initialize SQLite database
    const db = new SimpleDB('validators.db');
    
    // Create validators table if it doesn't exist (matching Go code structure)
    await db.run(`
      CREATE TABLE IF NOT EXISTS validators (
        address TEXT PRIMARY KEY,
        compressed_pubkey TEXT,
        name TEXT,
        proposer_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Process and output the data
    console.log('\n--- CSV Output ---');
    console.log('name,address,cometbft_pubkey,operator,proposer_address');
    console.log('Note: proposer_address is not available from GraphQL API - would need consensus layer RPC queries');
    console.log('Note: cometbft_pubkey contains the raw CometBFT public key (not compressed)');
    
    let csvData = 'name,address,cometbft_pubkey,operator,proposer_address\n';
    
    for (const validator of allValidators) {
      const name = validator.metadata?.name || 'N/A';
      const address = validator.id || 'N/A'; // Using id as address to match Go structure
      const cometbft_pubkey = validator.pubkey || 'N/A';
      const operator = validator.operator || 'N/A';
      // Note: proposer_address is not available from the GraphQL API
      // To get proposer information, we would need to query the consensus layer RPC
      // for recent blocks and extract proposer_address from block headers
      const proposer_address = 'N/A'; // Not available from GraphQL API
      
      // Escape commas in name
      const escapedName = name.replace(/,/g, ';');
      
      const csvLine = `${escapedName},${address},${cometbft_pubkey},${operator},${proposer_address}`;
      console.log(csvLine);
      csvData += csvLine + '\n';
      
      // Insert into database (matching Go code structure)
      try {
        await db.run(`
          INSERT OR REPLACE INTO validators (address, compressed_pubkey, name, proposer_address)
          VALUES (?, ?, ?, ?)
        `, [address, cometbft_pubkey, escapedName, proposer_address]);
      } catch (err) {
        console.error(`Error inserting validator ${address}: ${err.message}`);
      }
    }

    // Close database connection
    db.close();

    // Save CSV to file
    const filename = 'validators.csv';
    fs.writeFileSync(filename, csvData);
    console.log(`\nData saved to ${filename} and validators.db`);
    console.log(`Total validators processed: ${allValidators.length}`);

  } catch (error) {
    console.error('Error fetching validators:', error.message);
    process.exit(1);
  }
}

// Run the script
fetchAllValidators();
