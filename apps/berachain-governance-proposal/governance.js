// Import required libraries
const ethers = require('ethers');
require('dotenv').config();

// Import ABI (Application Binary Interface) for various contracts
const BeraChefABI = require('./abi/BeraChef.json');
const BerachainGovernanceABI = require('./abi/BerachainGovernance.json');
const BGTABI = require('./abi/BGT.json');
const BerachainRewardsVaultABI = require('./abi/BerachainRewardsVault.json');
const ERC20ABI = require('./abi/ERC20.json');
const BerachainRewardsVaultFactoryABI = require('./abi/BerachainRewardsVaultFactory.json');

// Set up the Ethereum provider using the RPC URL from the .env file
const provider = new ethers.JsonRpcProvider(`${process.env.RPC}`, {
    chainId: 80084,  // Chain ID for Berachain
    name: 'Berachain',
    ensAddress: null
});

// Initialize the wallet using the private key from the .env file
let wallet;
try {
    wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
} catch (error) {
    console.error('Error creating wallet:', error.message);
    process.exit(1);
}

// Helper function to create contract instances
function createContract(address, abi, signer) {
    return new ethers.Contract(ethers.getAddress(address), abi, signer);
}

// Create instances of various contracts
const governance = createContract(process.env.GOVERNANCE_ADDRESS, BerachainGovernanceABI, wallet);
const beraChef = createContract(process.env.BERACHEF_ADDRESS, BeraChefABI, wallet);
const bgt = createContract(process.env.BGT_ADDRESS, BGTABI, wallet);
const factory = createContract(process.env.FACTORY_ADDRESS, BerachainRewardsVaultFactoryABI, wallet);
const token = createContract(process.env.LP_TOKEN_ADDRESS, ERC20ABI, wallet);
let rewardsVault;  // This will be initialized later when creating or retrieving a vault


// Function to check the current state of a proposal
async function checkProposalState(proposalId) {
    // Get the numerical state of the proposal
    const state = await governance.state(proposalId);
    // Define an array of state names corresponding to their numerical values
    const stateNames = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
    // Return both the numerical state and its corresponding name
    return { state, stateName: stateNames[state] };
}

// Function to determine the next stage in the governance process
async function getNextStage(currentState) {
    // Define the order of stages in the governance process
    const stageOrder = ['Pending', 'Active', 'Succeeded', 'Queued', 'Executed'];
    // Find the index of the current state in the stage order
    const currentIndex = stageOrder.indexOf(currentState);
    // Return the next stage if it exists, otherwise return 'End'
    return currentIndex < stageOrder.length - 1 ? stageOrder[currentIndex + 1] : 'End';
}

// Function to ensure the user has sufficient voting power to create a proposal
async function ensureSufficientVotingPower() {
    // Get the user's BGT balance
    const balance = await bgt.balanceOf(wallet.address);
    console.log('BGT balance:', balance.toString());

    // Check who the current delegatee is for the user's BGT
    const currentDelegatee = await bgt.delegates(wallet.address);
    console.log('Current delegatee:', currentDelegatee);

    // Get the user's current voting power
    const votingPower = await governance.getVotes(wallet.address, await provider.getBlockNumber() - 1);
    console.log('Your voting power:', votingPower.toString());

    // Get the proposal threshold (minimum voting power required to create a proposal)
    const proposalThreshold = await governance.proposalThreshold();
    console.log('Proposal threshold:', proposalThreshold.toString());

    // If voting power is less than the threshold
    if (votingPower < proposalThreshold) {
        // If BGT is not self-delegated, delegate it to self
        if (currentDelegatee !== wallet.address) {
            console.log('Delegating all BGT to self...');
            await (await bgt.delegate(wallet.address)).wait();
            console.log('Delegation complete');
        } else {
            // If already self-delegated but still not enough voting power
            console.log('Already delegated to self, but still not enough voting power');
            console.log('Please acquire more BGT tokens to meet the proposal threshold');
            return false;
        }
    }

    // Check updated voting power after potential delegation
    const updatedVotingPower = await governance.getVotes(wallet.address, await provider.getBlockNumber() - 1);
    console.log('Updated voting power:', updatedVotingPower.toString());

    // If still not enough voting power, return false
    if (updatedVotingPower < proposalThreshold) {
        console.log('Voting power is still less than proposal threshold, cannot create proposal');
        return false;
    }

    // Sufficient voting power achieved
    return true;
}

