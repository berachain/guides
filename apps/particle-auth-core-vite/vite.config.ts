import { defineConfig, Plugin, ConfigEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const particleWasmPlugin: Plugin | undefined = {
  name: "particle-wasm",
  apply: (_, env: ConfigEnv) => {
    return env.mode === "development";
  },
  buildStart: () => {
    const copiedPath = path.join(
      __dirname,
      "node_modules/@particle-network/thresh-sig/wasm/thresh_sig_wasm_bg.wasm"
    );
    const dir = path.join(__dirname, "node_modules/.vite/wasm");
    const resultPath = path.join(dir, "thresh_sig_wasm_bg.wasm");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(copiedPath, resultPath);
  },
};

export default defineConfig({
  plugins: [react(), particleWasmPlugin],
  server: {
    host: "0.0.0.0",
  },
  define: {
    "process.env": process.env,
  },
  build: {
    target: "esnext", // you can also use 'es2020' here
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext", // you can also use 'es2020' here
    },
  },
});
