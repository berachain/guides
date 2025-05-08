// App component for the RainbowKit Vite demo
// ========================================================
// This component renders the main UI, including the wallet connect button.

import { ConnectButton } from "@rainbow-me/rainbowkit";

function App() {
  // Center the ConnectButton on the page
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <ConnectButton />
    </div>
  );
}

export default App;
