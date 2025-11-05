/**
 * @description Script to index all deposits on BeaconDeposit contract on specific block ranges.
 * @author @codingwithmanny (https://github.com/codingwithmanny)
 */
// Imports
// -----------------------------------------------------------------
import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { berachain } from "viem/chains";
import { parseAbiItem } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import type { BlockTag } from "viem";

// Constants
// -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @dev Block ranges based off of https://berascan.com/txs?a=0x4242424242424242424242424242424242424242&p=1
 */
const BLOCK_TO_INDEX: { from: number; to: number | string }[] = [
  {
    from: 0, // Genesis
    to: 516377,
  },
  {
    from: 516589,
    to: 517721,
  },
  {
    from: 740352,
    to: 796583,
  },
  {
    from: 859233,
    to: 889834,
  },
  {
    from: 889840,
    to: 889952,
  },
  {
    from: 890012,
    to: 890938,
  },
  {
    from: 907695,
    to: 971600,
  },
  {
    from: 1045281,
    to: 1055667,
  },
  {
    from: 1066232,
    to: 1103688,
  },
  {
    from: 1362864,
    to: 1396636,
  },
  {
    from: 1404527,
    to: 1416475,
  },
  {
    from: 1441169,
    to: 1441169,
  },
  {
    from: 1486219,
    to: 1486409,
  },
  {
    from: 1519092,
    to: 1519466,
  },
  {
    from: 1613283,
    to: 1642793,
  },
  {
    from: 1894134,
    to: 1991761,
  },
  {
    from: 2030846,
    to: 2041934,
  },
  {
    from: 2059096,
    to: 2085304,
  },
  {
    from: 2110909,
    to: 2133367,
  },
  {
    from: 2149284,
    to: 2176554,
  },
  {
    from: 2311579,
    to: 2575402,
  },
  {
    from: 2604662,
    to: 2604855,
  },
  {
    from: 2797041,
    to: 2797041,
  },
  {
    from: 3695867,
    to: 3853750,
  },
  {
    from: 4127605,
    to: 4470651,
  },
  {
    from: 4730470,
    to: 4730514,
  },
  {
    from: 5363729,
    to: 5363764,
  },
  {
    from: 6543993,
    to: 6680732,
  },
  {
    from: 6708937,
    to: 6889883,
  },
  {
    from: 8049347,
    to: 8049361,
  },
  {
    from: 9379575,
    to: 9379575,
  },
  {
    from: 10332631,
    to: 10332631,
  },
  {
    from: 11431349,
    to: 11445934,
  },
];
const RETRY_ATTEMPTS = 5;
const DELAY_MS = 2000;

const CONTRACT_BEACONDEPOSIT = "0x4242424242424242424242424242424242424242";
const OUTPUT_DIR = path.resolve(__dirname, "../out");
const OUTPUT_FILE = "deposits.csv";
const FILES_DIR = path.join(process.cwd(), "files");

// Config
// -----------------------------------------------------------------
/**
 * @dev Loads environment variables from .env file.
 */
config();

/**
 * @dev Creates a public client for the Berachain network.
 * @dev NOTE: You may need to use a dedicated RPC for blocks that are too old vs the default RPC.
 */
const client = createPublicClient({
  chain: berachain,
  transport: http(process.env.BERACHAIN_RPC_URL), // Optional: provide a custom RPC URL
});

// Main Script
// -----------------------------------------------------------------
/**
 * @description Main script to run the validator pubkeys script.
 */
