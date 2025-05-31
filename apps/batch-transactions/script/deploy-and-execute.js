const {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  getAddress,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { berachainBepolia } = require("viem/chains");
const { readContract } = require("viem/actions");
const artifacts = require("./artifacts");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Constants
const BOARD_MEMBER_SHARE = 50_000n * 10n ** 18n; // 50,000 tokens
const LOCK_DURATION = 365n * 24n * 60n * 60n; // 1 year in seconds
const TOTAL_SUPPLY = 1_000_000n * 10n ** 18n; // 1M tokens

// Board member addresses
const BOARD_MEMBERS = [
  getAddress("0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF"),
  getAddress("0x6813Eb9362372eef6200f3b1dbc3f819671cba69"),
  getAddress("0x1eff47bc3a10a45d4b230b5d10e37751fe6aa718"),
];

// File to store deployed addresses
const DEPLOYED_ADDRESSES_FILE = path.join(__dirname, "deployed-addresses.json");

// Load deployed addresses if they exist
function loadDeployedAddresses() {
  try {
    if (fs.existsSync(DEPLOYED_ADDRESSES_FILE)) {
      return JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_FILE, "utf8"));
    }
  } catch (error) {
    console.warn("Error loading deployed addresses:", error.message);
  }
  return null;
}

// Save deployed addresses
function saveDeployedAddresses(addresses) {
  fs.writeFileSync(DEPLOYED_ADDRESSES_FILE, JSON.stringify(addresses, null, 2));
}

async function main() {
  // Setup clients
  const publicClient = createPublicClient({
    chain: berachainBepolia,
    transport: http(),
  });

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: berachainBepolia,
    transport: http(),
  });

  // Try to load existing addresses
  const deployedAddresses = loadDeployedAddresses();
  let batchTx, token, vesting;

  if (deployedAddresses) {
    console.log("Using existing deployed contracts:");
    console.log("BatchTransaction:", deployedAddresses.batchTx);
    console.log("UrsaToken:", deployedAddresses.token);
    console.log("VestingContract:", deployedAddresses.vesting);

    batchTx = { address: deployedAddresses.batchTx };
    token = { address: deployedAddresses.token };
    vesting = { address: deployedAddresses.vesting };
  } else {
    console.log("Deploying new contracts...");

    // Deploy BatchTransaction
    const batchTxHash = await walletClient.deployContract({
      abi: artifacts.BatchTransaction.abi,
      bytecode: artifacts.BatchTransaction.bytecode,
      args: [],
    });
    const batchTxReceipt = await publicClient.waitForTransactionReceipt({
      hash: batchTxHash,
    });
    batchTx = { address: batchTxReceipt.contractAddress };
    console.log("BatchTransaction deployed to:", batchTx.address);

    // Deploy UrsaToken
    const tokenHash = await walletClient.deployContract({
      abi: artifacts.UrsaToken.abi,
      bytecode: artifacts.UrsaToken.bytecode,
      args: [],
    });
    const tokenReceipt = await publicClient.waitForTransactionReceipt({
      hash: tokenHash,
    });
    token = { address: tokenReceipt.contractAddress };
    console.log("UrsaToken deployed to:", token.address);

    // Deploy VestingContract
    const vestingHash = await walletClient.deployContract({
      abi: artifacts.VestingContract.abi,
      bytecode: artifacts.VestingContract.bytecode,
      args: [token.address],
    });
    const vestingReceipt = await publicClient.waitForTransactionReceipt({
      hash: vestingHash,
    });
    vesting = { address: vestingReceipt.contractAddress };
    console.log("VestingContract deployed to:", vesting.address);

    // Save deployed addresses
    saveDeployedAddresses({
      batchTx: batchTx.address,
      token: token.address,
      vesting: vesting.address,
    });
  }

  // Check if tokens are already minted
  const balance = await publicClient.readContract({
    address: token.address,
    abi: artifacts.UrsaToken.abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (balance === 0n) {
    console.log("Minting tokens to executor...");
    // Mint tokens to executor
    const mintHash = await walletClient.writeContract({
      address: token.address,
      abi: artifacts.UrsaToken.abi,
      functionName: "mint",
      args: [account.address, TOTAL_SUPPLY],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    console.log("Minted tokens to executor");
  } else {
    console.log("Tokens already minted to executor");
  }

  // Prepare batch transactions
  const transactions = [];
  for (let i = 0; i < BOARD_MEMBERS.length; i++) {
    // Approval transaction
    transactions.push({
      target: token.address,
      value: 0n,
      data: encodeFunctionData({
        abi: artifacts.UrsaToken.abi,
        functionName: "approve",
        args: [vesting.address, BOARD_MEMBER_SHARE],
      }),
    });

    // Lock transaction
    transactions.push({
      target: vesting.address,
      value: 0n,
      data: encodeFunctionData({
        abi: artifacts.VestingContract.abi,
        functionName: "lockTokens",
        args: [BOARD_MEMBERS[i], BOARD_MEMBER_SHARE, LOCK_DURATION],
      }),
    });
  }

  // EIP-7702: Sign authorization with executor: 'self'
  const authorization = await walletClient.signAuthorization({
    account,
    contractAddress: batchTx.address,
    executor: "self",
  });

  // EIP-7702: Execute batch with authorizationList and EOA address
  console.log("Executing batch transactions with EIP-7702 authorization...");
  const hash = await walletClient.writeContract({
    address: account.address, // EOA address, not contract address!
    abi: artifacts.BatchTransaction.abi,
    functionName: "execute",
    args: [transactions],
    authorizationList: [authorization],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Batch executed successfully");
  console.log("Transaction hash:", hash);
  console.log("Number of beneficiaries:", BOARD_MEMBERS.length);
  console.log("Amount per beneficiary:", BOARD_MEMBER_SHARE.toString());
  console.log("Lock duration:", LOCK_DURATION.toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
