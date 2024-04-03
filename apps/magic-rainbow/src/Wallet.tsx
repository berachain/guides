import { Address, parseEther } from "viem";

import { useState } from "react";
import {
  useSendTransaction,
  useWaitForTransactionReceipt,
  useConnectorClient,
} from "wagmi";
import { getAccount, getChains, getClient } from "@wagmi/core";
import { config } from "./index";
type Status = "connected" | "disconnected" | "reconnecting" | "connecting";

const StatusCircle = ({ status }: { status: Status }) => {
  return <div className={`circle ${status}`} />;
};
const Divider = () => {
  return <div className="divider" />;
};

const Wallet = () => {
  const client = getClient(config);

  const [address, setAddress] = useState<Address | string>("");

  const [amount, setAmount] = useState<string>("0.01");

  const { data: hash, sendTransaction, error } = useSendTransaction();

  const submitSend = async () => {
    sendTransaction({ to: address as Address, value: parseEther(amount) });
  };

  const { isLoading, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  return (
    <>
      <h2>Send BERA</h2>
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitSend();
          }}
        >
          <input
            value={address || ""}
            placeholder="Receiving Address"
            onChange={(e) => setAddress(e.target.value as Address)}
          />
          <input
            value={amount}
            placeholder="Amount of BERA"
            onChange={(e) => setAmount(e.target.value as string)}
          />
          <button
            className="submit-button"
            disabled={isLoading || !sendTransaction || !address || !amount}
            type="submit"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
      {hash && isSuccess && (
        <div>
          <Divider />
          Successfully sent {amount} ether. View transaction on{" "}
          <a
            href={`${client.chain.blockExplorers.default.url}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer
          </a>
        </div>
      )}
      {error && (
        <div>An error occurred preparing the transaction: {error.message}</div>
      )}
    </>
  );
};

export default Wallet;
