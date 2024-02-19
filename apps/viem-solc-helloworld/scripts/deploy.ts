// Imports
// ========================================================
import solc from "solc";
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import {
  createWalletClient,
  createPublicClient,
  defineChain,
  http,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Config
// ========================================================
config();

// Constants
// ========================================================
/**
 * @dev contract name from `./contract/HelloWorld
 */
const CONTRACT_NAME = "HelloWorld";

/**
 * @dev Custom chain configuration
 */
const chainConfiguration = defineChain({
  id: parseInt(`${process.env.CHAIN_ID}`),
  name: `${process.env.NETWORK_NAME}`,
  network: `${process.env.NETWORK_NAME}`,
  nativeCurrency: {
    decimals: parseInt(`${process.env.CURRENCY_DECIMALS}`),
    name: `${process.env.CURRENCY_NAME}`,
    symbol: `${process.env.CURRENCY_SYMBOL}`,
  },
  rpcUrls: {
    default: {
      http: [`${process.env.RPC_URL}`],
    },
    public: {
      http: [`${process.env.RPC_URL}`],
    },
  },
  blockExplorers: {
    default: {
      name: `${process.env.BLOCK_EXPLORER_NAME}`,
      url: `${process.env.BLOCK_EXPLORER_URL}`,
    },
  },
});

// Main Script
// ========================================================
(async () => {
  console.group(
    "Deploy Script\n========================================================",
  );
  try {
    // The initial value that will be deployed with the contract
    const INITIAL_GREETING = "Hello From Deployed Contract";

    // 1 - Compile Contract
    const baseContractPath = path.join(
      __dirname,
      `../contracts/`,
      `${CONTRACT_NAME}.sol`,
    );
    const content = await fs.readFileSync(baseContractPath).toString();

    const input = {
      language: "Solidity",
      sources: {
        baseContractPath: {
          content,
        },
      },
      settings: {
        outputSelection: {
          "*": {
            "*": ["*"],
          },
        },
      },
    };

    const output = solc.compile(JSON.stringify(input));
    const contract = JSON.parse(output);
    const contractBytecode =
      contract.contracts.baseContractPath[CONTRACT_NAME].evm.bytecode.object;
    const contractABI = contract.contracts.baseContractPath[CONTRACT_NAME].abi;
    // console.log({ contractBytecode });
    // console.log({ contractABI });

    // 2 - Setup account
    const account = privateKeyToAccount(
      `${process.env.WALLET_PRIVATE_KEY}` as `0x${string}`,
    );

    // 3 - Configure wallet client for deployment
    const walletClient = createWalletClient({
      account,
      chain: chainConfiguration,
      transport: http(),
    });

    // 4 - Create public client to get contract address and optionally gas estimate
    const publicClient = createPublicClient({
      chain: chainConfiguration,
      transport: http(),
    });

    // 5 - (optional) Estimate gas
    const encodedData = encodeAbiParameters(
      [{ name: "_greeting", type: "string" }],
      [INITIAL_GREETING],
    );

    const gasEstimate = await publicClient.estimateGas({
      account,
      data: `0x${contractBytecode}${encodedData.slice(2)}` as `0x${string}`,
    });
    console.log({ gasEstimate });

    // 6 - Deploy contract
    const hash = await walletClient.deployContract({
      abi: contractABI,
      bytecode: contractBytecode,
      args: [INITIAL_GREETING],
    });
    console.log({ hash });

    // 7 - Get deployed contract address
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`${CONTRACT_NAME} deployed to ${receipt?.contractAddress}`);
  } catch (error: any) {
    console.error({ error });
  }
  console.groupEnd();
})();
