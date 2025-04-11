import React, { useState, useEffect } from "react";
import { BerachainArtio } from "@particle-network/chains";
import {
  AAWrapProvider,
  SendTransactionMode,
  SmartAccount,
} from "@particle-network/aa";
import {
  useEthereum,
  useConnect,
  useAuthCore,
} from "@particle-network/auth-core-modal";
import { ethers } from "ethers";
import { notification } from "antd";

import "./App.css";

const App = () => {
  const { provider } = useEthereum();
  const { connect, disconnect } = useConnect();
  const { userInfo } = useAuthCore();

  const [balance, setBalance] = useState(null);

  const smartAccount = new SmartAccount(provider, {
    projectId: "YOUR_PROJECT_ID_HERE", // Replace YOUR_PROJECT_ID_HERE with the actual project ID
    clientKey: "YOUR_CLIENT_KEY_HERE", // Replace YOUR_CLIENT_KEY_HERE with the actual client key
    appId: "YOUR_APP_ID_HERE", // Replace YOUR_APP_ID_HERE with the actual app ID
    aaOptions: {
      simple: [{ chainId: BerachainArtio.id, version: "1.0.0" }],
    },
  });

  const customProvider = new ethers.providers.Web3Provider(
    new AAWrapProvider(smartAccount, SendTransactionMode.Gasless),
    "any",
  );

  useEffect(() => {
    if (userInfo) {
      fetchBalance();
    }
  }, [userInfo]);

  const fetchBalance = async () => {
    const address = await smartAccount.getAddress();
    const balanceResponse = await customProvider.getBalance(address);
    setBalance(ethers.utils.formatEther(balanceResponse));
  };

  const handleLogin = async (authType) => {
    if (!userInfo) {
      await connect({
        socialType: authType,
        chain: BerachainArtio,
      });
    }
  };

  const executeUserOp = async () => {
    const signer = customProvider.getSigner();

    const tx = {
      to: "0x000000000000000000000000000000000000dEaD",
      value: ethers.utils.parseEther("0.001"),
    };

    const txResponse = await signer.sendTransaction(tx);
    const txReceipt = await txResponse.wait();

    notification.success({
      message: "Transaction Successful",
      description: (
        <div>
          Transaction Hash:{" "}
          <a
            href={`https://artio.beratrail.io/tx/${txReceipt.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {txReceipt.transactionHash}
          </a>
        </div>
      ),
    });
  };

  const executeUserOpHONEY = async () => {
    const signer = customProvider.getSigner();

    const tokenContract = new ethers.Contract(
      "0x7EeCA4205fF31f947EdBd49195a7A88E6A91161B",
      ["function transfer(address to, uint256 amount)"],
      signer,
    );

    const txResponse = await tokenContract.transfer(
      "0x000000000000000000000000000000000000dEaD",
      ethers.utils.parseEther("1"),
    );
    const txReceipt = await txResponse.wait();

    notification.success({
      message: "Transaction Successful",
      description: (
        <div>
          Transaction Hash:{" "}
          <a
            href={`https://artio.beratrail.io/tx/${txReceipt.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {txReceipt.transactionHash}
          </a>
        </div>
      ),
    });
  };

  return (
    <div className="App">
      <div className="logo-section">
        <img
          src="https://i.imgur.com/EerK7MS.png"
          alt="Logo 1"
          className="logo logo-big"
        />
        <img
          src="https://i.imgur.com/OdR3YLW.png"
          alt="Logo 2"
          className="logo"
        />
      </div>
      {!userInfo ? (
        <div className="login-section">
          <button
            className="sign-button google-button"
            onClick={() => handleLogin("google")}
          >
            <img
              src="https://i.imgur.com/nIN9P4A.png"
              alt="Google"
              className="icon"
            />
            Sign in with Google
          </button>
          <button
            className="sign-button twitter-button"
            onClick={() => handleLogin("twitter")}
          >
            <img
              src="https://i.imgur.com/afIaQJC.png"
              alt="Twitter"
              className="icon"
            />
            Sign in with X
          </button>
          <button
            className="sign-button other-button"
            onClick={() => handleLogin("")}
          >
            <img
              src="https://i.imgur.com/VRftF1b.png"
              alt="Twitter"
              className="icon"
            />
          </button>
        </div>
      ) : (
        <div className="profile-card">
          <h2>{userInfo.name}</h2>
          <div className="balance-section">
            <small>{balance} BERA</small>
            <button className="sign-message-button" onClick={executeUserOp}>
              Burn 0.001 $BERA
            </button>
            <button
              className="sign-message-button honey"
              onClick={executeUserOpHONEY}
            >
              Burn 1 $HONEY
            </button>
            <button className="disconnect-button" onClick={() => disconnect()}>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
