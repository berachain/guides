import { config } from "./config.js";
import { z } from "zod";

const mintResponseSchema = z.object({
  result: z.object({
    queueId: z.string(),
  }),
});

const ownedResponseSchema = z.object({
  result: z.array(
    z.object({
      owner: z.string().startsWith("0x"),
      type: z.string(),
      supply: z.string(),
      metadata: z.object({
        id: z.string(),
      }),
    })
  ),
});

const transactionResponseSchema = z.object({
  result: z.object({
    queueId: z.string(),
    transactionHash: z.string(),
  }),
});

export const httpFetchOwned = async (reciever: string) => {
  const response = await fetch(
    `${config.thirdweb.engineUrl}/contract/${config.thirdweb.chainId}/${
      config.contractAddress
    }/erc721/get-owned?walletAddress=${reciever.toLowerCase()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.thirdweb.accessToken}`,
        "x-backend-wallet-address": config.thirdweb.engineWallet!,
      },
    }
  );

  const result = await response.json();
  return ownedResponseSchema.parse(result);
};

export const httpMint = async (receiver: string) => {
  const response = await fetch(
    `${config.thirdweb.engineUrl}/contract/${config.thirdweb.chainId}/${config.contractAddress}/erc721/claim-to`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.thirdweb.accessToken}`,
        "x-backend-wallet-address": config.thirdweb.engineWallet!,
      },
      body: JSON.stringify({ receiver: receiver.toLowerCase(), quantity: "1" }),
    }
  );

  const result = await response.json();

  return mintResponseSchema.parse(result);
};

export const httpGetTransaction = async (queueId: string) => {
  const response = await fetch(
    `${config.thirdweb.engineUrl}/transaction/status/${queueId}`,
    {
      method: "GET",
    }
  );

  const result = await response.json();
  return transactionResponseSchema.parse(result);
};
