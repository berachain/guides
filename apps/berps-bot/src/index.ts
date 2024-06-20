import { TradingBot } from "./tradingBot";

async function main() {
  const tradingBot = new TradingBot();
  await tradingBot.start();

  process.on("SIGINT", async () => {
    await tradingBot.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
