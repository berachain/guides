import { useState, useReducer } from "react";
import { useAccount, useConnect, useDisconnect, useWriteContract } from "wagmi";
import {
  parseEther,
  formatEther,
  type Address,
  erc20Abi,
  isAddress,
  encodeFunctionData,
} from "viem";

// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, callback: (...args: any[]) => void) => void;
      removeListener: (
        event: string,
        callback: (...args: any[]) => void,
      ) => void;
    };
  }
}

// Token definitions
interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

const BERA_CHAIN_ID = 80069;
const BERA_CHAIN_ID_HEX = "0x" + BERA_CHAIN_ID.toString(16);

const DEFAULT_SPENDER = "0xfc4616A36adD2B618891645F14d9eC73Ed314bF4" as Address;

const TOKENS: Token[] = [
  {
    symbol: "WBERA",
    address: "0x6969696969696969696969696969696969696969" as Address,
    decimals: 18,
  },
  {
    symbol: "HONEY",
    address: "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce" as Address,
    decimals: 18,
  },
];

type TokenApproval = {
  token: Token | undefined;
  amount: string;
  allowance: bigint | undefined;
  needsApproval: boolean;
};

type State = TokenApproval[];

type Actions = {
  index: number;
} & (
  | {
      type: "changeToken";
      value: Token | undefined;
    }
  | {
      type: "changeAmount";
      value: string;
    }
  | {
      type: "add";
      index: -1;
    }
  | {
      type: "remove";
    }
  | {
      type: "updateAllowance";
      allowance: bigint;
    }
);

