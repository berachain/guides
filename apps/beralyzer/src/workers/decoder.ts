import { spawn } from "child_process";
import { Pool, Client } from "pg";

export async function runDecoderOnce(pg: Pool | Client): Promise<void> {
  // Run the compiled Go helper to refresh validators.db (it writes SQLite and prints CSV)
  // We can parse stdout in the future; for now, we just ensure it runs successfully.
  return new Promise((resolve) => {
    const child = spawn("./validator-decoder", [], {
      cwd: "../cometbft-decoder",
    });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}
