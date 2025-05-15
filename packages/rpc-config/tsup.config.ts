import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    viem: "src/viem.ts",
    ethers: "src/ethers.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
