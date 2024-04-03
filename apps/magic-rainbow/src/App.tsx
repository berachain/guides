import { ConnectButton } from "@rainbow-me/rainbowkit";
import { getAccount } from "@wagmi/core";
import { config } from "./index";
import { useAccount } from "wagmi";
import Wallet from "./Wallet";

const App = () => {
  const { isConnected } = useAccount();

  return (
    <div className="App">
      <h1>Magic + RainbowKit + Berachain</h1>
      <h2>🪄🌈🐻⛓️</h2>
      <ConnectButton />
      {isConnected && <Wallet />}
    </div>
  );
};

export default App;
