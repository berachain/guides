import { ethers } from "ethers";
import { throttle } from "lodash";
import { PythConnection } from "./pyth";
import { calculateBollingerBands } from "./bb";
import { CONFIG } from "./config";
import EntrypointABI from "./ABIs/entrypoint.json";
import Erc20ABI from "./ABIs/ERC20.json";

const HONEY = "0x0E4aaF1351de4c0264C5c7056Ef3777b41BD8e03";

export class TradingBot {
  private tradingContract: ethers.Contract;
  private honeyContract: ethers.Contract;
  private wallet: ethers.Wallet;
  private pythConnection: PythConnection;
  private prices: number[] = [];
  private lastTrade: "buy" | "sell" | null = null;

  constructor() {
    this.pythConnection = new PythConnection();
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_PROVIDER);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
    this.tradingContract = new ethers.Contract(
      CONFIG.ENTRYPOINT_CONTRACT_ADDRESS,
      EntrypointABI,
      this.wallet
    );
    this.honeyContract = new ethers.Contract(HONEY, Erc20ABI, this.wallet);
  }

  async start() {
    console.log("Trading bot started");

    const ordersContract = await this.tradingContract.orders();
    const allowance = await this.honeyContract.allowance(
      this.wallet.address,
      ordersContract
    );

    if (allowance < ethers.parseEther("99999999999")) {
      console.log("Approving honey allowance");
      const tx = await this.honeyContract.approve(
        ordersContract,
        ethers.MaxUint256
      );
      await tx.wait();
    }

    const historicalPriceFeeds =
      await this.pythConnection.getHistoricalPriceFeeds(
        CONFIG.PRICE_ID,
        CONFIG.DATA_INTERVAL,
        CONFIG.BOLLINGER_PERIOD
      );
    this.prices = historicalPriceFeeds;

    const throttledPriceCheck = throttle(
      (priceFeed: any) => {
        const price = this.pythConnection.normalizeToTenDec(priceFeed);
        this.prices.push(price);
        this.checkTrade();

        console.log(
          `${new Date().toISOString()}: Checking for trade at price: $${(
            price * Math.pow(10, -10)
          ).toFixed(4)}`
        );
      },
      CONFIG.DATA_INTERVAL * 1000,
      { leading: true }
    );

    await this.pythConnection.subscribePriceFeedUpdates(
      [CONFIG.PRICE_ID],
      throttledPriceCheck
    );
  }

  async stop() {
    console.log("Trading bot stopped.");
    await this.pythConnection.unsubscribePriceFeedUpdates([CONFIG.PRICE_ID]);
  }

  private async checkTrade() {
    try {
      if (await this.checkPendingTx()) {
        console.log("Pending transaction, skipping trade");
        return;
      }

      const { upperBand, lowerBand } = calculateBollingerBands(
        this.prices,
        CONFIG.BOLLINGER_PERIOD,
        CONFIG.BOLLINGER_MULTIPLIER
      );
      const currentPrice = this.prices[this.prices.length - 1];

      const isBuy = currentPrice < lowerBand;
      const isSell = currentPrice > upperBand;

      if (!(isBuy || isSell)) return;

      const priceUpdateData = await this.pythConnection.getPriceUpdateData([
        CONFIG.PRICE_ID,
        CONFIG.USDC_PRICE_ID,
      ]);

      const trade = {
        trader: this.wallet.address,
        pairIndex: 1,
        index: 0,
        initialPosToken: 0,
        positionSizeHoney: ethers.parseEther("10"),
        openPrice: currentPrice,
        buy: isBuy,
        leverage: 10n,
        tp: 0n,
        sl: 0n,
      };

      const tradeType = 0;
      const slippage = ethers.parseUnits("10", 10);

      const tradeDirection = isSell && this.lastTrade !== "sell" ? "sell" : isBuy && this.lastTrade !== "buy" ? "buy" : undefined;

      if (tradeDirection) {
        const tx = await this.tradingContract.openTrade(
          trade,
          tradeType,
          slippage,
          priceUpdateData,
          { value: "2" }
        );
        await tx.wait();
        this.lastTrade = tradeDirection;
        console.log(`Placed ${tradeDirection} order:`, tx.hash);
      }
    } catch (error) {
      console.error("Trade execution error:", error);
    }
  }

  async checkPendingTx() {
    const [currNonce, pendingNonce] = await Promise.all([
      this.wallet.getNonce(),
      this.wallet.getNonce("pending"),
    ]);

    return currNonce !== pendingNonce;
  }
}
