// Imports
// ========================================================
import { config } from "dotenv";
import { ethers, Wallet } from "ethers";
import fs from "fs";
import path from "path";
import solc from "solc";

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
    "Deploy Script\n========================================================"
  );
  try {
    // The initial value that will be deployed with the contract
    const INITIAL_GREETING = "Hello From Deployed Contract";

    // 1 - Compile Contract
    const baseContractPath = path.join(
      __dirname,
      `../contracts/`,
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

    const output = solc.compile(JSON.stringify(input));
    const contract = JSON.parse(output);
    const contractBytecode =
      contract.contracts.baseContractPath[CONTRACT_NAME].evm.bytecode.object;
    // console.log({ contractBytecode });
    // console.log({ contractABI });

    // 2 - Setup Provider
    const provider = new ethers.JsonRpcProvider(
      `${process.env.RPC_URL}`,
      parseInt(`${process.env.CHAIN_ID}`)
    );

    // 3 - (Optional) Get gas price costs
    const { gasPrice, maxFeePerGas, maxPriorityFeePerGas } =
      await provider.getFeeData();

    console.log({ gasPrice });
    console.log({ maxFeePerGas });
    console.log({ maxPriorityFeePerGas });

    // 4 - Setup Signer
    const signer = new Wallet(
      `${process.env.WALLET_PRIVATE_KEY}` as `0x${string}`,
      provider
    );

    // 5 - (Optional) Estimate gas
    // Encode function and remove prefix of `0x` with slice(2)
    const encodedFunctionValue = new ethers.AbiCoder()
      .encode(["string"], [INITIAL_GREETING])
      .slice(2);
    const fullByteCode = `0x${contractBytecode}${encodedFunctionValue}`;

    const gasEstimate = await provider.estimateGas({
      from: signer.address,
      data: fullByteCode,
    });
    console.log({ gasEstimate });

    // 6 - Deploy contract
    const tx = await signer.sendTransaction({
      data: fullByteCode,
    });
    console.log({ hash: tx.hash });

    await tx.wait();

    // 7 - Get deployed contract address
    const receipt = await provider.getTransactionReceipt(tx.hash);

    console.log(`${CONTRACT_NAME} deployed to ${receipt?.contractAddress}`);
  } catch (error: any) {
    console.error({ error });
  }
  console.groupEnd();
})();