// Function to check if a proposal with given parameters already exists
async function checkExistingProposal(targets, values, calldatas, descriptionHash) {
    // Generate a proposal ID based on the given parameters
    const proposalId = await governance.hashProposal(targets, values, calldatas, descriptionHash);
    try {
        // Try to get the state of the proposal
        const state = await governance.state(proposalId);
        // If state is not 3 (Defeated), the proposal exists and is not defeated
        return state !== 3;
    } catch (error) {
        // If the error indicates the proposal doesn't exist, return false
        // Otherwise, propagate the error
        return error.reason === "GovernorNonexistentProposal(uint256)" ? false : Promise.reject(error);
    }
}

// Function to get an existing rewards vault or create a new one
async function getOrCreateVault() {
    console.log('Checking for existing rewards vault...');
    try {
        // Check if a vault already exists for the token
        const existingVaultAddress = await factory.getVault(process.env.LP_TOKEN_ADDRESS);

        // If a vault exists (address is not zero)
        if (existingVaultAddress !== ethers.ZeroAddress) {
            console.log('A rewards vault already exists for this token.');
            console.log(`Existing rewards vault address: ${existingVaultAddress}`);

            // Provide instructions to view vault details
            console.log('\nTo view details about the existing vault:');
            console.log('1. Go to https://bartio.beratrail.io');
            console.log(`2. Search for the rewards vault address: ${existingVaultAddress}`);
            console.log('3. Look for the "Create Rewards Vault" method in the transaction history');

            console.log('\nUsing the existing vault for this operation.');
            console.log('\nAdd this rewards vault address to your .env file under REWARDS_VAULT_ADDRESS:');
            console.log(`REWARDS_VAULT_ADDRESS=${existingVaultAddress}`);

            // Create a contract instance for the existing vault
            rewardsVault = new ethers.Contract(existingVaultAddress, BerachainRewardsVaultABI, wallet);
            return existingVaultAddress;
        }

        // If no existing vault, create a new one
        console.log('No existing vault found. Creating new rewards vault...');
        const tx = await factory.createRewardsVault(process.env.LP_TOKEN_ADDRESS);
        console.log('Transaction sent. Waiting for confirmation...');
        const receipt = await tx.wait();
        console.log('Rewards vault created. Transaction hash:', receipt.transactionHash);
        console.log();

        // Get the address of the newly created vault
        const newVaultAddress = await factory.getVault(process.env.LP_TOKEN_ADDRESS);
        console.log('New rewards vault created at:', newVaultAddress);

        // Provide instructions to view new vault details
        console.log('\nTo view details about the new vault:');
        console.log('1. Go to https://bartio.beratrail.io');
        console.log(`2. Search for the rewards vault address: ${newVaultAddress}`);
        console.log('3. Look for the "Create Rewards Vault" method in the transaction history');
        console.log('\nAdd this rewards vault address to your .env file under REWARDS_VAULT_ADDRESS:');
        console.log(`REWARDS_VAULT_ADDRESS=${newVaultAddress}`);

        // Create a contract instance for the new vault
        rewardsVault = new ethers.Contract(newVaultAddress, BerachainRewardsVaultABI, wallet);
        return newVaultAddress;
    } catch (error) {
        console.error('Error getting or creating rewards vault:', error);
        throw error;
    }
}

