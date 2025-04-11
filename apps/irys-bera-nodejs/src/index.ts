// Imports
// ========================================================
import { config } from "dotenv";
import { Uploader } from "@irys/upload";
import { Bera } from "@irys/upload-ethereum";
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

  // Configure Irys Uploader
  const irysUploader = await Uploader(Bera).withWallet(
    process.env.WALLET_PRIVATE_KEY,
  );

  // Get price for file
  const cost =
    (await irysUploader.getPrice(fileSize)).toNumber() / 1000000000000000000;
  const costWithBuffer = cost + Number(`${process.env.IRYS_BUFFER}`);
  console.log({ cost: `${cost} $BERA` });
  console.log({ costWithBuffer: `${costWithBuffer} $BERA` });

  // Get balance
  const balance =
    (await irysUploader.getBalance()).toNumber() / 1000000000000000000;
  console.log({ balance: `${balance} $BERA` });

  if (balance < costWithBuffer) {
    console.log(`Not enough balance, funding ${costWithBuffer} $BERA...`);
    const fundTx = await irysUploader.fund(
      irysUploader.utils.toAtomic(costWithBuffer),
    );
    console.log(
      `Successfully funded '${irysUploader.utils.fromAtomic(fundTx.quantity)}' $${irysUploader.token.toUpperCase()}`,
    );
  }

  // Upload file
  const receipt = await irysUploader.uploadFile(filePath, {
    tags: [
      {
        name: "image/jpeg",
        value: "berachain-upload.jpg",
      },
    ],
  });
  console.log("Uploaded file to Irys");
  console.log({ receipt });
  console.log(`https://gateway.irys.xyz/${receipt.id}`);

  console.groupEnd();
};

// Init Script
// ========================================================
main()
  .then(() => {
    console.log("Script complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
