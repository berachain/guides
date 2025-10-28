"use client";

// Imports
// ------------------------------------------------------------
import { usePrivy, ConnectedWallet, useCreateWallet, useSignMessage, useSendTransaction } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useState } from "react";
import { Loader } from "../SVG";
import { parseEther } from "viem";

// Component
// ------------------------------------------------------------
const Auth = () => {
  // State / Props
  const [selectedWallet, setSelectedWallet] = useState<ConnectedWallet | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const { user, ready, authenticated, logout, login } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();

  // - Wallet signature states
  const [isSigningMessage, setIsSigningMessage] = useState(false);
  const [signMessageError, setSignMessageError] = useState<Error | string |null>(null);
  const [signMessageData, setSignMessageData] = useState<any>(null);
  const { signMessage } = useSignMessage({
    onSuccess: ({ signature }) => {
      setIsSigningMessage(false);
      setSignMessageError(null);
      setSignMessageData(signature);
    },
    onError: (error) => {
      setIsSigningMessage(false);
      setSignMessageError(error);
    },
  })
  // - Wallet transaction states
  const [isSendingTransaction, setIsSendingTransaction] = useState(false);
  const [sendTransactionError, setSendTransactionError] = useState<Error | string |null>(null);
  const [sendTransactionData, setSendTransactionData] = useState<any>(null);
  const { sendTransaction } = useSendTransaction({
    onSuccess: ({ hash }) => {
      setIsSendingTransaction(false);
      setSendTransactionError(null);
      setSendTransactionData(hash);
    },
    onError: (error) => {
      setIsSendingTransaction(false);
      setSendTransactionError(error);
    },
  });

  // - Wallet creation states
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [createWalletError, setCreateWalletError] = useState<Error | string |null>(null);
  const [createWalletData, setCreateWalletData] = useState<any>(null);
  const {createWallet } = useCreateWallet({
    onSuccess: ({ wallet }) => {
      setIsCreatingWallet(false);
      setCreateWalletError(null);
      setCreateWalletData(`${wallet.id} / ${wallet.address}`);
    },
    onError: (error) => {
      setIsCreatingWallet(false);
      setCreateWalletError(error);
    },
  });

  /**
   * @dev this is to create a new wallet
   */
  const handleSubmitCreateWallet = async () => {
    setIsCreatingWallet(true);
    setCreateWalletError(null);
    setCreateWalletData(null);
    console.log("handleSubmitCreateWallet");
    createWallet();
  };

  // Functions
  /**
   * @dev this is to sign a message with the selected wallet
   * @param e 
   */
  const handleSubmitSignMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    console.log("handleSubmitSignMessage");
    e.preventDefault();
    const message = (e.target as HTMLFormElement).message.value;
    signMessage({ message });
  };

  /**
   * @dev this is to send a transaction with the selected wallet
   * @param e 
   */
  const handleSubmitSendTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    console.log("handleSubmitSendTransaction");
    e.preventDefault();
    const to = (e.target as HTMLFormElement).to.value;
    const amount = (e.target as HTMLFormElement).amount.value;
    console.log(to, amount);
    sendTransaction({ to, value: parseEther(amount) });
  };

  // Effect Events
  const onViewWallet = useEffectEvent(async () => {
    if (!selectedWallet) {
      setWalletBalance(null);
      return;
    };
    const provider = await selectedWallet?.getEthereumProvider();
    const balance = await provider?.request({
      method: "eth_getBalance",
      params: [selectedWallet?.address as `0x${string}`, "latest"],
    });
    setWalletBalance(balance);
    // setEthersProvider(provider);
    // publicClient = createPublicClient({
    //   chain: berachain,
    //   transport: http(),
    // });
    // const walletBalance = await provider?.getBalance(selectedWallet?.address as `0x${string}`);
    // setWalletBalance(walletBalance);
  });

  // Hooks
  /**
   * @dev this is to view the wallet balance
   */
  useEffect(() => {
    onViewWallet();
  }, [selectedWallet]);

  /**
   * @dev this is to set the selected wallet
   */
  useEffect(() => {
    if (wallets.length = 0) return;
    setSelectedWallet(wallets.find((wallet) => wallet.meta.name.includes('Privy')) ?? null);
  }, [authenticated, wallets]);

  // Render
  if (!ready) return <div><Loader className="w-8 h-8 animate-spin text-white" /></div>;

  return (
    <div>
      {authenticated ? (
        <>
          <h2>User</h2>
          <p>Details about the user stored in Privy.</p>
          <button className="btn mb-4" onClick={logout}>Sign Out</button>
          <code><pre>{JSON.stringify(user, null, 2)}</pre></code>

          <h2>Wallets</h2>
          <p>List of wallets connected to the user.</p>

          <h3>Selected Wallet</h3>
          <code><pre>{selectedWallet?.address ? `${selectedWallet.address} / ${selectedWallet.chainId} / ${selectedWallet.meta.name}` : '(No wallet selected)'}</pre></code>

          {selectedWallet?.address
            ?
            <>
              <h3>Wallet Balance</h3>
              <code>
                <pre>
                  {walletBalance
                    ? `${parseInt(walletBalance as unknown as string, 16)} / ${selectedWallet.chainId}`
                    : '(No wallet balance found)'}
                </pre>
              </code>
            </>
            : null}

          {walletsReady
            ? <>
              {wallets.length > 0 ? (
                <>
                  <h3>Available Wallets</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Address</th>
                        <th>Chain ID</th>
                        <th>Wallet</th>
                        <th>&nbsp;</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallets.map((wallet) => (
                        <tr key={wallet.address}>
                          <td>{wallet.address}</td>
                          <td>{wallet.chainId}</td>
                          <td>{wallet.meta.name}</td>
                          <td className="text-right">
                            {wallet.address === selectedWallet?.address ? <button className="btn btn-outline" disabled>Selected</button> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : <>
                <code><pre>No wallets found.</pre></code>
              </>}
            </>
            : <Loader className="w-8 h-8 animate-spin text-white" />}

            <button className="btn mb-4" onClick={handleSubmitCreateWallet} disabled={isCreatingWallet}>Create Wallet</button>
            <code><pre>{createWalletError ? createWalletError instanceof Error ? createWalletError.message : createWalletError : createWalletData ? createWalletData : ''}</pre></code>

            <h3>Wallet Actions</h3>

            <h4>Sign Message</h4>

            <form onSubmit={handleSubmitSignMessage}>
              <input name="message" type="text" placeholder="Message to sign" className="w-full mb-4" disabled={isSigningMessage} />
              <button className="btn" type="submit" disabled={isSigningMessage}>Sign Message</button>
            </form>

            <code><pre>{JSON.stringify(signMessageError ? signMessageError instanceof Error ? signMessageError.message : signMessageError : signMessageData ? signMessageData : '', null, 2)}</pre></code>

            <h4>Send Transaction</h4>

            <form onSubmit={handleSubmitSendTransaction}>
              <input name="to" type="text" placeholder="To address" className="w-full mb-4" disabled={isSendingTransaction} />
              <input step="0.000000000000000001" name="amount" type="number" placeholder="Amount" className="w-full mb-4" disabled={isSendingTransaction} />
              <button className="btn" type="submit" disabled={isSendingTransaction}>Send Transaction</button>
            </form>

            <code><pre>{JSON.stringify(sendTransactionError ? sendTransactionError instanceof Error ? sendTransactionError.message : sendTransactionError : sendTransactionData ? sendTransactionData : '', null, 2)}</pre></code>
        </>
      ) : (
        <button className="btn" onClick={login}>Sign In</button>
      )}
    </div>
  );
};

// Exports
// ------------------------------------------------------------
export default dynamic(() => Promise.resolve(Auth), { ssr: false });
