import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";

export function ConnectBar() {
  const { address, isConnected } = useAccount();
  const connectors = useConnectors();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const metamask =
    connectors.find((c) => c.id === "io.metamask" || c.name === "MetaMask") ??
    connectors.find((c) => c.type === "injected");

  if (isConnected && address) {
    return (
      <div className="connect-bar">
        <span className="pill">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="connect-bar">
      <button
        type="button"
        className="primary"
        disabled={!metamask || isPending}
        onClick={() => metamask && connect({ connector: metamask })}
      >
        {isPending
          ? "Connecting…"
          : metamask
            ? "Connect MetaMask"
            : "MetaMask not detected"}
      </button>
    </div>
  );
}
