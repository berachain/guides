import { JsonRpcProvider } from "ethers";
import axios, { AxiosInstance } from "axios";

/**
 * Simple round-robin load balancer for multiple RPC endpoints
 */
export class RoundRobinProvider {
  private providers: JsonRpcProvider[];
  private currentIndex: number = 0;
  private lock: Promise<void> = Promise.resolve();

  constructor(urls: string[]) {
    if (urls.length === 0) {
      throw new Error("At least one RPC URL required");
    }
    this.providers = urls.map((url) => new JsonRpcProvider(url));
  }

  // Get the next provider in round-robin fashion
  private getNextProvider(): JsonRpcProvider {
    const provider = this.providers[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.providers.length;
    return provider;
  }

  // Get a provider for Contract calls (uses first provider, contract calls are relatively lightweight)
  getProvider(): JsonRpcProvider {
    return this.providers[0];
  }

  // Execute a method with automatic failover
  async send(method: string, params: any[]): Promise<any> {
    const attempts = this.providers.length;
    for (let i = 0; i < attempts; i++) {
      const provider = this.getNextProvider();
      try {
        return await provider.send(method, params);
      } catch (error) {
        // If this is the last attempt, throw
        if (i === attempts - 1) {
          throw error;
        }
        // Otherwise try next provider
        continue;
      }
    }
    throw new Error("All providers failed");
  }

  // Delegate common ethers provider methods
  async getBlockNumber(): Promise<number> {
    const hex = await this.send("eth_blockNumber", []);
    return typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
  }

  async getBlock(blockTag: number | string): Promise<any> {
    const blockNum =
      typeof blockTag === "number" ? `0x${blockTag.toString(16)}` : blockTag;
    return this.send("eth_getBlockByNumber", [blockNum, false]);
  }

  async getTransaction(txHash: string): Promise<any> {
    return this.send("eth_getTransactionByHash", [txHash]);
  }

  async getTransactionReceipt(txHash: string): Promise<any> {
    return this.send("eth_getTransactionReceipt", [txHash]);
  }
}

/**
 * Round-robin load balancer for CL (CometBFT) RPC endpoints
 */
export class RoundRobinClClient {
  private clients: AxiosInstance[];
  private currentIndex: number = 0;

  constructor(baseUrls: string[]) {
    if (baseUrls.length === 0) {
      throw new Error("At least one CL RPC URL required");
    }
    this.clients = baseUrls.map((url) => {
      // Remove trailing slash if present
      const cleanUrl = url.replace(/\/$/, "");
      return axios.create({
        baseURL: cleanUrl,
        timeout: 30000,
      });
    });
  }

  private getNextClient(): AxiosInstance {
    const client = this.clients[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.clients.length;
    return client;
  }

  async getLatestHeight(): Promise<number> {
    const attempts = this.clients.length;
    for (let i = 0; i < attempts; i++) {
      const client = this.getNextClient();
      try {
        const res = await client.get("/status");
        return parseInt(res.data.result.sync_info.latest_block_height, 10);
      } catch (error) {
        if (i === attempts - 1) throw error;
        continue;
      }
    }
    throw new Error("All CL endpoints failed");
  }

  async getBlock(height: number): Promise<any | null> {
    const attempts = this.clients.length;
    for (let i = 0; i < attempts; i++) {
      const client = this.getNextClient();
      try {
        const res = await client.get(`/block?height=${height}`);
        return res.data.result?.block ?? null;
      } catch (error) {
        if (i === attempts - 1) return null;
        continue;
      }
    }
    return null;
  }

  async getValidators(height: number): Promise<any | null> {
    const attempts = this.clients.length;
    for (let i = 0; i < attempts; i++) {
      const client = this.getNextClient();
      try {
        const res = await client.get(
          `/validators?per_page=99&height=${height}`,
        );
        return res.data.result?.validators ?? null;
      } catch (error) {
        if (i === attempts - 1) return null;
        continue;
      }
    }
    return null;
  }
}

