import { useState, useReducer } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { parseEther, formatEther, type Address, erc20Abi, isAddress } from "viem";

// Token definitions
interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

const TOKENS: Token[] = [
  {
    symbol: "WBERA",
    address: "0x8239FBb3e3D0C2cDFd7888D8a55B8c5Fc4f3aC1e" as Address,
    decimals: 18,
  },
  {
    symbol: "HONEY",
    address: "0x8239FBb3e3D0C2cDFd7888D8a55B8c5Fc4f3aC1d" as Address,
    decimals: 18,
  },
];

// Example spender address (vault or contract that needs approval)
const DEFAULT_SPENDER = "0x8239FBb3e3D0C2cDFd7888D8a55B8c5Fc4f3aC1f" as Address;

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
      return [...state, { token: undefined, amount: "", allowance: undefined, needsApproval: false }];
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
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  
  const [approvals, dispatch] = useReducer(reducer, [
    { token: TOKENS[0], amount: "", allowance: undefined, needsApproval: false },
    { token: TOKENS[1], amount: "", allowance: undefined, needsApproval: false },
  ]);
  
  const [spender, setSpender] = useState<Address>(DEFAULT_SPENDER);
  const [error, setError] = useState<string | undefined>();
  const [isApproving, setIsApproving] = useState(false);

  // Find MetaMask connector
  const metaMaskConnector = connectors.find(c => c.id === "metaMask");

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

  const handleBatchApprove = async () => {
    if (needsApproval.length === 0 || !address) return;
    
    setIsApproving(true);
    setError(undefined);
    
    try {
      // In a real implementation, this would use MetaMask's batch approval API
      // For now, we'll simulate the batch approval process
      
      console.log("Batch approval calls:", needsApproval.map((item) => ({
        to: item.address,
        functionName: "approve",
        args: [spender, item.requiredAmount],
        abi: erc20Abi,
      })));
      
      // Simulate batch approval
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update allowances after successful approval
      needsApproval.forEach((item) => {
        dispatch({ 
          type: "updateAllowance", 
          index: approvals.findIndex(a => a.token?.address === item.address),
          allowance: item.requiredAmount 
        });
      });
      
    } catch (err) {
      console.error("Batch approval failed:", err);
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
      // Reset all approvals to 0
      const resetCalls = approvals
        .filter((item) => item.token)
        .map((item) => ({
          to: item.token!.address,
          functionName: "approve",
          args: [spender, 0n],
          abi: erc20Abi,
        }));
      
      console.log("Reset approval calls:", resetCalls);
      
      // Simulate reset
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update allowances to 0
      approvals.forEach((item, index) => {
        if (item.token) {
          dispatch({ type: "updateAllowance", index, allowance: 0n });
        }
      });
      
    } catch (err) {
      console.error("Reset failed:", err);
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
            onClick={() => metaMaskConnector && connect({ connector: metaMaskConnector })} 
            disabled={isPending || !metaMaskConnector}
          >
            {isPending ? "Connecting..." : "Connect MetaMask"}
          </button>
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
              {error && (
                <div className="error-message">
                  {error}
                </div>
              )}
            </div>

            <div>
              {approvals.map((item, index) => (
                <div key={index} className="batch-item" style={{ marginBottom: "1rem" }}>
                  <div className="form-group">
                    <label className="form-label">Token</label>
                    <select
                      className="form-input"
                      value={item.token?.symbol || ""}
                      onChange={(e) => {
                        const token = TOKENS.find(t => t.symbol === e.target.value);
                        dispatch({ type: "changeToken", index, value: token });
                      }}
                    >
                      <option value="">Select token</option>
                      {TOKENS.map((token) => (
                        <option key={token.symbol} value={token.symbol}>
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
                      onChange={(e) => dispatch({ type: "changeAmount", index, value: e.target.value })}
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

              <div className="button-group" style={{ justifyContent: "flex-end" }}>
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
                <h3 style={{ marginBottom: "1rem" }}>Tokens Needing Approval:</h3>
                {needsApproval.map((item) => (
                  <div key={item.address} className="batch-item">
                    <div>
                      <div className="batch-item-label">Token</div>
                      <div className="batch-item-value">{item.symbol}</div>
                    </div>
                    <div>
                      <div className="batch-item-label">Required</div>
                      <div className="batch-item-value">{formatEther(item.requiredAmount)} {item.symbol}</div>
                    </div>
                    <div>
                      <div className="batch-item-label">Current</div>
                      <div className="batch-item-value">{formatEther(item.currentAllowance)} {item.symbol}</div>
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
                {isApproving ? "Approving..." : `Approve ${needsApproval.length} Tokens`}
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