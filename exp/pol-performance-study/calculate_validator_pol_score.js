const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const CONSENSUS_RPC = 'http://37.27.231.195:59820';
const EXECUTION_RPC = 'http://37.27.231.195:59830';
const BGT_CONTRACT = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
const BERACHEF_CONTRACT = '0x0000000000000000000000000000000000001002'; // BeraChef contract
const QUEUE_REWARD_ALLOCATION_EVENT_TOPIC = '0x22fe555512d9a04d20e3735ac5fe7a73227c2c6398f1453a5d60ce7aaf5de2ae';
const SECONDS_PER_DAY = 86400;
const BLOCK_TIME = 2; // 2 seconds per block
const BLOCK_CACHE_FILE = '.last_block_cache.json'; // File to store the last block number

// Query configuration
const DAYS_TO_LOOK_BACK = 46; // How many days to go back for the first day in the report
const DAYS_TO_QUERY = 45;     // How many consecutive days to query starting from DAYS_TO_LOOK_BACK
const SHOW_DETAILED_INFO = false; // Set to true to include VP and boost columns, false to show only the ratio

// Function to load validators from CSV with the new format
function loadValidatorsFromCSV() {
    try {
        const csvContent = fs.readFileSync('genesis_validators.csv', 'utf8');
        const lines = csvContent.split('\n');
        const validators = [];
        
        // Skip header line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const [cometAddress, name, pubkey, operatorAddress] = line.split(',');
                validators.push({
                    name: name,
                    proposer: cometAddress, // CometBFT Address for consensus layer queries
                    pubkey: pubkey.startsWith('0x') ? pubkey.substring(2) : pubkey, // Remove 0x prefix if present
                    operatorAddress: operatorAddress // Operator address for EL queries
                });
            }
        }
        
        console.error(`Loaded ${validators.length} validators from CSV`);
        return validators;
    } catch (error) {
        console.error('Error loading validators from CSV:', error.message);
        return [];
    }
}

// Function to make HTTP request to consensus RPC
function makeConsensusRequest(path, callback) {
    const url = `${CONSENSUS_RPC}${path}`;
    const client = http;
    
    const req = client.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                callback(null, response);
            } catch (error) {
                callback(error);
            }
        });
    });

    req.on('error', (error) => {
        callback(error);
    });

    req.end();
}

// Function to call a contract function using cast
function callContractFunction(contractAddress, functionSignature, params, blockNumber = 'latest') {
    try {
        // Format parameters for cast call
        const formattedParams = params.map(p => `"${p}"`).join(' ');
        
        // Build the cast call command
        const blockParam = blockNumber === 'latest' ? '' : `--block ${blockNumber}`;
        const cmd = `cast call ${blockParam} --rpc-url ${EXECUTION_RPC} ${contractAddress} "${functionSignature}" ${formattedParams}`;
        
        // Execute the command
        const result = execSync(cmd, { 
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }).trim();
        
        return result;
    } catch (error) {
        console.error(`Error calling contract function: ${error.message}`);
        throw error;
    }
}

// Function to get block by number using cast
function getBlockByNumber(blockNumber, fullTransactions = false) {
    try {
        const hexBlockNumber = `0x${blockNumber.toString(16)}`;
        const cmd = `cast block ${hexBlockNumber} --rpc-url ${EXECUTION_RPC} --json`;
        const result = execSync(cmd, { encoding: 'utf8' });
        return JSON.parse(result);
    } catch (error) {
        console.error(`Error getting block ${blockNumber}: ${error.message}`);
        throw error;
    }
}

// Function to get the latest block number
function getLatestBlockNumber() {
    try {
        const cmd = `cast block-number --rpc-url ${EXECUTION_RPC}`;
        const result = execSync(cmd, { 
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }).trim();
        return parseInt(result);
    } catch (error) {
        console.error(`Error getting latest block number: ${error.message}`);
        throw error;
    }
}

