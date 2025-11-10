/**
 * @description Script to get the operator address from all pubkeys found from deposits and genesis.json.
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

// Constants
// -----------------------------------------------------------------
const CONTRACT_BEACONDEPOSIT = "0x4242424242424242424242424242424242424242";
const CONTRACT_BLOCKREWARDCONTROLLER = "0x1AE7dD7AE06F6C58B4524d9c1f816094B1bcCD8e";
const DEPOSITS_FILE = path.join(process.cwd(), "files", "deposits.csv");
const GENESIS_FILE =
  "https://github.com/berachain/beacon-kit/blob/main/testing/networks/80094/genesis.json";
const VALIDATORS_METADATA_FILE =
  "https://github.com/berachain/metadata/blob/main/src/validators/mainnet.json";
const DELAY_MS = 1000;
// Download eth-genesis.json to the out folder
const OUT_DIR = path.resolve(process.cwd(), "out");
const GENESIS_OUT_FILE = path.join(OUT_DIR, "genesis.json");
const VALIDATORS_METADATA_OUT_FILE = path.join(
  OUT_DIR,
  "validators_metadata.json",
);

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
  console.group("Running validator pubkeys script...");

  if (process.env.BERACHAIN_RPC_URL) {
    console.log("Using RPC URL:", process.env.BERACHAIN_RPC_URL);
  } else {
    console.log("Using default RPC URL.");
  }

  const validators: { [pubkey: string]: { name: string; pubkey: string; operatorAddress: string, stake: number } } = {};

  // Ensure the out directory exists
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  console.log(
    `Downloading genesis.json from ${GENESIS_FILE} and validators metadata from ${VALIDATORS_METADATA_FILE} ...`,
  );

  // GENESIS_FILE is actually a GitHub URL to a webpage. We want the raw file.
  // Replace 'github.com' with 'raw.githubusercontent.com' and strip '/blob'
  function getRawGithubUrl(githubUrl: string): string {
    return githubUrl
      .replace("github.com/", "raw.githubusercontent.com/")
      .replace("/blob/", "/");
  }
  const ethGenesisRawUrl = getRawGithubUrl(GENESIS_FILE);
  const validatorsMetadataRawUrl = getRawGithubUrl(VALIDATORS_METADATA_FILE);

  // Download and save
  let response = await fetch(ethGenesisRawUrl);
  if (!response.ok) {
    throw new Error(`Failed to download genesis.json: ${response.statusText}`);
  }
  let json = await response.text();
  fs.writeFileSync(GENESIS_OUT_FILE, json, "utf8");
  console.log(`Downloaded genesis.json to ${GENESIS_OUT_FILE}`);

  // Download and save
  response = await fetch(validatorsMetadataRawUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download validators metadata: ${response.statusText}`,
    );
  }
  json = await response.text();
  fs.writeFileSync(VALIDATORS_METADATA_OUT_FILE, json, "utf8");
  console.log(
    `Downloaded validators metadata to ${VALIDATORS_METADATA_OUT_FILE}`,
  );

  const depositsData = fs.readFileSync(DEPOSITS_FILE, "utf8");
  const deposits = depositsData.split("\n").slice(1);
  console.log("Found", deposits.length, "deposits to process.");
  const pubkeysSet = new Set<string>();
  for (const deposit of deposits) {
    const [pubkey, _, amount] = deposit.split(",");
    if (pubkey && amount) {
      if (!validators[pubkey]) {
        validators[pubkey] = {
          name: "",
          pubkey,
          operatorAddress: "",
          stake: 0,
        };
      }
      validators[pubkey].stake += Number(amount);
    }
  }

  // Read genesis.json
  const genesisData = fs.readFileSync(GENESIS_OUT_FILE, "utf8");
  const genesis = JSON.parse(genesisData);
  console.log(
    "Found",
    genesis.app_state.beacon.deposits.length,
    "pubkeys in genesis.json.",
  );
  genesis.app_state.beacon.deposits.map((deposit: any) => {
    if (!validators[deposit.pubkey]) {
      validators[deposit.pubkey] = {
        name: "",
        pubkey: deposit.pubkey,
        operatorAddress: "",
        stake: 0,
      };
    }
    validators[deposit.pubkey]!.stake += parseInt(deposit.amount, 16);
    return deposit.pubkey;
  });
  console.log("Found", Object.keys(validators).length, "validators to process.");

  const validatorsCSV = [
    ...Object.keys(validators).map((pubkey) => ({
      name: validators[pubkey]!.name,
      pubkey,
      operatorAddress: validators[pubkey]!.operatorAddress,
      stake: validators[pubkey]!.stake,
    })),
  ];

  // Read validators metadata
  const validatorsMetadata = JSON.parse(
    fs.readFileSync(VALIDATORS_METADATA_OUT_FILE, "utf8"),
  );

  for (const validator of validatorsCSV) {
    const operatorAddress = await client.readContract({
      address: CONTRACT_BEACONDEPOSIT,
      abi: [
        parseAbiItem(
          "function getOperator(bytes pubkey) view returns (address)",
        ),
      ],
      functionName: "getOperator",
      args: [validator.pubkey as `0x${string}`],
    });
    validator.operatorAddress = operatorAddress as `0x${string}`;
    console.log(
      `Found operator address for pubkey: ${validator.pubkey} => ${validator.operatorAddress}`,
    );

    // Find name in metadata
    const name = validatorsMetadata.validators.find(
      (validatorMetadata: any) =>
        validatorMetadata.id.toLowerCase() === validator.pubkey.toLowerCase(),
    )?.name;
    if (name) {
      validator.name = name;
    }

    // Wait for 1 second to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  // Get base rate in BGT
  const baseRate = await client.readContract({
    address: CONTRACT_BLOCKREWARDCONTROLLER,
    abi: [
      parseAbiItem(
        "function baseRate() view returns (uint256)",
      ),
    ],
    functionName: "baseRate",
  });
  const baseRateBGT = Number(baseRate) / 1000000000000000000;
  console.log("Base rate validator reward:", `${baseRateBGT.toFixed(2)} BGT per block`);

  // Output operator pubkey mappings to CSV: name,pubkey,operatorAddress,stake,chance
  const blocksPer24h = 86400/2; // 2 seconds per block
  const totalStake = validatorsCSV.reduce((acc, validator) => acc + validator.stake, 0);
  const outputRows = [
    "name,pubKey,operatorAddress,stake,blockProposal,estBGTPer24h",
    ...validatorsCSV
    .sort((a, b) => b.stake - a.stake)
    .map((validator) => {
      const blockProposal = (validator.stake / totalStake);
      const bgtPer24h = (blockProposal * Number(baseRate) * blocksPer24h) / 1000000000000000000;
      // Escape name for CSV formatting: wrap with double quotes, escape inner quotes by doubling them
      const escapedName = `"${String(validator.name).replace(/"/g, '""')}"`;
      return `${escapedName},${validator.pubkey},${validator.operatorAddress},${validator.stake},${(blockProposal * 100).toFixed(2)}%,${(bgtPer24h).toFixed(2)} BGT`;
    }),
  ];

  const outputFile = path.join(process.cwd(), "files", "validators.csv");
  await fs.promises.writeFile(outputFile, outputRows.join("\n"), "utf8");
  console.log(`Saved pubkeys and operatorAddress to ${outputFile}`);

  console.groupEnd();
};

// Init
// -----------------------------------------------------------------
main()
  .then(() => {
    console.log("Done");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
