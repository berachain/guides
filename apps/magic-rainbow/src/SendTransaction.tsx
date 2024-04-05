import { Address, parseEther } from "viem";

import { useState } from "react";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { getClient } from "@wagmi/core";
import { config } from "./index";

const Divider = () => {
  return <div className="divider" />;
};

const SendTransaction = () => {
  const client = getClient(config);
  const [address, setAddress] = useState<Address | string>("");
  const [amount, setAmount] = useState<string>("0.001");
  const { data: hash, sendTransaction, error } = useSendTransaction();

  const submitSend = async () => {
    sendTransaction({ to: address as Address, value: parseEther(amount) });
  };

  const { isLoading, isSuccess, data } = useWaitForTransactionReceipt({
    hash,
  });

  return (
    <>
      <h2>Send BERA</h2>
      <div className={"send-container"}>
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
        <div className="confirmation-container">
          <Divider />
          <p>
            Successfully sent {amount} BERA. View transaction on{" "}
            <a
              href={`${client.chain.blockExplorers.default.url}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
            >
              Explorer
            </a>
          </p>
          <p>Gas used in transaction: {data?.gasUsed.toString()}</p>
        </div>
      )}
      {error && (
        <div>An error occurred preparing the transaction: {error.message}</div>
      )}
    </>
  );
};

export default SendTransaction;
