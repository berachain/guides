import {
  Button,
  FrameContext,
  Frog,
  TextInput,
  TransactionContext,
} from "frog";
import { devtools } from "frog/dev";
import { NeynarVariables, neynar } from "frog/middlewares";
import { Address, encodeFunctionData, isAddress } from "viem";

import { serveStatic } from "frog/serve-static";
import { handle } from "frog/vercel";
import { ThirdWebEngine } from "./classes/ThirdWebEngine.js";
import { config } from "./config.js";

type State = {
  address: string | null;
  nftId: number;
};

export const defaultContainer = (children: JSX.Element) => (
  <div
    style={{
      alignItems: "center",
      background: "linear-gradient(to right, #432889, #17101F)",
      display: "flex",
      justifyContent: "center",
      height: "100%",
      color: "white",
      fontSize: 60,
    }}
  >
    {children}
  </div>
);

const getAddressFromContext = (
  c:
    | FrameContext<{ Variables: NeynarVariables }>
    | TransactionContext<{ Variables: NeynarVariables }>
) => {
  const data = c.var.interactor;
  return data?.verifiedAddresses?.ethAddresses.length
    ? data?.verifiedAddresses?.ethAddresses[0]
    : data?.custodyAddress;
};

export const app = new Frog({
  assetsPath: "/",
  basePath: "/api",
  initialState: {
    address: "",
    nftId: 0,
  },
}).use(
  neynar({
    apiKey: "NEYNAR_FROG_FM",
    features: ["interactor"],
  })
);

app.frame("/", async (c) => {
  return c.res({
    image: defaultContainer(<>Get started with Bera NFTs</>),
    intents: [
      <Button action="/get-started" value="start">
        Get Started
      </Button>,
    ],
  });
});

app.frame("/get-started", async (c) => {
  const { deriveState } = c;
  const address = getAddressFromContext(c);

  console.log("address in get-started: ", address);
  if (address) {
    const NFTOwned = await ThirdWebEngine.NFTOwned(address);
    if (NFTOwned.length > 0) {
      deriveState((previousState: any) => {
        previousState.nftId = NFTOwned[0].metadata.id;
      });
      return c.res({
        image: defaultContainer(
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <p>Seems you already hold an NFT...</p>
            <p>Transfer it below</p>
          </div>
        ),
        intents: [
          <TextInput placeholder="Enter the recipient..." />,
          <Button.Transaction target="/send-nft">Send NFT</Button.Transaction>,
          <Button action="/" value="reset">
            Reset
          </Button>,
        ],
      });
    }
  }

  return c.res({
    image: defaultContainer(<>Mint your Bera NFT</>),
    intents: [
      <Button action="/mint" value="mint">
        Mint NFT
      </Button>,
    ],
  });
});

app.transaction("/send-nft", async (c) => {
  const { inputText, previousState } = c;
  const { nftId } = previousState as State;
  const address = getAddressFromContext(c);

  console.log("address in send-nft: ", address);
  console.log("sending to: ", inputText);

  const transferFn = [
    "transferFrom(address from, address to, uint256 tokenId)",
  ];

  if (!isAddress(inputText || ""))
    return new Response("invalid address", { status: 400 });

  const data = encodeFunctionData({
    abi: transferFn,
    functionName: "transferFrom",
    args: [address, inputText, nftId],
  });

  return c.send({
    chainId: "eip155:80085",
    to: inputText as Address,
    data: data,
  });
});

app.frame("/mint", async (c) => {
  const address = getAddressFromContext(c);

  console.log("address in mint: ", address);

  if (!address)
    return c.res({
      image: defaultContainer(<>No wallet connected</>),
      intents: [<Button.Reset>Reset</Button.Reset>],
    });

  try {
    console.log("minting to: ", address);
    const { result } = await ThirdWebEngine.mint(address);
    console.log("successfully minted, showing success", result);

    const { transactionHash } = await ThirdWebEngine.getTransaction(
      result.queueId
    );
    console.log("txhash", transactionHash);

    return c.res({
      image: "https://ibb.co/5F79sVG",
      intents: [
        <Button.Link href={`${config.beratrailBaseUrl}/${transactionHash}`}>
          View Mint tx
        </Button.Link>,
      ],
    });
  } catch {
    return c.res({
      image: defaultContainer(<>Something went wrong :(</>),
      intents: [<Button.Reset>Reset</Button.Reset>],
    });
  }
});

devtools(app, { serveStatic });

export const GET = handle(app);
export const POST = handle(app);