// Function to load the last block cache
function loadBlockCache() {
    try {
        if (fs.existsSync(BLOCK_CACHE_FILE)) {
            const cacheData = JSON.parse(fs.readFileSync(BLOCK_CACHE_FILE, 'utf8'));
            // Check if cache is still valid (less than 24 hours old)
            const now = Date.now();
            if (cacheData.timestamp && (now - cacheData.timestamp) < 24 * 60 * 60 * 1000) {
                return cacheData;
            }
        }
    } catch (error) {
        console.error(`Error loading block cache: ${error.message}`);
    }
    return { blocks: {} };
}

// Function to save the block cache
function saveBlockCache(cache) {
    try {
        // Add timestamp to track cache age
        cache.timestamp = Date.now();
        fs.writeFileSync(BLOCK_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (error) {
        console.error(`Error saving block cache: ${error.message}`);
    }
}

// Function to get the timestamp for midnight UTC on a given date
function getMidnightTimestamp(date) {
    const midnight = new Date(date);
    midnight.setUTCHours(0, 0, 0, 0);
    return Math.floor(midnight.getTime() / 1000);
}

// Function to find the boundary block for a given timestamp
function findBoundaryBlock(targetTimestamp, startBlock, endBlock, callback) {
    let left = startBlock;
    let right = endBlock;
    let result = null;
    let tries = 0;
    
    function searchBlock() {
        if (left > right) {
            console.error(`Found block after ${tries} tries`);
            callback(result);
            return;
        }
        
        tries++;
        const mid = Math.floor((left + right) / 2);
        
        try {
            const block = getBlockByNumber(mid, false);
            if (block && block.timestamp) {
                const timestamp = parseInt(block.timestamp, 16);
                
                if (timestamp >= targetTimestamp) {
                    // Check if previous block is before target
                    if (mid > startBlock) {
                        try {
                            const prevBlock = getBlockByNumber(mid - 1, false);
                            if (prevBlock && prevBlock.timestamp) {
                                const prevTimestamp = parseInt(prevBlock.timestamp, 16);
                                if (prevTimestamp < targetTimestamp) {
                                    result = mid;
                                    console.error(`Found block after ${tries} tries`);
                                    callback(result);
                                    return;
                                }
                            }
                        } catch (prevError) {
                            console.error(`Error getting previous block ${mid-1}:`, prevError.message);
                        }
                    }
                    right = mid - 1;
                } else {
                    left = mid + 1;
                }
            } else {
                right = mid - 1;
            }
            
            // Continue search in next tick to avoid stack overflow
            process.nextTick(searchBlock);
        } catch (error) {
            console.error(`Error getting block ${mid}:`, error.message);
            right = mid - 1;
            process.nextTick(searchBlock);
        }
    }
    
    // Start the search
    searchBlock();
}

// Function to get validator voting power from consensus layer
function getValidatorVotingPower(blockHeight, callback) {
    makeConsensusRequest(`/validators?height=${blockHeight}&per_page=99`, (error, response) => {
        if (error) {
            console.error(`Error getting validator voting power for block ${blockHeight}:`, error.message);
            callback(null);
            return;
        }
        
        if (response.result && response.result.validators) {
            const validators = {};
            response.result.validators.forEach(validator => {
                validators[validator.address] = {
                    address: validator.address,
                    voting_power: validator.voting_power,
                    pub_key: validator.pub_key.value
                };
            });
            callback(validators);
        } else {
            callback(null);
        }
    });
}

// Function to get QueueRewardAllocation events for all validators within a block range
function getQueueRewardAllocationEventsForAllValidators(fromBlock, toBlock, genesisValidators) {
    try {
        const MAX_BLOCK_RANGE = 99999; // Stay under the 100000 limit
        let allResults = '';
        
        // Process in chunks if the range is too large
        for (let currentBlock = fromBlock; currentBlock <= toBlock; currentBlock += MAX_BLOCK_RANGE) {
            const endBlock = Math.min(currentBlock + MAX_BLOCK_RANGE - 1, toBlock);
            const cmd = `cast logs --from-block ${currentBlock} --to-block ${endBlock} --rpc-url ${EXECUTION_RPC} ${QUEUE_REWARD_ALLOCATION_EVENT_TOPIC}`;
            
            // Log the command being executed
            console.error('Executing command:', cmd);
            
            // Execute the command and append results
            const chunkResult = execSync(cmd, { 
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            }).trim();
            if (chunkResult) {
                allResults += chunkResult + '\n';
            }
        }
        
        // Use the combined results
        
        // Parse the result - split by lines and filter empty lines
        const eventLines = allResults.split('\n').filter(line => line.trim().length > 0);
        
        // Create a map to count events per validator
        const validatorEventCounts = {};
        
        // Initialize all genesis validators with 0 events
        genesisValidators.forEach(validator => {
            validatorEventCounts[validator.operatorAddress.toLowerCase()] = 0;
        });
        
        // Parse each event line to extract the originating address
        eventLines.forEach(line => {
            try {
                // Parse the YAML-like output from cast logs
                const lines = line.split('\n');
                let address = null;
                
                lines.forEach(l => {
                    if (l.trim().startsWith('address:')) {
                        address = l.split(':')[1].trim();
                    }
                });
                
                if (address && validatorEventCounts.hasOwnProperty(address.toLowerCase())) {
                    validatorEventCounts[address.toLowerCase()]++;
                }
            } catch (parseError) {
                // Skip malformed lines
                console.error(`Error parsing event line: ${parseError.message}`);
            }
        });
        
        return validatorEventCounts;
    } catch (error) {
        console.error(`Error getting reward allocation events: ${error.message}`);
        // Return empty counts for all validators
        const validatorEventCounts = {};
        genesisValidators.forEach(validator => {
            validatorEventCounts[validator.operatorAddress.toLowerCase()] = 0;
        });
        return validatorEventCounts;
    }
}

// Function to get boost amount for a validator from BGT contract using CometBFT public key with cast
function getValidatorBoost(validatorPubkey, blockNumber) {
    try {
        // Call the boostees(bytes) function on the BGT contract
        const result = callContractFunction(
            BGT_CONTRACT,
            "boostees(bytes)",
            [`0x${validatorPubkey}`],
            blockNumber
        );
        
        if (result && result !== '0x') {
            // Cast returns the hex value, convert to decimal
            const boostAmount = parseInt(result, 16);
            return boostAmount;
        }
        return 0;
    } catch (error) {
        console.error(`Error getting boost for validator with pubkey ${validatorPubkey}:`, error.message);
        return 0;
    }
}

// Function to convert boost from wei to ether
function weiToEther(wei) {
    return wei / 1e18;
}

// Function to convert voting power from gwei to billions
function gweiToBillions(gwei) {
    return gwei / 1e9;
}

// Function to calculate boost per stake
function calculateBoostPerStake(boost, votingPower) {
    if (votingPower === 0) return 0;
    // Both values are already normalized (boost to ether, voting power to billions)
    return boost / votingPower;
}

// Function to find all day boundary blocks for the period
function findAllDayBoundaries(dates, callback) {
    const latestBlock = getLatestBlockNumber();
    const boundaryBlocks = {};
    let startBlock = 1;
    let processedDates = 0;
    
    // Process each date to find its boundary block
    function processDates(index) {
        if (index >= dates.length) {
            console.error(`Found all ${processedDates} day boundary blocks`);
            callback(boundaryBlocks);
            return;
        }
        
        const date = dates[index];
        const dateStr = date.toISOString().split('T')[0];
        const targetTimestamp = getMidnightTimestamp(date);
        
        // Check if we have a cached block for the previous day
        const previousDay = new Date(date);
        previousDay.setDate(previousDay.getDate() - 1);
        const prevDateStr = previousDay.toISOString().split('T')[0];
        
        if (boundaryBlocks[prevDateStr]) {
            // Use the previous day's block as a starting point
            startBlock = boundaryBlocks[prevDateStr];
            console.error(`Using cached block ${startBlock} from ${prevDateStr} as starting point`);
        }
        
        findBoundaryBlock(targetTimestamp, startBlock, latestBlock, function(boundaryBlock) {
            if (boundaryBlock) {
                boundaryBlocks[dateStr] = boundaryBlock;
                processedDates++;
                console.error(`Found boundary block ${boundaryBlock} for ${dateStr} (${index + 1}/${dates.length})`);
            } else {
                console.error(`Could not find boundary block for ${dateStr}`);
            }
            
            // Process next date
            process.nextTick(() => processDates(index + 1));
        });
    }
    
    // Start processing dates
    processDates(0);
}

// Main function to query one day
function queryOneDay(targetDate, validators, boundaryBlocks, callback) {
    const dateStr = targetDate.toISOString().split('T')[0];
    
    // Get the boundary blocks for this day and the next day
    const startBlock = boundaryBlocks[dateStr];
    
    // Get the next day's date
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];
    const endBlock = boundaryBlocks[nextDateStr] ? boundaryBlocks[nextDateStr] - 1 : getLatestBlockNumber();
    
    if (!startBlock) {
        console.error(`No boundary block found for ${dateStr}`);
        callback(null);
        return;
    }
    
    console.error(`Querying ${dateStr} from block ${startBlock} to ${endBlock}...`);
    
    // Try to get validator voting power from consensus layer, retrying up to 5 times if needed
    getVotingPowerWithRetry(startBlock, 1, function(votingPowerData) {
        if (!votingPowerData) {
            console.error(`Could not get voting power data for block ${startBlock} after 5 attempts. Validator voting power is feeling a bit powerless.`);
            callback(null);
            return;
        }
        
        // Process validators to get boost data
        processValidators(validators, 0, [], votingPowerData, startBlock, dateStr, function(boostResults) {
            // Now get reward allocation events for the day
            queryRewardAllocationsForDay(startBlock, endBlock, validators, function(eventResults) {
                // Merge boost results with event results
                const mergedResults = boostResults.map(boostData => {
                    const eventData = eventResults.find(e => e.name === boostData.name);
                    return {
                        ...boostData,
                        reward_allocation_events: eventData ? eventData.reward_allocation_events : 0
                    };
                });
                
                callback(mergedResults);
            });
        });
    });
}

// Function to retry getting voting power data
function getVotingPowerWithRetry(blockHeight, attempt, callback) {
    if (attempt > 5) {
        callback(null);
        return;
    }
    
    getValidatorVotingPower(blockHeight, function(votingPowerData) {
        if (votingPowerData) {
            callback(votingPowerData);
        } else {
            console.error(`Attempt ${attempt} to get voting power data for block ${blockHeight} failed.`);
            if (attempt < 5) {
                // Wait a bit before retrying (exponential backoff: 500ms, 1000ms, 1500ms, etc.)
                setTimeout(function() {
                    getVotingPowerWithRetry(blockHeight, attempt + 1, callback);
                }, attempt * 500);
            } else {
                callback(null);
            }
        }
    });
}

// Function to query reward allocation events for one day
function queryRewardAllocationsForDay(startBlock, endBlock, validators, callback) {
    try {
        // Get all QueueRewardAllocation events for the day
        const validatorEventCounts = getQueueRewardAllocationEventsForAllValidators(startBlock, endBlock, validators);
        
        // Create results array with event counts for each validator
        const results = validators.map(validator => {
            const eventCount = validatorEventCounts[validator.operatorAddress.toLowerCase()] || 0;
            
            return {
                name: validator.name,
                validator_address: validator.proposer,
                operator_address: validator.operatorAddress,
                pubkey: validator.pubkey,
                reward_allocation_events: eventCount
            };
        });
        
        callback(results);
    } catch (error) {
        console.error(`Error processing reward allocations for day: ${error.message}`);
        // Return results with 0 events for all validators
        const results = validators.map(validator => ({
            name: validator.name,
            validator_address: validator.proposer,
            operator_address: validator.operatorAddress,
            pubkey: validator.pubkey,
            reward_allocation_events: 0
        }));
        callback(results);
    }
}

// Process validators one by one to avoid overwhelming the RPC
function processValidators(validators, index, results, votingPowerData, boundaryBlock, dateStr, callback) {
    if (index >= validators.length) {
        callback(results);
        return;
    }
    
    const validator = validators[index];
    const validatorAddress = validator.proposer;
    const rawVotingPower = votingPowerData[validatorAddress]?.voting_power || 0;
    
    try {
        const rawBoostAmount = getValidatorBoost(validator.pubkey, boundaryBlock);
        
        // Convert values to more readable units
        const votingPower = gweiToBillions(rawVotingPower);
        const boostAmount = weiToEther(rawBoostAmount);
        const boostPerStake = calculateBoostPerStake(boostAmount, votingPower);
        
        results.push({
            date: dateStr,
            name: validator.name,
            validator_address: validatorAddress,
            operator_address: validator.operatorAddress,
            voting_power: votingPower,
            boost_amount: boostAmount,
            boost_per_stake: boostPerStake
        });
    } catch (error) {
        console.error(`Error processing validator ${validator.name}: ${error.message}`);
        results.push({
            date: dateStr,
            name: validator.name,
            validator_address: validatorAddress,
            operator_address: validator.operatorAddress,
            voting_power: gweiToBillions(rawVotingPower),
            boost_amount: 0,
            boost_per_stake: 0
        });
    }
    
    // Process next validator after a small delay
    setTimeout(function() {
        processValidators(validators, index + 1, results, votingPowerData, boundaryBlock, dateStr, callback);
    }, 50); // 50ms delay between validators to avoid overwhelming the RPC
}

// Function to generate the report with data from multiple days
function generateReport(validatorData, dates) {
    // Create a map of validator names to their data for each date
    const validatorMap = {};
    
    // Initialize the map with validator names
    validatorData.forEach(dayData => {
        dayData.forEach(validator => {
            if (!validatorMap[validator.name]) {
                validatorMap[validator.name] = {
                    name: validator.name,
                    validator_address: validator.validator_address,
                    operator_address: validator.operator_address,
                    days: {},
                    total_reward_events: 0,
                    avg_reward_events: 0,
                    avg_boost_per_stake: 0
                };
            }
            
            // Add data for this day
            validatorMap[validator.name].days[validator.date] = {
                voting_power: validator.voting_power,
                boost_amount: validator.boost_amount,
                boost_per_stake: validator.boost_per_stake,
                reward_allocation_events: validator.reward_allocation_events || 0
            };
            
            // Add to total events
            validatorMap[validator.name].total_reward_events += validator.reward_allocation_events || 0;
        });
    });
    
    // Calculate averages for each validator
    Object.values(validatorMap).forEach(validator => {
        const dayCount = Object.keys(validator.days).length;
        if (dayCount > 0) {
            validator.avg_reward_events = validator.total_reward_events / dayCount;
            
            // Calculate average boost per stake
            let totalBoostPerStake = 0;
            let daysWithData = 0;
            
            Object.values(validator.days).forEach(day => {
                if (day.boost_per_stake > 0) {
                    totalBoostPerStake += day.boost_per_stake;
                    daysWithData++;
                }
            });
            
            validator.avg_boost_per_stake = daysWithData > 0 ? totalBoostPerStake / daysWithData : 0;
        }
    });
    
    // Find maximum values for scaling
    const maxBoostPerStake = Math.max(...Object.values(validatorMap).map(v => v.avg_boost_per_stake));
    const maxRewardEvents = Math.max(...Object.values(validatorMap).map(v => v.avg_reward_events));

    // Calculate scores for each validator
    Object.values(validatorMap).forEach(validator => {
        // POL Score (0-100)
        validator.pol_score = validator.avg_boost_per_stake === 0 ? 0 :
            (validator.avg_boost_per_stake / maxBoostPerStake) * 100;

        // Updates Score (0-100)
        validator.updates_score = validator.avg_reward_events === 0 ? 0 :
            (validator.avg_reward_events / maxRewardEvents) * 100;

        // Total Score (weighted 2/3 POL, 1/3 Updates)
        validator.total_score = (2/3 * validator.pol_score) + (1/3 * validator.updates_score);
    });

    // Generate the CSV header
    let header = 'Validator Name,POL Score,Updates Score,Total Score,Validator Address,Operator Address';
    dates.forEach(date => {
        const dateStr = date.toISOString().split('T')[0];
        if (SHOW_DETAILED_INFO) {
            header += `,${dateStr} VP,${dateStr} Boost,${dateStr} Boost/Stake,${dateStr} Reward Events`;
        } else {
            header += `,${dateStr} Boost/Stake,${dateStr} Reward Events`;
        }
    });
    header += ',Avg Reward Events,Avg Boost/Stake';
    
    // Generate the CSV rows
    const rows = [];
    // Sort validators by total score descending
    const sortedValidators = Object.values(validatorMap).sort((a, b) => b.total_score - a.total_score);
    sortedValidators.forEach(validator => {
        let row = `${validator.name},${validator.pol_score.toFixed(2)},${validator.updates_score.toFixed(2)},${validator.total_score.toFixed(2)},${validator.validator_address},${validator.operator_address}`;
        
        dates.forEach(date => {
            const dateStr = date.toISOString().split('T')[0];
            const dayData = validator.days[dateStr] || { voting_power: 0, boost_amount: 0, boost_per_stake: 0 };
            
            if (SHOW_DETAILED_INFO) {
                row += `,${dayData.voting_power.toFixed(2)},${dayData.boost_amount.toFixed(2)},${dayData.boost_per_stake.toFixed(4)},${dayData.reward_allocation_events}`;
            } else {
                row += `,${dayData.boost_per_stake.toFixed(4)},${dayData.reward_allocation_events}`;
            }
        });
        
        // Add average columns
        row += `,${validator.avg_reward_events.toFixed(2)},${validator.avg_boost_per_stake.toFixed(4)}`;
        
        rows.push(row);
    });
    
    // Combine header and rows
    return [header, ...rows].join('\n');
}

// Main execution
function main() {
    if (!EXECUTION_RPC || !BGT_CONTRACT || !BERACHEF_CONTRACT) {
        console.error('Please set EXECUTION_RPC, BGT_CONTRACT, and BERACHEF_CONTRACT before running');
        return;
    }
    
    // Load validators from CSV
    const GENESIS_VALIDATORS = loadValidatorsFromCSV();
    if (GENESIS_VALIDATORS.length === 0) {
        console.error('No validators loaded from genesis_validators.csv. Exiting.');
        return;
    }

    // Load block cache
    const blockCache = loadBlockCache();
    console.error(`Loaded block cache with ${Object.keys(blockCache.blocks).length} entries`);

    // Define the dates to query based on configuration
    const today = new Date();
    const dates = [];
    
    for (let i = 0; i < DAYS_TO_QUERY; i++) {
        const daysAgo = DAYS_TO_LOOK_BACK - i;
        const targetDate = new Date(today.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
        dates.push(targetDate);
    }
    
    console.error(`Querying data for ${DAYS_TO_QUERY} days starting from ${dates[0].toISOString().split('T')[0]}`);
    
    // First, find all day boundary blocks
    findAllDayBoundaries(dates, function(boundaryBlocks) {
        // Save the boundary blocks to the cache
        blockCache.blocks = { ...blockCache.blocks, ...boundaryBlocks };
        saveBlockCache(blockCache);
        
        // Now process dates sequentially
        processDateSequentially(dates, 0, [], GENESIS_VALIDATORS, boundaryBlocks);
    });
}

// Process dates one by one
function processDateSequentially(dates, index, allResults, validators, blockCache) {
    if (index >= dates.length) {
        // All dates processed, generate report
        if (allResults.length > 0) {
            // Generate the report
            const report = generateReport(allResults, dates);
            
            // Write the report to a file
            const reportFileName = `validator_boost_reward_report_${new Date().toISOString().split('T')[0]}.csv`;
            fs.writeFileSync(reportFileName, report);
            console.error(`Report saved to ${reportFileName}`);
            
            // Also output to stdout
            console.log(report);
        } else {
            console.error('No results to report.');
        }
        return;
    }
    
    const date = dates[index];
    console.error(`Processing date ${date.toISOString().split('T')[0]} (${index + 1}/${dates.length})...`);
    
    queryOneDay(date, validators, blockCache, function(results) {
        if (results) {
            allResults.push(results);
            console.error(`Successfully processed ${date.toISOString().split('T')[0]}`);
        } else {
            console.error(`Failed to get results for ${date.toISOString().split('T')[0]}`);
        }
        
        // Process next date
        processDateSequentially(dates, index + 1, allResults, validators, blockCache);
    });
}

// Run the script
main();
