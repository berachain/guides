import "dotenv/config";

const contractAddress = process.env.CONTRACT_ADDRESS || "";
const hostUrl = process.env.VERCEL_URL || "";
const chainId = Number(process.env.CHAIN_ID) || 0;
const engineUrl = process.env.THIRDWEB_ENGINE_URL || "";
const engineWallet = process.env.THIRDWEB_ENGINE_WALLET || "";
const accessToken = process.env.THIRDWEB_ACCESS_TOKEN || "";
const neynarApiKey = process.env.NEYNAR_API_KEY || "";
const beratrailBaseUrl = "https://artio.beratrail.io/tx";

export const config = {
  contractAddress,
  hostUrl,
  neynarApiKey,
  beratrailBaseUrl,
  thirdweb: {
    chainId,
    engineUrl,
    engineWallet,
    accessToken,
  },
};
