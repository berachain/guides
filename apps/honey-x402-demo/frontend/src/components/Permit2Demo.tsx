import { useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { parseEther, formatEther, formatUnits, maxUint256 } from "viem";
import type { TransactionReceipt } from "viem";
import {
  tokenHolderClient,
  gasSubsidizerClient,
  publicClient,
  tokenHolderAccount,
  gasSubsidizerAccount,
} from "../config/clients";

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const demoAbi = [
  {
    name: "transferFromWithPermit2Signature",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "transferDetails",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "requestedAmount", type: "uint256" },
        ],
      },
      { name: "owner", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "transferFromWithPermit2Allowance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      {
        name: "permitSingle",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
] as const;

interface Permit2DemoProps {
  honeyAddress: `0x${string}`;
  permit2Address: `0x${string}`;
  demoAddress: `0x${string}`;
  onTxComplete?: () => void;
}

// Duration presets in seconds
const DURATION_OPTIONS = [
  { label: "1 minute", value: 60 },
  { label: "5 minutes", value: 300 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
] as const;

interface SigTransferData {
  sig: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  spender: `0x${string}`;
}

interface AllowTransferData {
  sig: `0x${string}`;
  token: `0x${string}`;
  amount: number;
  expiration: number;
  nonce: number;
  spender: `0x${string}`;
  sigDeadline: bigint;
}

function addr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function fmtTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

export function Permit2Demo({
  honeyAddress,
  permit2Address,
  demoAddress,
  onTxComplete,
}: Permit2DemoProps) {
  const [amount, setAmount] = useState("100");
  const [method, setMethod] = useState<"signature" | "allowance">("signature");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [step, setStep] = useState<
    "idle" | "signing" | "signed" | "executing" | "confirming" | "done"
  >("idle");

  // Allowance-specific controls
  const [allowanceDuration, setAllowanceDuration] = useState(3600);
  const [sigDeadlineDuration, setSigDeadlineDuration] = useState(3600);

  // Approval state
  const [approving, setApproving] = useState(false);

  // Stored data
  const [sigData, setSigData] = useState<SigTransferData | null>(null);
  const [allowData, setAllowData] = useState<AllowTransferData | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [signedSig, setSignedSig] = useState<`0x${string}` | null>(null);

  const enabled = honeyAddress !== "0x0000000000000000000000000000000000000000";
  const permit2Enabled =
    enabled && permit2Address !== "0x0000000000000000000000000000000000000000";

  // ── Check ERC20 allowance to Permit2 ──
  const { data: permit2Allowance, refetch: refetchAllowance } = useReadContract(
    {
      address: honeyAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [tokenHolderAccount.address, permit2Address],
      query: { enabled: permit2Enabled, refetchInterval: 6000 },
    },
  );

  const hasPermit2Approval =
    permit2Allowance !== undefined && permit2Allowance > 0n;

  // Balances
  const { data: ethBalA } = useBalance({
    address: tokenHolderAccount.address,
    query: { refetchInterval: 4000 },
  });
  const { data: honeyBalA } = useReadContract({
    address: honeyAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [tokenHolderAccount.address],
    query: { enabled, refetchInterval: 4000 },
  });
  const { data: ethBalB } = useBalance({
    address: gasSubsidizerAccount.address,
    query: { refetchInterval: 4000 },
  });
  const { data: honeyBalB } = useReadContract({
    address: honeyAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [gasSubsidizerAccount.address],
    query: { enabled, refetchInterval: 4000 },
  });

  const fmtHoney = (v: unknown) =>
    v !== undefined
      ? parseFloat(formatUnits(v as bigint, 18)).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })
      : "...";
  const fmtEth = (v: { value: bigint } | undefined) =>
    v ? parseFloat(formatEther(v.value)).toFixed(4) : "...";

  // ── Approve Permit2 (one-time setup) ──
  const handleApprovePermit2 = async () => {
    setError(null);
    setApproving(true);
    try {
      const hash = await tokenHolderClient.writeContract({
        address: honeyAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [permit2Address, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refetchAllowance();
      setApproving(false);
    } catch (err) {
      setError(`Approve failed: ${(err as Error).message}`);
      setApproving(false);
    }
  };

  // ── Sign — Signature Transfer ──
  const handleSignSignature = async () => {
    setError(null);
    setStep("signing");
    setStatus("Wallet A signing Permit2 off-chain...");
    try {
      const value = parseEther(amount);
      const nonce = BigInt(Math.floor(Math.random() * 1000000000));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const sig = await tokenHolderClient.signTypedData({
        domain: {
          name: "Permit2",
          chainId: 31337,
          verifyingContract: permit2Address,
        },
        types: {
          PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
          TokenPermissions: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
        primaryType: "PermitTransferFrom",
        message: {
          permitted: { token: honeyAddress, amount: value },
          spender: demoAddress,
          nonce,
          deadline,
        },
      });

      setSigData({
        sig,
        token: honeyAddress,
        amount: value,
        nonce,
        deadline,
        spender: demoAddress,
      });
      setSignedSig(sig);
      setStep("signed");
      setStatus("");
    } catch (err) {
      setError(`Signing failed: ${(err as Error).message}`);
      setStep("idle");
      setStatus("");
    }
  };

  // ── Sign — Allowance Transfer ──
  const handleSignAllowance = async () => {
    setError(null);
    setStep("signing");
    setStatus("Wallet A signing Permit2 allowance off-chain...");
    try {
      const amountValue = Math.floor(parseFloat(amount) * 10 ** 6);
      const now = Math.floor(Date.now() / 1000);
      const expiration = now + allowanceDuration;
      const nonce = 0;
      const sigDeadline = BigInt(now + sigDeadlineDuration);

      const sig = await tokenHolderClient.signTypedData({
        domain: {
          name: "Permit2",
          chainId: 31337,
          verifyingContract: permit2Address,
        },
        types: {
          PermitSingle: [
            { name: "details", type: "PermitDetails" },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
          PermitDetails: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint160" },
            { name: "expiration", type: "uint48" },
            { name: "nonce", type: "uint48" },
          ],
        },
        primaryType: "PermitSingle",
        message: {
          details: {
            token: honeyAddress,
            amount: amountValue,
            expiration,
            nonce,
          },
          spender: demoAddress,
          sigDeadline,
        },
      });

      setAllowData({
        sig,
        token: honeyAddress,
        amount: amountValue,
        expiration,
        nonce,
        spender: demoAddress,
        sigDeadline,
      });
      setSignedSig(sig);
      setStep("signed");
      setStatus("");
    } catch (err) {
      setError(`Signing failed: ${(err as Error).message}`);
      setStep("idle");
      setStatus("");
    }
  };

  // ── Execute — Signature Transfer ──
  const handleExecSig = async () => {
    if (!sigData) return;
    setError(null);
    setStep("executing");
    setStatus("Wallet B submitting on-chain...");
    try {
      const hash = await gasSubsidizerClient.writeContract({
        address: demoAddress,
        abi: demoAbi,
        functionName: "transferFromWithPermit2Signature",
        args: [
          {
            permitted: { token: sigData.token, amount: sigData.amount },
            nonce: sigData.nonce,
            deadline: sigData.deadline,
          },
          { to: gasSubsidizerAccount.address, requestedAmount: sigData.amount },
          tokenHolderAccount.address,
          sigData.sig,
        ],
      });
      setStep("confirming");
      setStatus("Waiting for confirmation...");
      const r = await publicClient.waitForTransactionReceipt({ hash });
      setReceipt(r);
      setStep("done");
      setStatus("");
      onTxComplete?.();
    } catch (err) {
      setError(`Execution failed: ${(err as Error).message}`);
      setStep("signed");
      setStatus("");
    }
  };

  // ── Execute — Allowance Transfer ──
  const handleExecAllow = async () => {
    if (!allowData) return;
    setError(null);
    setStep("executing");
    setStatus("Wallet B submitting on-chain...");
    try {
      const hash = await gasSubsidizerClient.writeContract({
        address: demoAddress,
        abi: demoAbi,
        functionName: "transferFromWithPermit2Allowance",
        args: [
          tokenHolderAccount.address,
          {
            details: {
              token: allowData.token as `0x${string}`,
              amount: allowData.amount,
              expiration: allowData.expiration,
              nonce: allowData.nonce,
            },
            spender: allowData.spender as `0x${string}`,
            sigDeadline: allowData.sigDeadline,
          },
          allowData.sig,
          gasSubsidizerAccount.address,
        ],
      });
      setStep("confirming");
      setStatus("Waiting for confirmation...");
      const r = await publicClient.waitForTransactionReceipt({ hash });
      setReceipt(r);
      setStep("done");
      setStatus("");
      onTxComplete?.();
    } catch (err) {
      setError(`Execution failed: ${(err as Error).message}`);
      setStep("signed");
      setStatus("");
    }
  };

  const handleSign =
    method === "signature" ? handleSignSignature : handleSignAllowance;
  const handleExecute =
    method === "signature" ? handleExecSig : handleExecAllow;

  const handleReset = () => {
    setStep("idle");
    setSignedSig(null);
    setSigData(null);
    setAllowData(null);
    setReceipt(null);
    setError(null);
    setStatus("");
  };

  // ── Computed timestamps for preview ──
  const now = Math.floor(Date.now() / 1000);
  const previewExpiration = now + allowanceDuration;
  const previewSigDeadline = now + sigDeadlineDuration;

  return (
    <div className="demo-section">
      <h2>Permit2: Universal Token Approvals (Gasless)</h2>
      <div className="demo-content">
        <div className="explanation">
          <p>
            <strong>How it works:</strong> Uniswap's Permit2 is a{" "}
            <strong>smart contract deployed on-chain</strong> that acts as a
            universal approval layer for any ERC20 token. The token holder signs
            a Permit2 message off-chain, and the gas subsidizer submits it to
            the Permit2 contract on-chain.
          </p>
          <p className="highlight">
            Key: Works with any ERC20 — no need for the token to implement
            EIP-2612.
          </p>
          <p className="note">
            <strong>Permit2 Contract:</strong>{" "}
            <code className="mono">{permit2Address}</code>
          </p>
        </div>

        {/* ── Balances ── */}
        <div className="section-balances">
          <div className="bal-row">
            <span className="bal-label wallet-a">Wallet A</span>
            <span className="bal-addr">{addr(tokenHolderAccount.address)}</span>
            <span className="bal-value">{fmtHoney(honeyBalA)} HONEY</span>
            <span className="bal-value">{fmtEth(ethBalA)} BERA</span>
          </div>
          <div className="bal-row">
            <span className="bal-label wallet-b">Wallet B</span>
            <span className="bal-addr">
              {addr(gasSubsidizerAccount.address)}
            </span>
            <span className="bal-value">{fmtHoney(honeyBalB)} HONEY</span>
            <span className="bal-value">{fmtEth(ethBalB)} BERA</span>
          </div>
        </div>

        {/* ── Permit2 Approval Check ── */}
        {!hasPermit2Approval && permit2Enabled && (
          <div className="detail-card setup-required">
            <h4>Setup Required: Approve Permit2</h4>
            <p className="setup-desc">
              Before Permit2 can transfer tokens on behalf of Wallet A, Wallet A
              must do a one-time ERC20 <code>approve()</code> to the Permit2
              contract. This is a standard
              <code>approve</code> transaction that costs gas — but only needs
              to happen once. After this, all Permit2 operations are gasless for
              Wallet A.
            </p>
            <div className="detail-grid">
              <span className="detail-key">Token</span>
              <span className="detail-val mono">{honeyAddress}</span>
              <span className="detail-key">Spender</span>
              <span className="detail-val mono">
                Permit2 ({addr(permit2Address)})
              </span>
              <span className="detail-key">Amount</span>
              <span className="detail-val">Unlimited (max uint256)</span>
              <span className="detail-key">Current allowance</span>
              <span className="detail-val cost">0 (not approved)</span>
            </div>
            <button
              onClick={handleApprovePermit2}
              disabled={approving}
              className="setup-btn"
            >
              {approving
                ? "⏳ Approving..."
                : "Wallet A: Approve Permit2 (One-time Setup)"}
            </button>
          </div>
        )}

        {hasPermit2Approval && (
          <div className="permit2-approved-badge">
            ✅ Wallet A has approved Permit2 — gasless transfers are enabled
          </div>
        )}

        {/* ── Steps ── */}
        <div className="step-indicator">
          <div
            className={`step ${step === "idle" || step === "signing" ? "active" : "done"}`}
          >
            <span className="step-number">1</span>
            <span>Wallet A Signs</span>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div
            className={`step ${step === "signed" || step === "executing" || step === "confirming" ? "active" : step === "done" ? "done" : ""}`}
          >
            <span className="step-number">2</span>
            <span>Wallet B Executes</span>
          </div>
        </div>

        {/* ══════════ IDLE ══════════ */}
        {step === "idle" && (
          <>
            {/* Mode selector & inputs */}
            <div className="input-group">
              <label>Method:</label>
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value as "signature" | "allowance");
                  handleReset();
                }}
              >
                <option value="signature">
                  Signature Transfer (One-time, gasless)
                </option>
                <option value="allowance">
                  Allowance Transfer (Reusable, time-bound)
                </option>
              </select>
            </div>
            <div className="input-group">
              <label>Amount (HONEY):</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="1"
              />
            </div>

            {/* ── Signature Transfer Preview ── */}
            {method === "signature" && (
              <div className="detail-card preview">
                <h4>Transaction to Sign — Signature Transfer</h4>
                <div className="detail-grid">
                  <span className="detail-key">Type</span>
                  <span className="detail-val">
                    Permit2 <code>PermitTransferFrom</code>
                  </span>
                  <span className="detail-key">From (owner)</span>
                  <span className="detail-val mono">
                    {tokenHolderAccount.address}
                  </span>
                  <span className="detail-key">Spender (via)</span>
                  <span className="detail-val mono">{demoAddress}</span>
                  <span className="detail-key">To (recipient)</span>
                  <span className="detail-val mono">
                    {gasSubsidizerAccount.address}
                  </span>
                  <span className="detail-key">Amount</span>
                  <span className="detail-val">
                    {amount} HONEY (exact, one-time)
                  </span>
                  <span className="detail-key">Nonce</span>
                  <span className="detail-val">Random (single-use)</span>
                  <span className="detail-key">Deadline</span>
                  <span className="detail-val">1 hour from now</span>
                  <span className="detail-key">Reusable?</span>
                  <span className="detail-val">No — consumed on first use</span>
                  <span className="detail-key">Gas cost</span>
                  <span className="detail-val free">
                    FREE (off-chain signature)
                  </span>
                </div>
              </div>
            )}

            {/* ── Allowance Transfer Preview — with time-bound controls ── */}
            {method === "allowance" && (
              <>
                <div className="detail-card time-bound">
                  <h4>Time-Bound Limits</h4>
                  <p className="time-bound-desc">
                    The Allowance Transfer sets a <strong>spending cap</strong>{" "}
                    that the spender can draw from{" "}
                    <strong>multiple times</strong> — until either the cap is
                    exhausted or the allowance expires. Two separate timers
                    control the window:
                  </p>

                  <div className="time-bound-controls">
                    <div className="time-bound-row">
                      <div className="time-bound-label">
                        <strong>Allowance Expiration</strong>
                        <span className="time-bound-help">
                          How long the spender can keep using this allowance
                        </span>
                      </div>
                      <select
                        value={allowanceDuration}
                        onChange={(e) =>
                          setAllowanceDuration(Number(e.target.value))
                        }
                        className="time-bound-select"
                      >
                        {DURATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="time-bound-result">
                        Expires: {fmtTimestamp(previewExpiration)}
                      </span>
                    </div>

                    <div className="time-bound-row">
                      <div className="time-bound-label">
                        <strong>Signature Deadline</strong>
                        <span className="time-bound-help">
                          How long this signature can be submitted on-chain
                        </span>
                      </div>
                      <select
                        value={sigDeadlineDuration}
                        onChange={(e) =>
                          setSigDeadlineDuration(Number(e.target.value))
                        }
                        className="time-bound-select"
                      >
                        {DURATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="time-bound-result">
                        Deadline: {fmtTimestamp(previewSigDeadline)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="detail-card preview">
                  <h4>Transaction to Sign — Allowance Transfer</h4>
                  <div className="detail-grid">
                    <span className="detail-key">Type</span>
                    <span className="detail-val">
                      Permit2 <code>PermitSingle</code>
                    </span>
                    <span className="detail-key">From (owner)</span>
                    <span className="detail-val mono">
                      {tokenHolderAccount.address}
                    </span>
                    <span className="detail-key">Spender</span>
                    <span className="detail-val mono">{demoAddress}</span>
                    <span className="detail-key">Spending cap</span>
                    <span className="detail-val">
                      {amount} HONEY (uint160 max)
                    </span>
                    <span className="detail-key">Allowance expires</span>
                    <span className="detail-val">
                      {fmtTimestamp(previewExpiration)} (
                      {fmtDuration(allowanceDuration)})
                    </span>
                    <span className="detail-key">Sig deadline</span>
                    <span className="detail-val">
                      {fmtTimestamp(previewSigDeadline)} (
                      {fmtDuration(sigDeadlineDuration)})
                    </span>
                    <span className="detail-key">Nonce</span>
                    <span className="detail-val">
                      0 (sequential — Permit2 tracks per-token)
                    </span>
                    <span className="detail-key">Reusable?</span>
                    <span className="detail-val">
                      Yes — until cap exhausted or expired
                    </span>
                    <span className="detail-key">Gas cost</span>
                    <span className="detail-val free">
                      FREE (off-chain signature)
                    </span>
                  </div>
                </div>

                <div className="detail-card comparison-hint">
                  <h4>Signature vs Allowance — What's different?</h4>
                  <table className="mini-compare">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Signature Transfer</th>
                        <th>Allowance Transfer</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Uses</td>
                        <td>One-time only</td>
                        <td className="highlight-cell">
                          Reusable until cap/expiry
                        </td>
                      </tr>
                      <tr>
                        <td>Amount type</td>
                        <td>uint256 (exact)</td>
                        <td className="highlight-cell">
                          uint160 (spending cap)
                        </td>
                      </tr>
                      <tr>
                        <td>Expiration</td>
                        <td>Deadline only</td>
                        <td className="highlight-cell">
                          Allowance expiry + sig deadline
                        </td>
                      </tr>
                      <tr>
                        <td>Nonce</td>
                        <td>Random</td>
                        <td className="highlight-cell">
                          Sequential (per token)
                        </td>
                      </tr>
                      <tr>
                        <td>Best for</td>
                        <td>Single transfers</td>
                        <td className="highlight-cell">
                          Recurring / subscription-like
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <button onClick={handleSign} disabled={!hasPermit2Approval}>
              1. Wallet A: Sign Permit2 (Off-chain, No Gas)
            </button>
          </>
        )}

        {step === "signing" && (
          <div className="signature-info">
            <p>⏳ {status}</p>
          </div>
        )}

        {/* ══════════ SIGNED ══════════ */}
        {step === "signed" && signedSig && (
          <>
            {method === "signature" && sigData && (
              <div className="detail-card sig">
                <h4>Signature — Signature Transfer (EIP-712)</h4>
                <div className="detail-grid">
                  <span className="detail-key">Method</span>
                  <span className="detail-val">
                    One-time Signature Transfer
                  </span>
                  <span className="detail-key">Amount</span>
                  <span className="detail-val">{amount} HONEY</span>
                  <span className="detail-key">Nonce</span>
                  <span className="detail-val">
                    {sigData.nonce.toString()} (random)
                  </span>
                  <span className="detail-key">Deadline</span>
                  <span className="detail-val">
                    {fmtTimestamp(Number(sigData.deadline))}
                  </span>
                  <span className="detail-key">Raw signature</span>
                  <span className="detail-val mono break tiny">
                    {signedSig}
                  </span>
                  <span className="detail-key">Gas spent</span>
                  <span className="detail-val free">0 (off-chain)</span>
                </div>
              </div>
            )}

            {method === "allowance" && allowData && (
              <div className="detail-card sig">
                <h4>Signature — Allowance Transfer (EIP-712)</h4>
                <div className="detail-grid">
                  <span className="detail-key">Method</span>
                  <span className="detail-val">
                    Reusable Allowance Transfer
                  </span>
                  <span className="detail-key">Spending cap</span>
                  <span className="detail-val">{amount} HONEY</span>
                  <span className="detail-key">Nonce</span>
                  <span className="detail-val">
                    {allowData.nonce} (sequential)
                  </span>
                </div>

                <div className="time-bound-signed">
                  <h5>Time-Bound Limits Locked In</h5>
                  <div className="detail-grid">
                    <span className="detail-key">Allowance expires</span>
                    <span className="detail-val">
                      {fmtTimestamp(allowData.expiration)} (
                      {fmtDuration(
                        allowData.expiration - Math.floor(Date.now() / 1000),
                      )}{" "}
                      remaining)
                    </span>
                    <span className="detail-key">Sig deadline</span>
                    <span className="detail-val">
                      {fmtTimestamp(Number(allowData.sigDeadline))} (
                      {fmtDuration(
                        Number(allowData.sigDeadline) -
                          Math.floor(Date.now() / 1000),
                      )}{" "}
                      remaining)
                    </span>
                    <span className="detail-key">Reusable?</span>
                    <span className="detail-val">
                      Yes — spender can draw up to {amount} HONEY across
                      multiple calls
                    </span>
                  </div>
                </div>

                <div className="detail-grid" style={{ marginTop: "0.5rem" }}>
                  <span className="detail-key">Raw signature</span>
                  <span className="detail-val mono break tiny">
                    {signedSig}
                  </span>
                  <span className="detail-key">Gas spent</span>
                  <span className="detail-val free">0 (off-chain)</span>
                </div>
              </div>
            )}

            <button onClick={handleExecute}>
              2. Wallet B: Execute On-chain (Pays Gas)
            </button>
          </>
        )}

        {(step === "executing" || step === "confirming") && (
          <div className="signature-info">
            <p>⏳ {status}</p>
          </div>
        )}

        {/* ══════════ DONE ══════════ */}
        {step === "done" && receipt && (
          <>
            <div className="detail-card receipt">
              <h4>Transaction Receipt</h4>
              <div className="detail-grid">
                <span className="detail-key">Status</span>
                <span className="detail-val">
                  {receipt.status === "success" ? "✅ Success" : "❌ Reverted"}
                </span>
                <span className="detail-key">Tx Hash</span>
                <span className="detail-val mono break">
                  {receipt.transactionHash}
                </span>
                <span className="detail-key">Block</span>
                <span className="detail-val">
                  {receipt.blockNumber.toString()}
                </span>
                <span className="detail-key">Gas Used</span>
                <span className="detail-val">
                  {receipt.gasUsed.toLocaleString()} gas
                </span>
                <span className="detail-key">Gas Price</span>
                <span className="detail-val">
                  {formatUnits(receipt.effectiveGasPrice, 9)} gwei
                </span>
                <span className="detail-key">Total Gas Cost</span>
                <span className="detail-val cost">
                  {formatEther(receipt.gasUsed * receipt.effectiveGasPrice)}{" "}
                  BERA
                </span>
                <span className="detail-key">Paid By</span>
                <span className="detail-val mono">
                  Wallet B ({addr(gasSubsidizerAccount.address)})
                </span>
              </div>
            </div>

            {method === "allowance" && allowData && (
              <div className="detail-card time-bound-result">
                <h4>Allowance Status After Transfer</h4>
                <div className="detail-grid">
                  <span className="detail-key">Transferred</span>
                  <span className="detail-val">{amount} HONEY</span>
                  <span className="detail-key">Remaining cap</span>
                  <span className="detail-val">
                    Spender may still draw from the allowance if cap allows
                  </span>
                  <span className="detail-key">Allowance expires</span>
                  <span className="detail-val">
                    {fmtTimestamp(allowData.expiration)} (
                    {fmtDuration(
                      Math.max(
                        0,
                        allowData.expiration - Math.floor(Date.now() / 1000),
                      ),
                    )}{" "}
                    remaining)
                  </span>
                  <span className="detail-key">Still reusable?</span>
                  <span className="detail-val">
                    Yes — until cap exhausted or{" "}
                    {fmtTimestamp(allowData.expiration)}
                  </span>
                </div>
              </div>
            )}

            <div className="detail-card transfer-summary">
              <h4>Transfer Summary</h4>
              <div className="detail-grid">
                <span className="detail-key">Sent</span>
                <span className="detail-val">{amount} HONEY</span>
                <span className="detail-key">Method</span>
                <span className="detail-val">
                  {method === "signature"
                    ? "One-time Signature Transfer"
                    : "Reusable Allowance Transfer"}
                </span>
                <span className="detail-key">From</span>
                <span className="detail-val mono">
                  Wallet A ({addr(tokenHolderAccount.address)})
                </span>
                <span className="detail-key">To</span>
                <span className="detail-val mono">
                  Wallet B ({addr(gasSubsidizerAccount.address)})
                </span>
                <span className="detail-key">Wallet A gas cost</span>
                <span className="detail-val free">0 BERA (gasless!)</span>
                <span className="detail-key">Wallet B gas cost</span>
                <span className="detail-val cost">
                  {formatEther(receipt.gasUsed * receipt.effectiveGasPrice)}{" "}
                  BERA
                </span>
              </div>
            </div>
            <button onClick={handleReset} className="reset-btn">
              Try Again
            </button>
          </>
        )}

        {error && <p className="error">❌ {error}</p>}
      </div>
    </div>
  );
}
