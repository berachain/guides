import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import SendTransaction from "./SendTransaction";

const App = () => {
  const { isConnected } = useAccount();

  return (
    <div className="App">
      <h1>Magic + RainbowKit + Berachain</h1>
      <h2>🪄🌈🐻⛓️</h2>
      <ConnectButton />
      {isConnected && <SendTransaction />}
    </div>
  );
};

export default App;
