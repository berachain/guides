/* eslint-disable no-console */
// Imports
// ========================================================
import { berachainBepolia } from "@berachain/rpc-config";
import {
  createBerachainPublicClient,
  createBerachainWalletClient,
} from "@berachain/rpc-config/viem";
import chalk from "chalk";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import solc from "solc";
import { fileURLToPath } from "url";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Environment Configuration
// ========================================================
// 🌍 Loading your environment variables from .env file
config();

// Contract Configuration
// ========================================================
// 📝 The name of your contract - make sure it matches your .sol file!
const CONTRACT_NAME = "HelloWorld";

// File System Setup
// ========================================================
// 📂 Setting up file paths for your contract
// This helps us find and read your Solidity file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Main Script
// ========================================================
(async () => {
  // eslint-disable-next-line no-console
  console.log(chalk.blue("\n🚀 Let's Deploy Your Contract!"));
  // eslint-disable-next-line no-console
  console.log(
    chalk.gray("========================================================\n")
  );
  try {
    // 💬 The message that will be stored in your contract
    const INITIAL_GREETING = "Hello From Deployed Contract";

    // Contract Compilation
    // ========================================================
    // 🔨 Time to compile your Solidity contract!
    // This step converts your human-readable code into bytecode that the blockchain can understand
    const baseContractPath = path.join(
      __dirname,
      "../contracts/",
      `${CONTRACT_NAME}.sol`
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

    // Compile the contract
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - solc types are not properly typed in the package
    // This is a known issue with the solc package types
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const contract = output.contracts.baseContractPath[CONTRACT_NAME];
    if (!contract) {
      throw new Error(
        `Contract ${CONTRACT_NAME} not found in compilation output`
      );
    }

    const contractBytecode = contract.evm.bytecode.object;
    const contractABI = contract.abi;
    // eslint-disable-next-line no-console
    console.log(chalk.green("✓ Awesome! Your contract compiled successfully"));

    // Account and Client Setup
    // ========================================================
    // 👛 Setting up your wallet and connection to Berachain
    // This is how your contract will interact with the blockchain
    const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}`;
    if (!privateKey) {
      throw new Error("WALLET_PRIVATE_KEY not found in environment");
    }
    const account = privateKeyToAccount(privateKey);
    // eslint-disable-next-line no-console
    console.log(chalk.cyan(`📝 Using your account: ${account.address}`));

    const publicClient = createBerachainPublicClient(berachainBepolia);
    const walletClient = createBerachainWalletClient(
      privateKey,
      berachainBepolia
    );
    // eslint-disable-next-line no-console
    console.log(chalk.green("✓ Great! Your connection is ready"));

    // Gas Estimation
    // ========================================================
    // ⛽ Let's check how much gas your deployment will need
    // This helps ensure your transaction will go through smoothly
    const encodedData = encodeAbiParameters(
      [{ name: "_greeting", type: "string" }],
      [INITIAL_GREETING]
    );

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      data: `0x${contractBytecode}${encodedData.slice(2)}` as `0x${string}`,
    });
    // eslint-disable-next-line no-console
    console.log(chalk.yellow(`⛽ Gas needed: ${gasEstimate.toString()}`));

    // Contract Deployment
    // ========================================================
    // 🚀 Time to deploy your contract to Berachain!
    // This is where the magic happens - your code goes live on the blockchain
    const hash = await walletClient.deployContract({
      abi: contractABI,
      bytecode: `0x${contractBytecode}` as `0x${string}`,
      args: [INITIAL_GREETING],
      account: account.address,
      chain: berachainBepolia,
    });
    // eslint-disable-next-line no-console
    console.log(chalk.cyan(`🔗 Your transaction is being processed: ${hash}`));

    // Deployment Verification
    // ========================================================
    // ✨ Let's make sure everything went smoothly
    // We'll wait for the transaction to complete and get your contract's address
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // eslint-disable-next-line no-console
    console.log(
      chalk.green(
        `\n🎉 Congratulations! Your contract is live at ${receipt?.contractAddress}`
      )
    );
    // eslint-disable-next-line no-console
    console.log(
      chalk.gray("\n========================================================\n")
    );
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(chalk.red("\n❌ Oops! Something went wrong:"), error);
  }
})();
