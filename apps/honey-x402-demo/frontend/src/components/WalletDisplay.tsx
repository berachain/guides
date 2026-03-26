import { useBalance, useReadContract } from "wagmi";
import { formatEther, formatUnits } from "viem";

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface WalletDisplayProps {
  label: string;
  description: string;
  address: `0x${string}`;
  honeyAddress: `0x${string}`;
  role: "holder" | "subsidizer";
}

export function WalletDisplay({
  label,
  description,
  address,
  honeyAddress,
  role,
}: WalletDisplayProps) {
  const { data: ethBalance } = useBalance({
    address,
    query: {
      enabled: !!address,
      refetchInterval: 4000,
    },
  });

  const { data: honeyBalance } = useReadContract({
    address: honeyAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: {
      enabled:
        !!address &&
        honeyAddress !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 4000,
    },
  });

  return (
    <div className={`wallet-display ${role}`}>
      <div className="wallet-header">
        <h3>{label}</h3>
        <span className={`role-badge ${role}`}>
          {role === "holder" ? "Signs (No Gas)" : "Pays Gas"}
        </span>
      </div>
      <p className="wallet-description">{description}</p>
      <div className="wallet-info">
        <p>
          <strong>Address:</strong>{" "}
          <span className="address">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        </p>
        <p>
          <strong>BERA:</strong>{" "}
          {ethBalance
            ? parseFloat(formatEther(ethBalance.value)).toFixed(4)
            : "..."}{" "}
          BERA
        </p>
        <p>
          <strong>HONEY:</strong>{" "}
          {honeyBalance !== undefined
            ? parseFloat(formatUnits(honeyBalance as bigint, 18)).toFixed(2)
            : "..."}{" "}
          HONEY
        </p>
      </div>
    </div>
  );
}
