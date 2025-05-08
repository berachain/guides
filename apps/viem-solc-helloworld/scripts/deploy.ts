// Imports
// ========================================================
const solc = require("solc");
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBerachainPublicClient, createBerachainWalletClient } from "@branch/berachain-config/viem";
import { berachainBepolia } from "@branch/berachain-config";

// Config
// ========================================================
config();

// Constants
// ========================================================
/**
 * @dev contract name from `./contract/HelloWorld
 */
const CONTRACT_NAME = "HelloWorld";

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
    console.log("Contract compiled successfully");

    // 2 - Setup account and clients
    const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}`;
    if (!privateKey) {
      throw new Error("WALLET_PRIVATE_KEY not found in environment");
    }
    const account = privateKeyToAccount(privateKey);
    console.log(`Using account: ${account.address}`);

    const publicClient = createBerachainPublicClient(berachainBepolia);
    const walletClient = createBerachainWalletClient(privateKey, berachainBepolia);
    console.log("Clients configured successfully");

    // 3 - (optional) Estimate gas
    const encodedData = encodeAbiParameters(
      [{ name: "_greeting", type: "string" }],
      [INITIAL_GREETING],
    );

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      data: `0x${contractBytecode}${encodedData.slice(2)}` as `0x${string}`,
    });
    console.log({ gasEstimate });

    // 4 - Deploy contract
    const hash = await walletClient.deployContract({
      abi: contractABI,
      bytecode: `0x${contractBytecode}` as `0x${string}`,
      args: [INITIAL_GREETING],
      account: account,
      chain: berachainBepolia,
    });
    console.log({ hash });

    // 5 - Get deployed contract address
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${CONTRACT_NAME} deployed to ${receipt?.contractAddress}`);
  } catch (error: any) {
    console.error({ error });
  }
  console.groupEnd();
})();