async function createProposal(targets, values, calldatas, description) {
    // Generate a hash of the proposal description
    const hash = ethers.id(description);

    // Check if a proposal with these parameters already exists
    const proposalExists = await checkExistingProposal(targets, values, calldatas, hash);

    if (proposalExists) {
        // If the proposal exists, get its ID
        const proposalId = await governance.hashProposal(targets, values, calldatas, hash);
        // Check the current state of the existing proposal
        const { stateName } = await checkProposalState(proposalId);
        // Determine the next stage in the proposal process
        const nextStage = await getNextStage(stateName);

        // Log information about the existing proposal
        console.log('\nA proposal with these parameters already exists.');
        console.log(`Proposal ID: ${proposalId.toString()}`);
        console.log(`Current state: ${stateName}`);

        // Inform about the next stage or if it's the final stage
        if (nextStage !== 'End') {
            console.log(`Next stage: ${nextStage}`);
        } else {
            console.log('This is the final stage of the proposal.');
        }

        // Provide instructions to add the proposal ID to the .env file
        console.log('\nAdd this proposal ID to your .env file under PROPOSAL_ID:');
        console.log(`PROPOSAL_ID=${proposalId.toString()}`);

        return proposalId.toString();
    }

    try {
        // If no existing proposal, create a new one
        console.log('Creating new proposal...');
        const tx = await governance.propose(targets, values, calldatas, description);
        const receipt = await tx.wait();
        console.log('Proposal transaction confirmed. Transaction hash:', receipt.transactionHash);
        console.log();

        // Get the ID of the newly created proposal
        const proposalId = await governance.hashProposal(targets, values, calldatas, hash);
        console.log('New proposal created with ID:', proposalId.toString());

        // Provide instructions to add the new proposal ID to the .env file
        console.log('\nAdd this proposal ID to your .env file under PROPOSAL_ID:');
        console.log(`PROPOSAL_ID=${proposalId.toString()}`);

        return proposalId.toString();
    } catch (error) {
        // Handle any errors that occur during proposal creation
        console.error('Error creating proposal:', error);
        if (error.error?.data) {
            try {
                console.error('Decoded error:', governance.interface.parseError(error.error.data));
            } catch (parseError) {
                console.error('Could not parse error. Raw error data:', error.error.data);
            }
        }
        throw error;
    }
}

// Function to cast a vote on a proposal
async function castVote(proposalId) {
    // Check if the wallet has already voted
    const hasVoted = await governance.hasVoted(proposalId, wallet.address);
    if (hasVoted) {
        console.log('Vote already cast for this proposal. Proceeding to next steps.');
        return;
    }

    console.log('Casting vote...');
    try {
        // Cast a vote in favor of the proposal (1 = yes)
        const voteTx = await governance.castVote(proposalId, 1);
        const receipt = await voteTx.wait();
        console.log('Vote cast successfully. Transaction hash:', receipt.transactionHash);
    } catch (error) {
        console.error('Error casting vote:', error);
        if (error.error?.data) {
            try {
                console.error('Decoded error:', governance.interface.parseError(error.error.data));
            } catch (parseError) {
                console.error('Could not parse error. Raw error data:', error.error.data);
            }
        }
        throw error;
    }
}

// Function to execute a queued proposal
async function executeProposal(proposalId) {
    console.log('Executing proposal...');
    try {
        const executeTx = await governance.execute(proposalId);
        const receipt = await executeTx.wait();
        console.log('Proposal executed successfully. Transaction hash:', receipt.transactionHash);
    } catch (error) {
        console.error('Error executing proposal:', error);
        throw error;
    }
}

// Function to cancel a proposal
async function cancelProposal(proposalId) {
    console.log('Cancelling proposal...');
    try {
        const cancelTx = await governance.cancel(proposalId);
        const receipt = await cancelTx.wait();
        console.log('Proposal cancelled successfully. Transaction hash:', receipt.transactionHash);
    } catch (error) {
        console.error('Error cancelling proposal:', error);
        if (error.error?.data) {
            try {
                console.error('Decoded error:', governance.interface.parseError(error.error.data));
            } catch (parseError) {
                console.error('Could not parse error. Raw error data:', error.error.data);
            }
        }
        throw error;
    }
}

