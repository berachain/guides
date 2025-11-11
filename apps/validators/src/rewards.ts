/**
 * @description Script that calculates reward vaults and which are getting the most allocation
 * @author @codingwithmanny (https://github.com/codingwithmanny)
 */
// Imports
// -----------------------------------------------------------------
import fs from "fs";
import path from "path";

// Constants
// -----------------------------------------------------------------
const ALLOCATIONS_FILE = path.join(process.cwd(), "files", "allocations.csv");
const OUTPUT_FILE = "rewards.csv";
const FILES_DIR = path.join(process.cwd(), "files");

// Main Script
// -----------------------------------------------------------------
/**
 * @description Main script to run the validator rewards script.
 */
const main = async () => {
  console.group("Running validator rewards script...");

  // Read allocations.csv
  const allocationsFileData = fs
    .readFileSync(ALLOCATIONS_FILE, "utf8")
    .split("\n")
    .slice(1);
  console.log("Found", allocationsFileData.length, "allocations to process.");

  const allocations = allocationsFileData.map((allocation) => {
    const [
      name,
      pubkey,
      operatorAddress,
      allocation1Address,
      allocation1Name,
      allocation1Protocol,
      allocation1PercentageNumerator,
      allocation1Percentage,
      allocation2Address,
      allocation2Name,
      allocation2Protocol,
      allocation2PercentageNumerator,
      allocation2Percentage,
      allocation3Address,
      allocation3Name,
      allocation3Protocol,
      allocation3PercentageNumerator,
      allocation3Percentage,
      allocation4Address,
      allocation4Name,
      allocation4Protocol,
      allocation4PercentageNumerator,
      allocation4Percentage,
      allocation5Address,
      allocation5Name,
      allocation5Protocol,
      allocation5PercentageNumerator,
      allocation5Percentage,
      allocation6Address,
      allocation6Name,
      allocation6Protocol,
      allocation6PercentageNumerator,
      allocation6Percentage,
      allocation7Address,
      allocation7Name,
      allocation7Protocol,
      allocation7PercentageNumerator,
      allocation7Percentage,
      allocation8Address,
      allocation8Name,
      allocation8Protocol,
      allocation8PercentageNumerator,
      allocation8Percentage,
      allocation9Address,
      allocation9Name,
      allocation9Protocol,
      allocation9PercentageNumerator,
      allocation9Percentage,
      allocation10Address,
      allocation10Name,
      allocation10Protocol,
      allocation10PercentageNumerator,
      allocation10Percentage,
    ] = allocation.split(",");
    return {
      name,
      pubkey,
      operatorAddress,
      allocation1Address,
      allocation1Name,
      allocation1Protocol,
      allocation1PercentageNumerator,
      allocation1Percentage,
      allocation2Address,
      allocation2Name,
      allocation2Protocol,
      allocation2PercentageNumerator,
      allocation2Percentage,
      allocation3Address,
      allocation3Name,
      allocation3Protocol,
      allocation3PercentageNumerator,
      allocation3Percentage,
      allocation4Address,
      allocation4Name,
      allocation4Protocol,
      allocation4PercentageNumerator,
      allocation4Percentage,
      allocation5Address,
      allocation5Name,
      allocation5Protocol,
      allocation5PercentageNumerator,
      allocation5Percentage,
      allocation6Address,
      allocation6Name,
      allocation6Protocol,
      allocation6PercentageNumerator,
      allocation6Percentage,
      allocation7Address,
      allocation7Name,
      allocation7Protocol,
      allocation7PercentageNumerator,
      allocation7Percentage,
      allocation8Address,
      allocation8Name,
      allocation8Protocol,
      allocation8PercentageNumerator,
      allocation8Percentage,
      allocation9Address,
      allocation9Name,
      allocation9Protocol,
      allocation9PercentageNumerator,
      allocation9Percentage,
      allocation10Address,
      allocation10Name,
      allocation10Protocol,
      allocation10PercentageNumerator,
      allocation10Percentage,
    };
  });

  const rewardVaults: {
    [vaultAddress: string]: {
      name: string;
      protocol: string;
      validatorsDirectingRewards: number;
      validatorsDirectingPercentage: number;
      bgtDirectingPercentage: number;
    };
  } = {};

  for (const allocation of allocations) {
    for (let i = 0; i < 10; i++) {
      const allocationAddress = (allocation as any)[
        `allocation${i + 1}Address`
      ] as string;
      if (allocationAddress) {
        if (!rewardVaults[allocationAddress]) {
          rewardVaults[allocationAddress] = {
            name: (allocation as any)[`allocation${i + 1}Name`],
            protocol: (allocation as any)[`allocation${i + 1}Protocol`],
            validatorsDirectingRewards: 0,
            validatorsDirectingPercentage: 0,
            bgtDirectingPercentage: 0,
          };
        }
        rewardVaults[allocationAddress].validatorsDirectingRewards++;
        rewardVaults[allocationAddress].validatorsDirectingPercentage =
          (rewardVaults[allocationAddress].validatorsDirectingRewards /
            allocations.length) *
          100;
        rewardVaults[allocationAddress].bgtDirectingPercentage += Number(
          (allocation as any)[`allocation${i + 1}Percentage`] as string,
        );
      }
    }
  }

  Object.keys(rewardVaults).map((vaultAddress: string) => {
    if (rewardVaults[vaultAddress]) {
      rewardVaults[vaultAddress] = {
        ...rewardVaults[vaultAddress],
        bgtDirectingPercentage:
          (rewardVaults[vaultAddress].bgtDirectingPercentage /
            (allocations.length * 100)) *
          100,
      };
    }
  });

  const rewardVaultsCSV = Object.keys(rewardVaults).map((key) => {
    const vaultAddress = key as string;
    const rewardVault = rewardVaults[vaultAddress];
    if (rewardVault) {
      return [
        vaultAddress,
        rewardVault.name,
        rewardVault.protocol,
        rewardVault.validatorsDirectingRewards,
        rewardVault.validatorsDirectingPercentage,
        rewardVault.bgtDirectingPercentage,
      ];
    }
    return [];
  });

  // Sort highest to lowest by validatorsDirectingPercentage
  rewardVaultsCSV.sort((a, b) => (b[4] as number) - (a[4] as number));

  // Write to CSV
  const outputRows = [
    [
      "address",
      "name",
      "protocol",
      "validatorsDirectingRewards",
      "validatorsDirectingPercentage",
      "bgtDirectingPercentage",
    ],
    ...rewardVaultsCSV.map((row) => row.join(",")),
  ];
  fs.writeFileSync(
    path.join(FILES_DIR, OUTPUT_FILE),
    outputRows.join("\n"),
    "utf8",
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
