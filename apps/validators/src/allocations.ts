/**
 * @description Script to get a validators allocation based on their pubkey.
 * @author @codingwithmanny (https://github.com/codingwithmanny)
 */
// Imports
// -----------------------------------------------------------------
import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { berachain } from "viem/chains";
import fs from "fs";
import path from "path";

// Constants
// -----------------------------------------------------------------
const CONTRACT_BEACONDEPOSIT = "0xdf960E8F3F19C481dDE769edEDD439ea1a63426a";
const REWARDVAULTS_METADATA_FILE =
  "https://github.com/berachain/metadata/blob/main/src/vaults/mainnet.json";
const REWARDVAULTS_METADATA_OUT_FILE = path.join(
  process.cwd(),
  "out",
  "rewardvaults_metadata.json",
);
const VALIDATORS_FILE = path.join(process.cwd(), "files", "validators.csv");
const OUTPUT_FILE = "allocations.csv";
const FILES_DIR = path.join(process.cwd(), "files");

const CONTRACT_ABI = [
  {
    type: "function",
    name: "getActiveRewardAllocation",
    inputs: [
      {
        name: "valPubkey",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IBeraChef.RewardAllocation",
        components: [
          {
            name: "startBlock",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "weights",
            type: "tuple[]",
            internalType: "struct IBeraChef.Weight[]",
            components: [
              {
                name: "receiver",
                type: "address",
                internalType: "address",
              },
              {
                name: "percentageNumerator",
                type: "uint96",
                internalType: "uint96",
              },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
];
const DELAY_MS = 1000;

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
  console.group("Running validator allocation script...");

  // REWARDVAULTS_METADATA_FILE is actually a GitHub URL to a webpage. We want the raw file.
  // Replace 'github.com' with 'raw.githubusercontent.com' and strip '/blob'
  function getRawGithubUrl(githubUrl: string): string {
    return githubUrl
      .replace("github.com/", "raw.githubusercontent.com/")
      .replace("/blob/", "/");
  }
  const rewardVaultsMetadataRawUrl = getRawGithubUrl(
    REWARDVAULTS_METADATA_FILE,
  );

  // Download and save
  let response = await fetch(rewardVaultsMetadataRawUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download reward vaults metadata: ${response.statusText}`,
    );
  }
  let json = await response.text();
  fs.writeFileSync(REWARDVAULTS_METADATA_OUT_FILE, json, "utf8");
  const rewardVaultsMetadata = JSON.parse(json)?.vaults;
  console.log(
    `Downloaded reward vaults metadata to ${REWARDVAULTS_METADATA_OUT_FILE}`,
  );

  // Read validators.csv
  const validatorsFileData = fs
    .readFileSync(VALIDATORS_FILE, "utf8")
    .split("\n")
    .slice(1);
  console.log("Found", validatorsFileData.length, "validators to process.");

  const validators = validatorsFileData.map((validator) => {
    const [name, pubkey, operatorAddress] = validator.split(",");
    return { name, pubkey, operatorAddress };
  });

  // NOTE: Allocation only allows a max of 10 allocations.
  const validatorAllocations: {
    name: string;
    pubkey: string;
    operatorAddress: string;
    allocation1Address: string;
    allocation1Name: string;
    allocation1Protocol: string;
    allocation1PercentageNumerator: number;
    allocation1Percentage: string;
    allocation2Address: string;
    allocation2Name: string;
    allocation2Protocol: string;
    allocation2PercentageNumerator: number;
    allocation2Percentage: string;
    allocation3Address: string;
    allocation3Name: string;
    allocation3Protocol: string;
    allocation3PercentageNumerator: number;
    allocation3Percentage: string;
    allocation4Address: string;
    allocation4Name: string;
    allocation4Protocol: string;
    allocation4PercentageNumerator: number;
    allocation4Percentage: string;
    allocation5Address: string;
    allocation5Name: string;
    allocation5Protocol: string;
    allocation5PercentageNumerator: number;
    allocation5Percentage: string;
    allocation6Address: string;
    allocation6Name: string;
    allocation6Protocol: string;
    allocation6PercentageNumerator: number;
    allocation6Percentage: string;
    allocation7Address: string;
    allocation7Name: string;
    allocation7Protocol: string;
    allocation7PercentageNumerator: number;
    allocation7Percentage: string;
    allocation8Address: string;
    allocation8Name: string;
    allocation8Protocol: string;
    allocation8PercentageNumerator: number;
    allocation8Percentage: string;
    allocation9Address: string;
    allocation9Name: string;
    allocation9Protocol: string;
    allocation9PercentageNumerator: number;
    allocation9Percentage: string;
    allocation10Address: string;
    allocation10Name: string;
    allocation10Protocol: string;
    allocation10PercentageNumerator: number;
    allocation10Percentage: string;
  }[] = [];

  for (const validator of validators) {
    const valAndAllocation = {
      name: validator?.name ?? "",
      pubkey: validator?.pubkey ?? "",
      operatorAddress: validator?.operatorAddress ?? "",
      allocation1Address: "",
      allocation1Name: "",
      allocation1Protocol: "",
      allocation1PercentageNumerator: 0,
      allocation1Percentage: "",
      allocation2Address: "",
      allocation2Name: "",
      allocation2Protocol: "",
      allocation2PercentageNumerator: 0,
      allocation2Percentage: "",
      allocation3Address: "",
      allocation3Name: "",
      allocation3Protocol: "",
      allocation3PercentageNumerator: 0,
      allocation3Percentage: "",
      allocation4Address: "",
      allocation4Name: "",
      allocation4Protocol: "",
      allocation4PercentageNumerator: 0,
      allocation4Percentage: "",
      allocation5Address: "",
      allocation5Name: "",
      allocation5Protocol: "",
      allocation5PercentageNumerator: 0,
      allocation5Percentage: "",
      allocation6Address: "",
      allocation6Name: "",
      allocation6Protocol: "",
      allocation6PercentageNumerator: 0,
      allocation6Percentage: "",
      allocation7Address: "",
      allocation7Name: "",
      allocation7Protocol: "",
      allocation7PercentageNumerator: 0,
      allocation7Percentage: "",
      allocation8Address: "",
      allocation8Name: "",
      allocation8Protocol: "",
      allocation8PercentageNumerator: 0,
      allocation8Percentage: "",
      allocation9Address: "",
      allocation9Name: "",
      allocation9Protocol: "",
      allocation9PercentageNumerator: 0,
      allocation9Percentage: "",
      allocation10Address: "",
      allocation10Name: "",
      allocation10Protocol: "",
      allocation10PercentageNumerator: 0,
      allocation10Percentage: "",
    } as any;
    try {
      const allocation = await client.readContract({
        address: CONTRACT_BEACONDEPOSIT,
        abi: CONTRACT_ABI,
        functionName: "getActiveRewardAllocation",
        args: [validator.pubkey as `0x${string}`],
      });
      const allocationWeights = (allocation as any)?.weights;
      for (let index = 0; index < allocationWeights.length; index++) {
        const weight = allocationWeights[index];
        const vault = rewardVaultsMetadata.find(
          (vault: any) => vault.vaultAddress === weight.receiver,
        );
        console.log({ vault: vault || "Vault not found." });
        if (vault) {
          valAndAllocation[`allocation${index + 1}Name`] = vault?.name ?? "";
          valAndAllocation[`allocation${index + 1}Protocol`] =
            vault?.protocol ?? "";
        }
        valAndAllocation[`allocation${index + 1}Address`] =
          weight?.receiver ?? "";
        valAndAllocation[`allocation${index + 1}PercentageNumerator`] =
          typeof weight?.percentageNumerator === "bigint"
            ? weight.percentageNumerator.toString()
            : (weight?.percentageNumerator ?? "0").toString();
        valAndAllocation[`allocation${index + 1}Percentage`] =
          (typeof weight?.percentageNumerator === "bigint"
            ? (weight.percentageNumerator / 100n).toString()
            : (((weight?.percentageNumerator ?? 0) / 100).toString() ?? "")) ??
          "" ??
          "";
      }
    } catch (error) {
      console.error(error);
    }
    validatorAllocations.push(valAndAllocation);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  // Write to CSV
  const outputRows = [
    [
      "name",
      "pubkey",
      "operatorAddress",
      "allocation1Address",
      "allocation1Name",
      "allocation1Protocol",
      "allocation1PercentageNumerator",
      "allocation1Percentage",
      "allocation2Address",
      "allocation2Name",
      "allocation2Protocol",
      "allocation2PercentageNumerator",
      "allocation2Percentage",
      "allocation3Address",
      "allocation3Name",
      "allocation3Protocol",
      "allocation3PercentageNumerator",
      "allocation3Percentage",
      "allocation4Address",
      "allocation4Name",
      "allocation4Protocol",
      "allocation4PercentageNumerator",
      "allocation4Percentage",
      "allocation5Address",
      "allocation5Name",
      "allocation5Protocol",
      "allocation5PercentageNumerator",
      "allocation5Percentage",
      "allocation6Address",
      "allocation6Name",
      "allocation6Protocol",
      "allocation6PercentageNumerator",
      "allocation6Percentage",
      "allocation7Address",
      "allocation7Name",
      "allocation7Protocol",
      "allocation7PercentageNumerator",
      "allocation7Percentage",
      "allocation8Address",
      "allocation8Name",
      "allocation8Protocol",
      "allocation8PercentageNumerator",
      "allocation8Percentage",
      "allocation9Address",
      "allocation9Name",
      "allocation9Protocol",
      "allocation9PercentageNumerator",
      "allocation9Percentage",
      "allocation10Address",
      "allocation10Name",
      "allocation10Protocol",
      "allocation10PercentageNumerator",
      "allocation10Percentage",
    ].join(","),
    ...validatorAllocations.map((validatorAllocation) => {
      return Object.values(validatorAllocation).join(",");
    }),
  ];
  fs.writeFileSync(
    path.join(FILES_DIR, OUTPUT_FILE),
    outputRows.join("\n"),
    "utf8",
  );
  console.log(
    `Saved validator allocations to ${path.join(FILES_DIR, OUTPUT_FILE)}`,
  );

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