const reducer = (state: State, action: Actions): State => {
  switch (action.type) {
    case "changeToken":
      return [
        ...state.slice(0, action.index),
        { ...state[action.index], token: action.value, allowance: undefined },
        ...state.slice(action.index + 1),
      ];
    case "changeAmount":
      return [
        ...state.slice(0, action.index),
        { ...state[action.index], amount: action.value },
        ...state.slice(action.index + 1),
      ];
    case "add":
      return [
        ...state,
        {
          token: undefined,
          amount: "",
          allowance: undefined,
          needsApproval: false,
        },
      ];
    case "remove":
      return state.filter((_, index) => index !== action.index);
    case "updateAllowance":
      return [
        ...state.slice(0, action.index),
        { ...state[action.index], allowance: action.allowance },
        ...state.slice(action.index + 1),
      ];
  }
};

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();

  const [approvals, dispatch] = useReducer(reducer, [
    {
      token: TOKENS[0],
      amount: "",
      allowance: undefined,
      needsApproval: false,
    },
    {
      token: TOKENS[1],
      amount: "",
      allowance: undefined,
      needsApproval: false,
    },
  ]);

  const [spender, setSpender] = useState<Address>(DEFAULT_SPENDER);
  const [error, setError] = useState<string | undefined>();
  const [isApproving, setIsApproving] = useState(false);

  // Find Injected connector (MetaMask, Rabby, etc.)
  const injectedConnector = connectors.find((c) => c.id === "injected");

  // Read allowances for all tokens (placeholder for future implementation)
  // const { data: allowances } = useReadContract({
  //   address: approvals[0]?.token?.address,
  //   abi: erc20Abi,
  //   functionName: "allowance",
  //   args: address && spender ? [address, spender] : undefined,
  // });

  const isSpenderValid = isAddress(spender);

  // Calculate which tokens need approval
  const needsApproval = approvals
    .filter((item) => item.token && item.amount)
    .map((item) => {
      const requiredAmount = parseEther(item.amount);
      const currentAllowance = item.allowance || 0n;
      return {
        ...item.token!,
        requiredAmount,
        currentAllowance,
        needsApproval: currentAllowance < requiredAmount,
      };
    })
    .filter((item) => item.needsApproval);

  const addBerachainBepolia = async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      console.error("MetaMask not available");
      return;
    }

    try {
      console.log("Adding Berachain Bepolia network...");
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x13881", // 80085 in hex
            chainName: "Berachain Bepolia",
            nativeCurrency: {
              name: "Bera",
              symbol: "BERA",
              decimals: 18,
            },
            rpcUrls: ["https://bepolia.rpc.berachain.com"],
            blockExplorerUrls: ["https://testnet.berascan.com"],
          },
        ],
      });
      console.log("Berachain Bepolia network added successfully");
    } catch (error) {
      console.error("Failed to add Berachain Bepolia network:", error);
      throw error;
    }
  };

  const switchToBerachainBepolia = async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      console.error("MetaMask not available");
      return;
    }

    try {
      console.log("Switching to Berachain Bepolia network...");
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x13881" }], // 80085 in hex
      });
      console.log("Switched to Berachain Bepolia network successfully");
    } catch (error: any) {
      console.error("Failed to switch to Berachain Bepolia network:", error);

      // If the network doesn't exist, add it
      if (error.code === 4902) {
        console.log("Network not found, adding Berachain Bepolia...");
        await addBerachainBepolia();
      } else {
        throw error;
      }
    }
  };

  const handleConnect = async () => {
    if (!injectedConnector) {
      setError(
        "No injected wallet found. Please install MetaMask or another wallet extension.",
      );
      return;
    }
    try {
      await connect({ connector: injectedConnector });
      // Check current network
      const currentChainId = await window.ethereum?.request({
        method: "eth_chainId",
      });
      if (currentChainId !== BERA_CHAIN_ID_HEX) {
        await switchToBerachainBepolia();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to wallet",
      );
    }
  };

  const handleBatchApprove = async () => {
    if (needsApproval.length === 0 || !address) return;
    setIsApproving(true);
    setError(undefined);
    try {
      console.debug("[handleBatchApprove] Approve button clicked");
      const calls = needsApproval.map((item) => ({
        to: item.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, item.requiredAmount],
        }),
        value: "0x0",
      }));
      console.debug("[handleBatchApprove] Calls to be sent:", calls);
      await window.ethereum?.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            from: address,
            chainId: BERA_CHAIN_ID_HEX,
            atomicRequired: true,
            calls,
          },
        ],
      });
      needsApproval.forEach((item) => {
        dispatch({
          type: "updateAllowance",
          index: approvals.findIndex((a) => a.token?.address === item.address),
          allowance: item.requiredAmount,
        });
      });
    } catch (err) {
      console.error("[handleBatchApprove] Error:", err);
      setError(err instanceof Error ? err.message : "Batch approval failed");
    } finally {
      setIsApproving(false);
    }
  };

  const handleResetApprovals = async () => {
    if (!address) return;
    setIsApproving(true);
    setError(undefined);
    try {
      const calls = approvals
        .filter((item) => item.token)
        .map((item) => ({
          to: item.token!.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, 0n],
          }),
          value: "0x0",
        }));
      await window.ethereum?.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            from: address,
            chainId: BERA_CHAIN_ID_HEX,
            atomicRequired: true,
            calls,
          },
        ],
      });
      approvals.forEach((item, index) => {
        if (item.token) {
          dispatch({ type: "updateAllowance", index, allowance: 0n });
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsApproving(false);
    }
  };

  const handleSpenderChange = (value: string) => {
    // Clear any previous error
    setError(undefined);

    try {
      if (value && !isAddress(value)) {
        setError("Invalid address format");
      }
      setSpender(value as Address);
    } catch (err) {
      setError("Invalid address format");
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">Berachain EIP-7702</h1>
        <p className="subtitle">MetaMask Batch Token Approvals</p>
      </div>

      {!isConnected ? (
        <div className="connect-section">
          <button
            className="connect-button"
            onClick={handleConnect}
            disabled={isPending || !injectedConnector}
          >
            {isPending
              ? "Connecting..."
              : injectedConnector
                ? "Connect Wallet"
                : "No Wallet Detected"}
          </button>
          {!injectedConnector && (
            <p style={{ marginTop: "1rem", color: "#666", fontSize: "0.9rem" }}>
              Please install MetaMask or another wallet extension and refresh
              the page.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="account-info">
            <div className="account-address">{address}</div>
            <button className="disconnect-button" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>

          <div className="section">
            <h2 className="section-title">Batch Token Approvals</h2>

            <div className="form-group" style={{ marginBottom: "1.5rem" }}>
              <label className="form-label">Spender Address</label>
              <input
                className="form-input"
                type="text"
                value={spender}
                onChange={(e) => handleSpenderChange(e.target.value)}
                placeholder="0x..."
              />
              {error && <div className="error-message">{error}</div>}
            </div>

            <div>
              {approvals.map((item, index) => (
                <div
                  key={(item.token?.symbol || "unknown") + "-" + index}
                  className="batch-item"
                  style={{ marginBottom: "1rem" }}
                >
                  <div className="form-group">
                    <label className="form-label">Token</label>
                    <select
                      className="form-input"
                      value={item.token?.symbol || ""}
                      onChange={(e) => {
                        const token = TOKENS.find(
                          (t) => t.symbol === e.target.value,
                        );
                        dispatch({ type: "changeToken", index, value: token });
                      }}
                    >
                      <option value="">Select token</option>
                      {TOKENS.map((token, idx) => (
                        <option
                          key={token.symbol + "-" + idx}
                          value={token.symbol}
                        >
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Amount</label>
                    <input
                      className="form-input"
                      type="number"
                      value={item.amount}
                      onChange={(e) =>
                        dispatch({
                          type: "changeAmount",
                          index,
                          value: e.target.value,
                        })
                      }
                      placeholder="0.0"
                      step="0.001"
                    />
                  </div>

                  {item.allowance !== undefined && (
                    <div className="form-group">
                      <label className="form-label">Current Allowance</label>
                      <div className="balance-value">
                        {formatEther(item.allowance)} {item.token?.symbol}
                      </div>
                    </div>
                  )}

                  {approvals.length > 1 && (
                    <button
                      className="secondary-button"
                      onClick={() => dispatch({ type: "remove", index })}
                      style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              <div
                className="button-group"
                style={{ justifyContent: "flex-end" }}
              >
                <button
                  className="secondary-button"
                  onClick={() => dispatch({ type: "add", index: -1 })}
                >
                  Add Token
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <h2 className="section-title">Approval Status</h2>

            {needsApproval.length > 0 ? (
              <div className="batch-list">
                <h3 style={{ marginBottom: "1rem" }}>
                  Tokens Needing Approval:
                </h3>
                {needsApproval.map((item, idx) => (
                  <div
                    key={(item.symbol || "unknown") + "-" + idx}
                    className="batch-item"
                  >
                    <div>
                      <div className="batch-item-label">Token</div>
                      <div className="batch-item-value">{item.symbol}</div>
                    </div>
                    <div>
                      <div className="batch-item-label">Required</div>
                      <div className="batch-item-value">
                        {formatEther(item.requiredAmount)} {item.symbol}
                      </div>
                    </div>
                    <div>
                      <div className="batch-item-label">Current</div>
                      <div className="batch-item-value">
                        {formatEther(item.currentAllowance)} {item.symbol}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#666" }}>No tokens need approval</p>
            )}
          </div>

          <div className="section">
            <div className="button-group">
              <button
                className="primary-button"
                onClick={handleBatchApprove}
                disabled={isApproving || needsApproval.length === 0}
              >
                {isApproving
                  ? "Approving..."
                  : `Approve ${needsApproval.length} Tokens`}
              </button>

              <button
                className="secondary-button"
                onClick={handleResetApprovals}
                disabled={isApproving}
              >
                Reset All Approvals
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