async function main() {
    // Get command-line arguments, skipping the first two (node and script name)
    const args = process.argv.slice(2);
    // The first argument is our flag/command
    const flag = args[0];

    // Get the proposal ID from the environment variables
    const proposalId = process.env.PROPOSAL_ID;

    switch (flag) {
        case '--create-vault':
            // Create or retrieve an existing rewards vault
            await getOrCreateVault();
            break;

        case '--create-proposal':
            // Check if there's an existing proposal
            if (proposalId) {
                const { stateName } = await checkProposalState(proposalId);
                // Only allow creating a new proposal if the current one is defeated
                if (stateName !== 'Defeated') {
                    console.log(`A proposal (ID: ${proposalId}) already exists and is in ${stateName} state.`);
                    console.log('You can only create a new proposal if the current one is defeated. Otherwise, if it is Canceled, remove the proposal ID from your .env file and create a new one.');
                    return;
                }
            }
            // Ensure the user has enough voting power to create a proposal
            if (!(await ensureSufficientVotingPower())) return;
            // Get or create a rewards vault
            const vaultAddress = await getOrCreateVault();
            // Get the BeraChef contract address
            const beraChefAddress = await beraChef.getAddress();
            // Set up proposal parameters
            const targets = [beraChefAddress];
            const values = [0];
            const calldatas = [beraChef.interface.encodeFunctionData('updateFriendsOfTheChef', [vaultAddress, true])];
            const description = "Add BBT Rewards Vault";
            // Create the proposal
            await createProposal(targets, values, calldatas, description);
            break;

        case '--vote':
            // Ensure a proposal ID is set
            if (!proposalId) {
                console.error('Please set the PROPOSAL_ID in your .env file');
                return;
            }
            // Check the current state of the proposal
            const voteState = await checkProposalState(proposalId);
            // Only allow voting if the proposal is in the Active state
            if (voteState.stateName !== 'Active') {
                console.log(`Proposal is in ${voteState.stateName} state. Please wait until it reaches Active state to vote.`);
                return;
            }
            // Cast a vote on the proposal
            await castVote(proposalId);
            break;

        case '--execute':
            // Ensure a proposal ID is set
            if (!proposalId) {
                console.error('Please set the PROPOSAL_ID in your .env file');
                return;
            }
            // Check the current state of the proposal
            const executeState = await checkProposalState(proposalId);
            // Only allow execution if the proposal is queued
            if (executeState.stateName !== 'Queued') {
                console.log(`Proposal is in ${executeState.stateName} state. Please wait until it reaches Queued state to execute.`);
                return;
            }
            // Execute the proposal
            await executeProposal(proposalId);
            break;

        case '--cancel':
            // Ensure a proposal ID is set
            if (!proposalId) {
                console.error('Please set the PROPOSAL_ID in your .env file');
                return;
            }
            // Check the current state of the proposal
            const cancelState = await checkProposalState(proposalId);
            // Allow cancellation if the proposal is in a cancellable state
            if (!['Pending', 'Active', 'Succeeded'].includes(cancelState.stateName)) {
                console.log(`Proposal is in ${cancelState.stateName} state and cannot be cancelled.`);
                return;
            }
            // Cancel the proposal
            await cancelProposal(proposalId);
            break;

        case '--check-state':
            // Ensure a proposal ID is set
            if (!proposalId) {
                console.error('Please set the PROPOSAL_ID in your .env file');
                return;
            }
            // Check and display the current state of the proposal
            const { stateName } = await checkProposalState(proposalId);
            console.log(`Current proposal state: ${stateName}`);
            // Get and display the next stage of the proposal
            const nextStage = await getNextStage(stateName);
            if (nextStage !== 'End') {
                console.log(`Next stage: ${nextStage}`);
            } else {
                console.log('This is the final stage of the proposal.');
            }
            break;

        default:
            // If an invalid flag is provided, show usage instructions
            console.log('Please provide a valid flag:');
            console.log('--create-vault: Create a new rewards vault');
            console.log('--create-proposal: Create a new governance proposal');
            console.log('--vote: Vote on the proposal specified in .env');
            console.log('--execute: Execute the proposal specified in .env');
            console.log('--cancel: Cancel the proposal specified in .env');
            console.log('--check-state: Check the current state of the proposal');
    }
}

// Run the main function and catch any errors
main().catch((error) => {
    console.error(error);
    process.exit(1);
});