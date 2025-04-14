import { EvmPriceServiceConnection, PriceFeed } from "@pythnetwork/pyth-evm-js";
import { CONFIG } from "./config";

export class PythConnection {
  private connection: EvmPriceServiceConnection;

  constructor() {
    this.connection = new EvmPriceServiceConnection(CONFIG.PYTH_ENDPOINT, {
      // logger: console, // Uncomment this line to enable logging
    });
  }

  async getHistoricalPriceFeeds(
    priceId: string,
    intervalSeconds: number,
    periods: number,
  ): Promise<number[]> {
    const endTime = Math.floor(Date.now() / 1000 - 5);
    const startTime = endTime - (periods + 1) * intervalSeconds;
    const prices: number[] = [];

    for (
      let publishTime = startTime;
      publishTime <= endTime;
      publishTime += intervalSeconds
    ) {
      const priceFeed = await this.connection.getPriceFeed(
        priceId,
        publishTime,
      );
      prices.push(this.normalizeToTenDec(priceFeed));
    }
    return prices;
  }

  async subscribePriceFeedUpdates(
    priceIds: string[],
    callback: (priceFeed: PriceFeed) => void,
  ): Promise<void> {
    await this.connection.subscribePriceFeedUpdates(priceIds, callback);
  }

  async getPriceUpdateData(priceIds: string[]): Promise<string[]> {
    const priceUpdates =
      await this.connection.getPriceFeedsUpdateData(priceIds);

    return priceUpdates;
  }

  async unsubscribePriceFeedUpdates(priceIds: string[]): Promise<void> {
    await this.connection.unsubscribePriceFeedUpdates(priceIds);
  }

  // Express price as a number with 10 decimal precision
  normalizeToTenDec(priceFeed: PriceFeed): number {
    const priceObj = priceFeed.getPriceUnchecked();
    const { price, expo } = priceObj;
    return parseFloat(price) * Math.pow(10, 10 + expo);
  }
}
