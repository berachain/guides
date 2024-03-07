// Imports
// ========================================================
import Irys from "@irys/sdk";
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";

// Config
// ========================================================
/**
 * @dev Loads our environment variables from .env
 */
config();

// Main Script
// ========================================================
/**
 * @dev Main upload script
 */
const main = async () => {
  console.group("main()");

  // Get file and its size
  const filePath = path.join(__dirname, "../assets", "berachain-upload.jpg");
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  console.log({ fileSize });

  // Get account wallet address from private key
  const account = privateKeyToAccount(
    `${process.env.WALLET_PRIVATE_KEY}` as `0x${string}`,
  );

  // Irys Config
  const irys = new Irys({
    url: `${process.env.IRYS_NODE}`, // URL of the node you want to connect to
    token: `${process.env.IRYS_TOKEN}`, // Token used for payment
    key: `${process.env.WALLET_PRIVATE_KEY}`, // ETH or SOL private key
    config: {
      providerUrl: `${process.env.CHAIN_RPC_URL}`, // Optional provider URL, only required when using Devnet
    },
  });

  // Get price needed in `$BERA`
  const price =
    (await irys.getPrice(fileSize)).toNumber() / 1000000000000000000;
  console.log({
    price: `${price} $${process.env.CHAIN_NATIVECURRENCY_SYMBOL}`,
  });
  const priceWithBuffer = price + Number(`${process.env.IRYS_BUFFER}`);
  console.log({ priceWithBuffer });

  // Get balance
  const currentBalance =
    (await irys.getBalance(account.address)).toNumber() / 1000000000000000000;
  console.log({
    currentBalance: `${currentBalance} $${process.env.CHAIN_NATIVECURRENCY_SYMBOL}`,
  });

  if (currentBalance < priceWithBuffer) {
    // Fund the Irys node
    console.log("Not enough balance, funding node...");
    const fundTx = await irys.fund(irys.utils.toAtomic(price));
    console.log(
      `Successfully funded '${irys.utils.fromAtomic(fundTx.quantity)}' $${
        irys.token
      }`,
    );
    console.log("Re-run the script until your balance meets the price.");
  } else {
    console.log("Uploading file...");
    // Upload file
    const receipt = await irys.uploadFile(filePath, {
      tags: [
        {
          name: "image/jpeg",
          value: "berachain-upload.jpg",
        },
      ],
    });
    // https://gateway.irys.xyz/mDKWFxvoIzC15z3cAyR2EAl9S3EY1ZlhKzaEOcITE0g
    console.log(`https://gateway.irys.xyz/${receipt.id}`);
  }

  console.groupEnd();
};

// Init Script
// ========================================================
main()
  .then(() => {
    console.log("Script complete.");
  })
  .catch((error) => {
    console.error({ error });
  });
