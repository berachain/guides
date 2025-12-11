// Basic client-side payment example for making paid API calls

import { createThirdwebClient } from "thirdweb";
import { createWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb/chains";
import * as dotenv from "dotenv";

const berachainBepolia = defineChain({
  id: 80069,
  name: "Berachain Bepolia",
  nativeCurrency: {
    name: "BERA",
    symbol: "BERA",
    decimals: 18,
  },
  rpc: "https://bepolia.rpc.berachain.com",
});

dotenv.config();

const client = createThirdwebClient({
  clientId: process.env.THIRDWEB_CLIENT_ID || "",
});

async function makePaidApiCall(url: string) {
  try {
    const wallet = createWallet("io.metamask");
    const account = await wallet.connect({
      client,
      chain: berachainBepolia,
    });

    if (!account) {
      throw new Error("Failed to connect wallet");
    }

    console.log(`Connected wallet: ${account.address}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status === 402) {
      return {
        status: 402,
        message: "Payment required",
        paymentInfo: await response.json(),
      };
    }

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      status: 200,
      data,
    };
  } catch (error) {
    console.error("Error making paid API call:", error);
    throw error;
  }
}

// For React apps, use the useFetchWithPayment hook:
// import { useFetchWithPayment } from "thirdweb/react";
// const { fetchWithPayment, isPending } = useFetchWithPayment(client);
// const data = await fetchWithPayment("https://api.example.com/paid-endpoint");

// Example execution
if (require.main === module) {
  const apiUrl = process.env.API_URL || "https://api.example.com/paid-endpoint";
  
  makePaidApiCall(apiUrl)
    .then((result) => {
      console.log("API call result:", result);
    })
    .catch((error) => {
      console.error("Failed to make API call:", error);
      process.exit(1);
    });
}

export { makePaidApiCall };