const main = async () => {
  console.group("Running validator deposits script...");

  if (process.env.BERACHAIN_RPC_URL) {
    console.log("Using RPC URL:", process.env.BERACHAIN_RPC_URL);
  } else {
    console.log("Using default RPC URL.");
  }

  let isIndexed = false;
  let blockRangeIndex = 0;
  let csvData: string[] = [];
  let retryAttempts = 0;
  while (!isIndexed) {
    try {
      const blockRange = BLOCK_TO_INDEX[blockRangeIndex];
      if (!blockRange) {
        console.log("No more block ranges to index.");
        break;
      }
      const { from, to } = blockRange;
      console.log(
        `Indexing block range ${from - 1 >= 0 ? from - 1 : from} to ${typeof to === "string" && to === "latest" ? to : Number(to) + 1}...`,
      );

      const depositFilter = await client.createEventFilter({
        address: CONTRACT_BEACONDEPOSIT,
        event: parseAbiItem(
          "event Deposit(bytes pubkey, bytes credentials, uint64 amount, bytes signature, uint64 index)",
        ),
        fromBlock: BigInt(from - 1 >= 0 ? from - 1 : from),
        toBlock: typeof to === "string" ? (to as BlockTag) : BigInt(to + 1),
      });
      const logs = await client.getFilterLogs({ filter: depositFilter });
      console.log("Found", logs.length, "logs to export.");
      if (logs && logs.length > 0) {
        csvData = [
          ...csvData,
          ...logs.map((log: any) => {
            // viem generally returns event params in log.args
            const args = log.args;
            // Handle amount/index if they are type BigInt
            return [
              args.pubkey,
              args.credentials,
              args.amount.toString(),
              args.signature,
              args.index.toString(),
              log.blockNumber.toString(),
              log.transactionHash.toString(),
            ].join(",");
          }),
        ];
      }
      blockRangeIndex++;
      if (blockRangeIndex >= BLOCK_TO_INDEX.length) {
        isIndexed = true;
      }
      retryAttempts = 0;
    } catch (error) {
      console.error("Error indexing block range:", error);
      retryAttempts++;
      console.log(`Retry attempt ${retryAttempts} of ${RETRY_ATTEMPTS}...`);
      if (retryAttempts >= RETRY_ATTEMPTS) {
        console.error("Max retry attempts reached. Exiting.");
        process.exit(1);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  if (csvData.length === 0) {
    console.log("No deposits found to export.");
    return;
  }

  const csvHeader =
    "pubkey,credentials,amount,signature,index,blockNumber,txHash";
  let existingCsvData: string[] | undefined = undefined;
  if (fs.existsSync(path.join(OUTPUT_DIR, OUTPUT_FILE))) {
    // Check if the first line matches the header
    const existingFirstLine = fs
      .readFileSync(path.join(OUTPUT_DIR, OUTPUT_FILE), "utf8")
      .split("\n")[0];
    if (existingFirstLine && existingFirstLine.trim() === csvHeader) {
      existingCsvData = fs
        .readFileSync(path.join(OUTPUT_DIR, OUTPUT_FILE), "utf8")
        .split("\n")
        .slice(1);
    }
  }

  // Generate an array of CSV lines
  const csvFileData = [...(existingCsvData || []), ...csvData];

  // Remove duplicates in csvData by transactionHash (which is the 6th column)
  const seenHashes = new Set<string>();
  const dedupedCsvData: string[] = [];
  for (const row of csvFileData) {
    const parts = row.split(",");
    const txHash = parts[5];
    if (txHash && !seenHashes.has(txHash)) {
      dedupedCsvData.push(row);
      seenHashes.add(txHash);
    }
  }

  console.log("Found", dedupedCsvData.length, "unique deposits to export.");

  // All csv to be written to file
  const csvRows = [csvHeader, ...dedupedCsvData];

  // Write csv to file
  await fs.promises.writeFile(
    path.join(OUTPUT_DIR, OUTPUT_FILE),
    csvRows.join("\n"),
    "utf8",
  );
  console.log(`Saved deposits to ${path.join(OUTPUT_DIR, OUTPUT_FILE)}`);

  if (fs.existsSync(path.join(OUTPUT_DIR, OUTPUT_FILE))) {
    // Copy the output CSV file to the 'files' directory
    fs.copyFileSync(
      path.join(OUTPUT_DIR, OUTPUT_FILE),
      path.join(FILES_DIR, OUTPUT_FILE),
    );
    console.log(`Copied deposits to ${path.join(FILES_DIR, OUTPUT_FILE)}`);
  }

  console.groupEnd();
};

// Init
// -----------------------------------------------------------------
main()
  .then(() => {
    console.log("Done");
  })
  .catch((error) => {
    if (
      error &&
      typeof error.message === "string" &&
      error.message.includes("filter not found")
    ) {
      console.warn(
        chalk.yellow(
          "If showing 'filter not found' error, it could mean that the RPC just failed.",
        ),
      );
    }
    console.error(error);
    process.exit(1);
  });
