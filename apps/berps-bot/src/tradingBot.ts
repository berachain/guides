import { BigNumber, ethers } from "ethers";
import { throttle } from "lodash";

import { PythConnection } from "./pyth";
import { calculateBollingerBands } from "./bb";
import { CONFIG } from "./config";
import TradingContractABI from "./ABIs/TradingContract.json";
import Erc20ABI from "./ABIs/ERC20.json";

const HONEY = "0x124363b6D0866118A8b6899F2674856618E0Ea4c";

export class TradingBot {
  private tradingContract: ethers.Contract;
  private honeyContract: ethers.Contract;
  private wallet: ethers.Wallet;
  private pythConnection: PythConnection;
  private prices: number[] = [];
  private lastTrade: "buy" | "sell" | null = null;

  constructor() {
    this.pythConnection = new PythConnection();
    const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_PROVIDER);
    const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
    this.wallet = wallet;
    this.tradingContract = new ethers.Contract(
      CONFIG.TRADING_CONTRACT_ADDRESS,
      TradingContractABI,
      wallet
    );
    this.honeyContract = new ethers.Contract(HONEY, Erc20ABI, wallet);
  }

  async start() {
    console.log("Trading bot started");

    const allowance: BigNumber = await this.honeyContract.allowance(
      this.wallet.address,
      CONFIG.TRADING_CONTRACT_ADDRESS
    );

    if (allowance.lt(ethers.utils.parseEther("99999999999"))) {
      console.log("Approving honey allowance");
      const tx = await this.honeyContract.approve(
        CONFIG.TRADING_CONTRACT_ADDRESS,
        ethers.constants.MaxUint256
      );
      await tx.wait();
    }

    // Fetch historical price data
    const historicalPriceFeeds =
      await this.pythConnection.getHistoricalPriceFeeds(
        CONFIG.PRICE_ID,
        CONFIG.DATA_INTERVAL,
        CONFIG.BOLLINGER_PERIOD
      );
    this.prices = historicalPriceFeeds;

    // Subscribe to real-time price updates
    await this.pythConnection.subscribePriceFeedUpdates(
      [CONFIG.PRICE_ID],
      throttle((priceFeed: any) => {
        const price = this.pythConnection.normalizeToTenDec(priceFeed);
        this.prices.push(price);
        this.checkTrade();

        console.log(
          `${new Date().toISOString()}: Checking for trade at price: $${(
            price * Math.pow(10, -10)
          ).toFixed(4)}`
        );
      }, CONFIG.DATA_INTERVAL * 1000) // limit updates to period interval
    );
  }

  async stop() {
    console.log("Trading bot stopped.");
    await this.pythConnection.unsubscribePriceFeedUpdates([CONFIG.PRICE_ID]);
  }

  private async checkTrade() {
    try {
      const pendingTx = await this.checkPendingTx();
      if (pendingTx) {
        console.log("Pending transaction, skipping trade");
        return;
      }

      const { upperBand, lowerBand } = calculateBollingerBands(
        this.prices,
        CONFIG.BOLLINGER_PERIOD,
        CONFIG.BOLLINGER_MULTIPLIER
      );

      const currentPrice = this.prices[this.prices.length - 1]!;

      const isBuy = currentPrice < lowerBand;
      const isSell = currentPrice > upperBand;

      if (!isBuy && !isSell) return;

      const priceUpdateData = await this.pythConnection.getPriceUpdateData([
        CONFIG.PRICE_ID,
        CONFIG.USDC_PRICE_ID,
      ]);

      // Construct trade params
      const trade = {
        trader: this.wallet.address,
        pairIndex: 1, // Corresponds to pair (ETH-USD)
        index: 0, // Contract will determine
        initialPosToken: 0, // Contract will determine
        positionSizeHoney: ethers.utils.parseEther("10"), // 10 HONEY
        openPrice: ethers.BigNumber.from(currentPrice),
        buy: isBuy ? true : isSell ? false : true, // true for Long, false for Short,
        leverage: ethers.BigNumber.from(10), // 10x leverage,
        tp: ethers.BigNumber.from(0), // No TP,
        sl: ethers.BigNumber.from(0), // No SL,
      };

      const tradeType = 0; // 0 for MARKET, 1 for LIMIT
      const slippage = ethers.utils.parseUnits("10", 10); // 10% slippage

      let tradeDirection: "buy" | "sell" | undefined;

      // Determine trade direction
      if (isSell && this.lastTrade !== "sell") {
        console.log("Sell signal", { upperBand, lowerBand, currentPrice });
        tradeDirection = "sell";
      } else if (isBuy && this.lastTrade !== "buy") {
        console.log("Buy signal", { upperBand, lowerBand, currentPrice });
        tradeDirection = "buy";
      }

      // Execute trade if trade direction is determined
      if (tradeDirection) {
        try {
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
        } catch (error) {
          console.error(error);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  async checkPendingTx() {
    const [currNonce, pendingNonce] = await Promise.all([
      this.wallet.getTransactionCount(),
      this.wallet.getTransactionCount("pending"),
    ]);

    return currNonce !== pendingNonce;
  }
}
