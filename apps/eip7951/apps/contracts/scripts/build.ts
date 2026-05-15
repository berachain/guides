import solc from "solc";

const sourcePath = new URL("../src/TwoFactorAccount.sol", import.meta.url);
const abiOutputPath = new URL("../src/abi.ts", import.meta.url);
const outputPath = new URL("../src/bytecode.ts", import.meta.url);

const source = await Bun.file(sourcePath).text();
const input = {
  language: "Solidity",
  sources: {
    "TwoFactorAccount.sol": {
      content: source,
    },
  },
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors =
  output.errors?.filter(
    (error: { severity: string }) => error.severity === "error",
  ) ?? [];

if (errors.length > 0) {
  throw new Error(
    errors
      .map((error: { formattedMessage: string }) => error.formattedMessage)
      .join("\n"),
  );
}

const contract = output.contracts["TwoFactorAccount.sol"].TwoFactorAccount;
const abi = contract.abi;
const bytecode = contract.evm.bytecode.object;

await Bun.write(
  abiOutputPath,
  `export const twoFactorAccountAbi = ${JSON.stringify(abi, null, 2)} as const;\n`,
);

await Bun.write(
  outputPath,
  `export const twoFactorAccountBytecode = "0x${bytecode}" as const;\n`,
);

console.log("Wrote TwoFactorAccount ABI and bytecode.");
