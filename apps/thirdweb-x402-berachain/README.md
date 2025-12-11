# Thirdweb x402 Payments on Berachain

Guide for implementing payment-gated APIs using thirdweb's x402 protocol on Berachain.

## What is x402?

x402 turns the HTTP 402 Payment Required status code into an on-chain payment layer. APIs can require crypto payment per request instead of API keys or subscriptions.

### See x402 in Action

- **[x402.chat](https://x402.chat/)** - A live example of x402 payments in action. x402.chat is a decentralized social comments platform where posting costs $CHAT tokens - the more popular the page, the more expensive to post! Built by thirdweb as an open source x402 experiment.

- **[Bera Summit x402 Demo Video](https://drive.google.com/file/d/1DWmMGIdzClRf1EuhQYAzeBBy2kCSnBGr/view?usp=sharing)** - Watch a demonstration of x402 payments from the Bera Summit (November 19, 2025).

## What is Thirdweb?

Thirdweb provides SDKs and tools for building on blockchain. It supports Berachain and offers wallet management, smart contracts, and payment infrastructure.

## Thirdweb x402 on Berachain

On Berachain, you can accept payments in any ERC-20 token that supports ERC-2612 permit or ERC-3009 (like BERA, HONEY, or USDC). Berachain's low fees make it ideal for micro-payments.

## Prerequisites

- Node.js 18+
- thirdweb account ([sign up](https://thirdweb.com))
- Berachain wallet with testnet BERA tokens

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your credentials from the [thirdweb dashboard](https://thirdweb.com/dashboard):

```
THIRDWEB_CLIENT_ID=your_client_id_here
THIRDWEB_SECRET_KEY=your_secret_key_here
SERVER_WALLET_ADDRESS=0xYourServerWalletAddress
```

## Project Structure

```
thirdweb-x402-berachain/
├── src/
│   ├── client/          # Client-side payment examples
│   ├── server/          # Server-side payment acceptance
│   └── facilitator/     # Facilitator configuration
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Client-Side

For React apps, use the `useFetchWithPayment` hook. See `src/client/basic-payment.ts` for a full example.

```typescript
import { useFetchWithPayment } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";

const client = createThirdwebClient({ 
  clientId: process.env.THIRDWEB_CLIENT_ID 
});

function MyComponent() {
  const { fetchWithPayment, isPending } = useFetchWithPayment(client);

  const handleApiCall = async () => {
    const data = await fetchWithPayment("https://api.example.com/paid-endpoint");
    console.log(data);
  };

  return (
    <button onClick={handleApiCall} disabled={isPending}>
      {isPending ? "Loading..." : "Make Paid API Call"}
    </button>
  );
}
```

The hook handles wallet connection, payment authorization, and 402 responses automatically.

## Server-Side

Use Express middleware or standalone endpoints. See `src/server/express-middleware.ts` for the full middleware example.

### Basic Endpoint

```typescript
import { createThirdwebClient } from "thirdweb";
import { facilitator, settlePayment } from "thirdweb/x402";
import { berachainBepolia } from "thirdweb/chains";

const client = createThirdwebClient({ 
  secretKey: process.env.THIRDWEB_SECRET_KEY 
});

const thirdwebX402Facilitator = facilitator({
  client,
  serverWalletAddress: process.env.SERVER_WALLET_ADDRESS,
});

export async function GET(request: Request) {
  const paymentData = request.headers.get("x-payment");
  
  const result = await settlePayment({
    resourceUrl: "https://api.example.com/premium-content",
    method: "GET",
    paymentData,
    payTo: process.env.SERVER_WALLET_ADDRESS,
    network: berachainBepolia,
    price: "$0.01",
    facilitator: thirdwebX402Facilitator,
  });
  
  if (result.status === 200) {
    return Response.json({ data: "premium content" });
  } else {
    return Response.json(result.responseBody, {
      status: result.status,
      headers: result.responseHeaders,
    });
  }
}
```

The `settlePayment` function validates the payment signature, checks amount/token, and executes the on-chain transaction.

## Facilitator

The facilitator settles payments on-chain using your server wallet. See `src/facilitator/setup.ts` for setup.

## Berachain Configuration

Examples use Bepolia testnet by default. For mainnet:

```typescript
import { berachainMainnet, berachainBepolia } from "thirdweb/chains";

const chain = berachainBepolia; // Testnet: 80069
const chain = berachainMainnet; // Mainnet: 80094
```

## Supported Tokens

Any ERC-20 token on Berachain that supports ERC-2612 permit or ERC-3009, including BERA, HONEY, and USDC.

## Testing

Get testnet BERA from the [Berachain faucet](https://artio.faucet.berachain.com) and test on Bepolia before mainnet.

## Production

- Use mainnet for production
- Implement rate limiting
- Monitor transactions
- Set appropriate payment amounts

## Examples

- `src/client/basic-payment.ts` - Client-side payment handling
- `src/server/express-middleware.ts` - Express middleware
- `src/server/basic-endpoint.ts` - Standalone endpoint
- `src/facilitator/setup.ts` - Facilitator setup

## Resources

- [Thirdweb x402 Docs](https://portal.thirdweb.com/x402)
- [x402 Agents Guide](https://portal.thirdweb.com/x402/agents) - For AI agents
- [Berachain Docs](https://docs.berachain.com)
- [Thirdweb Dashboard](https://thirdweb.com/dashboard)

## Live Examples

- **[x402.chat](https://x402.chat/)** - Decentralized social comments platform using x402 payments
- **[x402.chat GitHub](https://github.com/thirdweb-dev/x402.chat)** - Open source x402 experiment by thirdweb
