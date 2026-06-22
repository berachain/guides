import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { twoFactorAccountAbi } from "@tfa/contracts/abi";
import { twoFactorAccountBytecode } from "@tfa/contracts/bytecode";
import {
  concat,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeDeployData,
  encodePacked,
  formatEther,
  hexToBigInt,
  hexToBytes,
  http,
  isAddress,
  isHex,
  keccak256,
  padHex,
  parseEther,
  stringToHex,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { useMemo, useState, type FormEvent } from "react";

const CONTRACT_ADDRESS_KEY = "tfa_contract_address";
const CREDENTIAL_ID_KEY = "tfa_credential_id";
const SIGNATURE_DRAFT_KEY = "tfa_signature_draft";
const PENDING_SIGNATURES_KEY = "tfa_pending_signatures";
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_SECP256K1_N = SECP256K1_N / 2n;
const RECEIPT_TIMEOUT_MS = 180_000;
const MAX_TX_GAS_LIMIT = 16_000_000n;
const WEBAUTHN_UNSUPPORTED_ERROR =
  "WebAuthn is not supported on this device or browser. Use Chrome, Safari, or Edge on a device with biometric authentication.";

export const NETWORKS = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: import.meta.env.VITE_ETHEREUM_MAINNET_RPC_URL,
    blockExplorerUrl: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    supportsP256Precompile: true,
  },
  {
    chainId: 11155111,
    name: "Ethereum Sepolia Testnet",
    rpcUrl: import.meta.env.VITE_ETHEREUM_SEPOLIA_RPC_URL,
    blockExplorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    supportsP256Precompile: false,
  },
  {
    chainId: 80094,
    name: "Berachain Mainnet",
    rpcUrl: import.meta.env.VITE_BERACHAIN_MAINNET_RPC_URL,
    blockExplorerUrl: "https://berascan.com",
    nativeCurrency: { name: "Bera", symbol: "BERA", decimals: 18 },
    supportsP256Precompile: true,
  },
  {
    chainId: 80069,
    name: "Berachain Bepolia Testnet",
    rpcUrl: import.meta.env.VITE_BERACHAIN_BEPOLIA_RPC_URL,
    blockExplorerUrl: "https://bepolia.beratrail.io",
    nativeCurrency: { name: "Bera", symbol: "BERA", decimals: 18 },
    supportsP256Precompile: false,
  },
] as const;

type Network = (typeof NETWORKS)[number];

type PendingSignature = {
  target: Address;
  value: Hex;
  data: Hex;
  v: number;
  r: Hex;
  s: Hex;
  authenticatorData: Hex;
  clientDataJSON: Hex;
  webAuthnHash: Hex;
  p256R: Hex;
  p256S: Hex;
  intentHash: Hex;
  contractAddress: Address;
  chainId: number;
  nonce: Hex;
};

type SignatureDraft = {
  target: Address;
  value: Hex;
  data: Hex;
  intentHash: Hex;
  contractAddress: Address;
  chainId: number;
  nonce: Hex;
  v?: number;
  r?: Hex;
  s?: Hex;
  authenticatorData?: Hex;
  clientDataJSON?: Hex;
  webAuthnHash?: Hex;
  p256R?: Hex;
  p256S?: Hex;
};

type HardwareKey = {
  credentialId: string;
  p256x: Hex;
  p256y: Hex;
};

function readStoredContractAddress(): Address | "" {
  const value = localStorage.getItem(CONTRACT_ADDRESS_KEY);
  return value && isAddress(value) ? value : "";
}

function readStoredCredentialId(): string {
  return localStorage.getItem(CREDENTIAL_ID_KEY) ?? "";
}

function readSignatureDraft(): SignatureDraft | null {
  const value = localStorage.getItem(SIGNATURE_DRAFT_KEY);
  if (!value) return null;

  try {
    return JSON.parse(value) as SignatureDraft;
  } catch {
    localStorage.removeItem(SIGNATURE_DRAFT_KEY);
    return null;
  }
}

function readPendingSignatures(): PendingSignature | null {
  const value = localStorage.getItem(PENDING_SIGNATURES_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<PendingSignature>;
    if (
      !parsed.authenticatorData ||
      !parsed.clientDataJSON ||
      !parsed.webAuthnHash
    ) {
      localStorage.removeItem(PENDING_SIGNATURES_KEY);
      return null;
    }

    return parsed as PendingSignature;
  } catch {
    return null;
  }
}

function isCompleteSignatureDraft(
  draft: SignatureDraft,
): draft is PendingSignature {
  return Boolean(
    draft.v !== undefined &&
    draft.r &&
    draft.s &&
    draft.authenticatorData &&
    draft.clientDataJSON &&
    draft.webAuthnHash &&
    draft.p256R &&
    draft.p256S,
  );
}

function toChain(network: Network) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: {
      default: {
        http: [network.rpcUrl],
      },
    },
    blockExplorers: {
      default: {
        name: network.name,
        url: network.blockExplorerUrl,
      },
    },
  });
}

function requireEthereum(): EIP1193Provider {
  if (!window.ethereum) {
    throw new Error(
      "No browser wallet detected. Install MetaMask or another EIP-1193 wallet.",
    );
  }

  return window.ethereum as EIP1193Provider;
}

async function requirePlatformWebAuthn() {
  if (!navigator.credentials || !window.PublicKeyCredential) {
    throw new Error(WEBAUTHN_UNSUPPORTED_ERROR);
  }

  const isPlatformAvailable =
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  if (!isPlatformAvailable) {
    throw new Error(WEBAUTHN_UNSUPPORTED_ERROR);
  }
}

function getFormValue(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function normalizeBytes32Hex(value: string, label: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(`${label} must be a 32-byte hex string.`);
  }

  return normalized as Hex;
}

function normalizeCallData(value: string): Hex {
  if (!value) return "0x";
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized)) {
    throw new Error("Call data must be a hex string.");
  }

  return normalized as Hex;
}

function bytes32FromBigInt(value: bigint): Hex {
  return padHex(toHex(value), { size: 32 });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64urlToBytes(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((total, array) => total + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

function bytesToBytes32Hex(bytes: Uint8Array, label: string): Hex {
  if (bytes.length > 32) {
    throw new Error(`${label} is longer than 32 bytes.`);
  }

  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return toHex(padded);
}

function extractP256XY(spki: ArrayBuffer): { x: Uint8Array; y: Uint8Array } {
  const bytes = new Uint8Array(spki);
  const point = bytes.slice(-65);
  if (point[0] !== 0x04) throw new Error("Not an uncompressed point");
  return { x: point.slice(1, 33), y: point.slice(33, 65) };
}

function parseDERSignature(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (der[0] !== 0x30) throw new Error("Expected DER sequence");
  let offset = 2;

  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for r");
  offset++;
  const rLen = der[offset++];
  const r = der.slice(offset + (rLen === 33 ? 1 : 0), offset + rLen).slice(-32);
  offset += rLen;

  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for s");
  offset++;
  const sLen = der[offset++];
  const s = der.slice(offset + (sLen === 33 ? 1 : 0), offset + sLen).slice(-32);

  return { r, s };
}

function splitAndNormalizeSecp256k1Signature(signature: Hex) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("Wallet returned an invalid 65-byte signature.");
  }

  const r = `0x${signature.slice(2, 66)}` as Hex;
  let s = hexToBigInt(`0x${signature.slice(66, 130)}`);
  let v = Number.parseInt(signature.slice(130, 132), 16);

  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) {
    throw new Error(`Unsupported signature recovery id: ${v}.`);
  }

  if (s > HALF_SECP256K1_N) {
    s = SECP256K1_N - s;
    v = v === 27 ? 28 : 27;
  }

  return { v, r, s: bytes32FromBigInt(s) };
}

function buildIntentHash(
  target: Address,
  value: bigint,
  data: Hex,
  nonce: bigint,
  chainId: number,
): Hex {
  return keccak256(
    encodePacked(
      ["address", "uint256", "bytes", "uint256", "uint256"],
      [target, value, data, nonce, BigInt(chainId)],
    ),
  );
}

function buildEthHash(intentHash: Hex): Hex {
  return toHex(
    keccak_256(
      hexToBytes(
        concat([stringToHex("\x19Ethereum Signed Message:\n32"), intentHash]),
      ),
    ),
  );
}

function buildWebAuthnHash(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Hex {
  return toHex(sha256(concatBytes(authenticatorData, sha256(clientDataJSON))));
}

function validateWebAuthnChallenge(
  clientDataJSON: Uint8Array,
  intentHash: Hex,
) {
  const expectedChallenge = bytesToBase64Url(hexToBytes(intentHash));
  const decoded = new TextDecoder().decode(clientDataJSON);
  const parsed = JSON.parse(decoded) as { type?: string; challenge?: string };

  if (parsed.type !== "webauthn.get") {
    throw new Error(
      "WebAuthn assertion returned an unexpected clientDataJSON type.",
    );
  }
  if (parsed.challenge !== expectedChallenge) {
    throw new Error(
      "WebAuthn assertion challenge did not match the intent hash.",
    );
  }
}

function isUnavailableRpcMethodError(error: unknown): boolean {
  const maybeError = error as {
    code?: number;
    message?: string;
    details?: string;
  };
  const text = `${maybeError.message ?? ""} ${maybeError.details ?? ""}`;
  return (
    maybeError.code === -32601 ||
    /method .*eth_sign.*(does not exist|not available)|eth_sign.*(does not exist|not available)/iu.test(
      text,
    )
  );
}

function displayValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : JSON.stringify(value);
}

function formatNativeAmount(value: bigint, network: Network): string {
  return `${Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${network.nativeCurrency.symbol}`;
}

function getInsufficientFundsMessage(
  message: string,
  network: Network,
): string | null {
  if (!/insufficient funds|exceeds the balance/i.test(message)) return null;

  const match = message.match(/have\s+(\d+)\s+want\s+(\d+)/i);
  if (!match) {
    return `Insufficient ${network.nativeCurrency.symbol} balance to deploy. Add more ${network.nativeCurrency.symbol} for gas on ${network.name} and try again.`;
  }

  const have = BigInt(match[1]);
  const want = BigInt(match[2]);
  const shortfall = want > have ? want - have : 0n;

  return `Insufficient ${network.nativeCurrency.symbol} balance to deploy. Have ${formatNativeAmount(have, network)}, estimated need ${formatNativeAmount(want, network)}, short by ${formatNativeAmount(shortfall, network)}.`;
}

function gasWithBuffer(gas: bigint): bigint {
  const buffered = (gas * 120n) / 100n;
  return buffered > MAX_TX_GAS_LIMIT ? MAX_TX_GAS_LIMIT : buffered;
}

function normalizeTransactionHash(result: unknown): Hex {
  const hash =
    typeof result === "string" ? result : (result as { hash?: unknown })?.hash;

  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a valid transaction hash.");
  }

  return hash as Hex;
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function StoredValues({ values }: { values: object }) {
  return (
    <dl className="value-grid">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CredentialStatus({ credentialId }: { credentialId: string }) {
  if (!credentialId) {
    return (
      <p className="note">
        No hardware key is registered for this browser yet.
      </p>
    );
  }

  return (
    <p className="note">
      Stored hardware key credential: <code>{credentialId}</code>
    </p>
  );
}

function ExplorerLink({
  hash,
  network,
  label = "View transaction",
}: {
  hash: Hex;
  network: Network;
  label?: string;
}) {
  return (
    <>
      <a
        href={`${network.blockExplorerUrl}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
      >
        {label}
      </a>{" "}
      <code>{shortHash(hash)}</code>
    </>
  );
}

export function App() {
  const [selectedChainId, setSelectedChainId] = useState<number>(
    NETWORKS[0].chainId,
  );
  const [primaryAddress, setPrimaryAddress] = useState<Address | null>(null);
  const [secondaryAddress, setSecondaryAddress] = useState<Address | null>(
    null,
  );
  const [contractAddress, setContractAddress] = useState<Address | "">(
    readStoredContractAddress,
  );
  const [credentialId, setCredentialId] = useState(readStoredCredentialId);
  const [hardwareKey, setHardwareKey] = useState<HardwareKey | null>(null);
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft | null>(
    readSignatureDraft,
  );
  const [pendingSignatures, setPendingSignatures] =
    useState<PendingSignature | null>(readPendingSignatures);
  const [deployTxHash, setDeployTxHash] = useState<Hex | null>(null);
  const [fundTxHash, setFundTxHash] = useState<Hex | null>(null);
  const [relayTxHash, setRelayTxHash] = useState<Hex | null>(null);
  const [deployStatus, setDeployStatus] = useState("");
  const [fundStatus, setFundStatus] = useState("");
  const [signStatus, setSignStatus] = useState("");
  const [deployError, setDeployError] = useState("");
  const [fundError, setFundError] = useState("");
  const [signError, setSignError] = useState("");
  const [relayError, setRelayError] = useState("");
  const [contractBalance, setContractBalance] = useState<bigint | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isSigningWallet, setIsSigningWallet] = useState(false);
  const [isSigningP256, setIsSigningP256] = useState(false);
  const [isRelaying, setIsRelaying] = useState(false);

  const selectedNetwork =
    NETWORKS.find((network) => network.chainId === selectedChainId) ??
    NETWORKS[0];
  const chain = useMemo(() => toChain(selectedNetwork), [selectedNetwork]);
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain,
        transport: http(selectedNetwork.rpcUrl),
      }),
    [chain, selectedNetwork.rpcUrl],
  );

  function getWalletClient() {
    return createWalletClient({
      chain,
      transport: custom(requireEthereum()),
    });
  }

  function waitForReceipt(hash: Hex) {
    return Promise.race([
      publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        pollingInterval: 2_000,
      }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          reject(
            new Error("Timed out while waiting for the transaction receipt."),
          );
        }, RECEIPT_TIMEOUT_MS);
      }),
    ]);
  }

  async function signOwnerIntent(
    walletClient: ReturnType<typeof getWalletClient>,
    ownerAddress: Address,
    intentHash: Hex,
  ): Promise<Hex> {
    const ethHash = buildEthHash(intentHash);

    try {
      return (await walletClient.request({
        method: "eth_sign",
        params: [ownerAddress, ethHash],
      })) as Hex;
    } catch (error) {
      if (!isUnavailableRpcMethodError(error)) {
        throw error;
      }

      return (await walletClient.request({
        method: "personal_sign",
        params: [intentHash, ownerAddress],
      })) as Hex;
    }
  }

  function storeSignatureDraft(draft: SignatureDraft) {
    localStorage.setItem(SIGNATURE_DRAFT_KEY, JSON.stringify(draft));
    setSignatureDraft(draft);

    if (isCompleteSignatureDraft(draft)) {
      localStorage.setItem(PENDING_SIGNATURES_KEY, JSON.stringify(draft));
      setPendingSignatures(draft);
      setSignStatus("Both signatures are complete. Relay is ready.");
      setRelayError("");
      setRelayTxHash(null);
    } else {
      localStorage.removeItem(PENDING_SIGNATURES_KEY);
      setPendingSignatures(null);
      setSignStatus(
        "Signature draft saved. Complete the remaining signature step.",
      );
      setRelayError("");
      setRelayTxHash(null);
    }
  }

  function isSameIntent(left: SignatureDraft | null, right: SignatureDraft) {
    return Boolean(
      left &&
      left.intentHash === right.intentHash &&
      left.contractAddress === right.contractAddress &&
      left.chainId === right.chainId &&
      left.nonce === right.nonce,
    );
  }

  async function buildSignatureDraft(
    formData: FormData,
  ): Promise<SignatureDraft> {
    if (!contractAddress)
      throw new Error("Deploy or set a contract address before signing.");

    const target = getFormValue(formData, "target");
    if (!isAddress(target))
      throw new Error("Target address is required and must be valid.");

    const value = parseEther(getFormValue(formData, "amount"));
    const data = normalizeCallData(getFormValue(formData, "data"));
    const nonce = await publicClient.readContract({
      address: contractAddress,
      abi: twoFactorAccountAbi,
      functionName: "nonce",
    });
    const intentHash = buildIntentHash(
      target,
      value,
      data,
      nonce,
      selectedNetwork.chainId,
    );

    return {
      target,
      value: toHex(value),
      data,
      intentHash,
      contractAddress,
      chainId: selectedNetwork.chainId,
      nonce: toHex(nonce),
    };
  }

  async function ensureWalletNetwork() {
    const ethereum = requireEthereum();
    const chainId = toHex(selectedNetwork.chainId);

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (error) {
      const maybeError = error as { code?: number };
      if (maybeError.code !== 4902) throw error;

      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: selectedNetwork.name,
            nativeCurrency: selectedNetwork.nativeCurrency,
            rpcUrls: [selectedNetwork.rpcUrl],
            blockExplorerUrls: [selectedNetwork.blockExplorerUrl],
          },
        ],
      });
    }
  }

  async function connectWallet(kind: "primary" | "secondary") {
    try {
      const walletClient = getWalletClient();
      const addresses = await walletClient.request({
        method: "eth_requestAccounts",
      });
      const [address] = addresses as Address[];

      if (!address) throw new Error("Wallet did not return an account.");
      if (kind === "primary") setPrimaryAddress(address);
      else setSecondaryAddress(address);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not connect wallet.";
      if (kind === "primary") setDeployError(message);
      else setRelayError(message);
    }
  }

  function storeContractAddress(address: Address) {
    localStorage.setItem(CONTRACT_ADDRESS_KEY, address);
    setContractAddress(address);
  }

  function clearContract() {
    localStorage.removeItem(CONTRACT_ADDRESS_KEY);
    localStorage.removeItem(SIGNATURE_DRAFT_KEY);
    localStorage.removeItem(PENDING_SIGNATURES_KEY);
    setContractAddress("");
    setSignatureDraft(null);
    setPendingSignatures(null);
    setDeployTxHash(null);
    setFundTxHash(null);
    setDeployStatus("");
    setFundStatus("");
    setSignStatus("");
    setContractBalance(null);
    setRelayTxHash(null);
  }

  function clearHardwareKey() {
    localStorage.removeItem(CREDENTIAL_ID_KEY);
    setCredentialId("");
    setHardwareKey(null);
    setDeployError("");
    clearSignatures();
  }

  function clearSignatures() {
    localStorage.removeItem(SIGNATURE_DRAFT_KEY);
    localStorage.removeItem(PENDING_SIGNATURES_KEY);
    setSignatureDraft(null);
    setPendingSignatures(null);
    setSignStatus("");
    setRelayTxHash(null);
  }

  async function handleRegisterHardwareKey() {
    setDeployError("");

    try {
      if (!primaryAddress)
        throw new Error(
          "Connect the primary owner wallet before registering a hardware key.",
        );
      await requirePlatformWebAuthn();
      setIsRegistering(true);

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "TwoFactorAccount Demo" },
          user: {
            id: new TextEncoder().encode(primaryAddress),
            name: primaryAddress,
            displayName: "Owner",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!credential)
        throw new Error("Hardware key registration was cancelled.");
      const response = credential.response as AuthenticatorAttestationResponse;
      const publicKey = response.getPublicKey();
      if (!publicKey)
        throw new Error("Browser did not return a WebAuthn public key.");

      const { x, y } = extractP256XY(publicKey);
      const storedCredentialId = bytesToBase64Url(
        new Uint8Array(credential.rawId),
      );
      localStorage.setItem(CREDENTIAL_ID_KEY, storedCredentialId);
      setCredentialId(storedCredentialId);
      setHardwareKey({
        credentialId: storedCredentialId,
        p256x: bytesToBytes32Hex(x, "P-256 Public Key X"),
        p256y: bytesToBytes32Hex(y, "P-256 Public Key Y"),
      });
      clearSignatures();
      setDeployError("");
    } catch (error) {
      setDeployError(
        error instanceof Error
          ? error.message
          : "Hardware key registration failed.",
      );
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleDeploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeployError("");
    setDeployTxHash(null);
    setDeployStatus("");
    let submittedHash: Hex | null = null;

    try {
      if (!primaryAddress)
        throw new Error("Connect the primary owner wallet before deploying.");
      if (!hardwareKey)
        throw new Error(
          "Register a hardware key before deploying so the contract can store its P-256 public key.",
        );
      const p256x = hexToBigInt(
        normalizeBytes32Hex(hardwareKey.p256x, "P-256 Public Key X"),
      );
      const p256y = hexToBigInt(
        normalizeBytes32Hex(hardwareKey.p256y, "P-256 Public Key Y"),
      );
      const walletClient = getWalletClient();
      const deployArgs = [primaryAddress, p256x, p256y] as const;
      const deployData = encodeDeployData({
        abi: twoFactorAccountAbi,
        bytecode: twoFactorAccountBytecode,
        args: deployArgs,
      });

      setIsDeploying(true);
      await ensureWalletNetwork();
      setDeployStatus("Checking gas estimate and wallet balance...");

      try {
        const [gas, gasPrice, balance] = await Promise.all([
          publicClient.estimateGas({
            account: primaryAddress,
            data: deployData,
          }),
          publicClient.getGasPrice(),
          publicClient.getBalance({ address: primaryAddress }),
        ]);
        const bufferedGas = gasWithBuffer(gas);
        const estimatedCost = bufferedGas * gasPrice;

        if (balance < estimatedCost) {
          throw new Error(
            `Insufficient ${selectedNetwork.nativeCurrency.symbol} balance to deploy. Have ${formatNativeAmount(balance, selectedNetwork)}, estimated need ${formatNativeAmount(estimatedCost, selectedNetwork)}, short by ${formatNativeAmount(estimatedCost - balance, selectedNetwork)}.`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not estimate deployment gas.";
        throw new Error(
          getInsufficientFundsMessage(message, selectedNetwork) ?? message,
        );
      }

      setDeployStatus("Wallet confirmation requested...");
      const hash = normalizeTransactionHash(
        await walletClient.deployContract({
          abi: twoFactorAccountAbi,
          account: primaryAddress,
          bytecode: twoFactorAccountBytecode,
          args: deployArgs,
        }),
      );
      submittedHash = hash;
      setDeployTxHash(hash);
      setDeployStatus(
        "Transaction submitted. Waiting for one on-chain confirmation...",
      );

      const receipt = await waitForReceipt(hash);

      if (receipt.status !== "success") {
        throw new Error("Deployment transaction was mined but reverted.");
      }

      if (!receipt.contractAddress) {
        throw new Error(
          "Deployment receipt did not include a contract address.",
        );
      }

      setDeployStatus("Deployment confirmed.");
      storeContractAddress(receipt.contractAddress);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Deployment failed.";
      if (submittedHash) {
        setDeployError(
          `Deployment transaction was submitted, but the app could not finish reading the receipt from ${selectedNetwork.name}. Check the linked transaction; if it is confirmed, refresh and try again. Details: ${message}`,
        );
      } else {
        setDeployError(
          getInsufficientFundsMessage(message, selectedNetwork) ?? message,
        );
      }
    } finally {
      setIsDeploying(false);
    }
  }

  async function refreshContractBalance() {
    setFundError("");

    try {
      if (!contractAddress)
        throw new Error("Deploy a contract before checking its balance.");
      setIsCheckingBalance(true);
      const balance = await publicClient.getBalance({
        address: contractAddress,
      });
      setContractBalance(balance);
    } catch (error) {
      setFundError(
        error instanceof Error
          ? error.message
          : "Could not read contract balance.",
      );
    } finally {
      setIsCheckingBalance(false);
    }
  }

  async function handleFundContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFundError("");
    setFundStatus("");
    setFundTxHash(null);
    let submittedHash: Hex | null = null;

    try {
      if (!primaryAddress)
        throw new Error(
          "Connect the primary wallet before funding the contract.",
        );
      if (!contractAddress)
        throw new Error("Deploy a contract before funding it.");

      const formData = new FormData(event.currentTarget);
      const value = parseEther(getFormValue(formData, "fundAmount"));
      if (value <= 0n)
        throw new Error("Funding amount must be greater than zero.");

      const walletClient = getWalletClient();

      setIsFunding(true);
      await ensureWalletNetwork();
      setFundStatus("Checking gas estimate and wallet balance...");

      const [gas, gasPrice, balance] = await Promise.all([
        publicClient.estimateGas({
          account: primaryAddress,
          to: contractAddress,
          value,
        }),
        publicClient.getGasPrice(),
        publicClient.getBalance({ address: primaryAddress }),
      ]);
      const bufferedGas = gasWithBuffer(gas);
      const estimatedCost = value + bufferedGas * gasPrice;

      if (balance < estimatedCost) {
        throw new Error(
          `Insufficient ${selectedNetwork.nativeCurrency.symbol} balance to fund the contract. Have ${formatNativeAmount(balance, selectedNetwork)}, estimated need ${formatNativeAmount(estimatedCost, selectedNetwork)}, short by ${formatNativeAmount(estimatedCost - balance, selectedNetwork)}.`,
        );
      }

      setFundStatus("Wallet confirmation requested...");
      const hash = normalizeTransactionHash(
        await walletClient.sendTransaction({
          account: primaryAddress,
          to: contractAddress,
          value,
        }),
      );
      submittedHash = hash;
      setFundTxHash(hash);
      setFundStatus(
        "Funding transaction submitted. Waiting for one on-chain confirmation...",
      );

      const receipt = await waitForReceipt(hash);

      if (receipt.status !== "success") {
        throw new Error("Funding transaction was mined but reverted.");
      }

      setFundStatus("Funding confirmed.");
      await refreshContractBalance();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Funding failed.";
      if (submittedHash) {
        setFundError(
          `Funding transaction was submitted, but the app could not finish reading the receipt from ${selectedNetwork.name}. Check the linked transaction; if it is confirmed, refresh the balance. Details: ${message}`,
        );
      } else {
        setFundError(
          getInsufficientFundsMessage(message, selectedNetwork) ?? message,
        );
      }
    } finally {
      setIsFunding(false);
    }
  }

  async function handleSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignError("");
    setSignStatus("");
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const step = submitter?.value === "p256" ? "p256" : "wallet";

    try {
      if (!contractAddress)
        throw new Error("Deploy or set a contract address before signing.");
      const baseDraft = await buildSignatureDraft(formData);
      const reusableDraft = isSameIntent(signatureDraft, baseDraft)
        ? signatureDraft!
        : baseDraft;

      if (step === "wallet") {
        if (!primaryAddress)
          throw new Error(
            "Connect the primary owner wallet before signing with the wallet.",
          );
        const walletClient = getWalletClient();

        setIsSigningWallet(true);
        await ensureWalletNetwork();
        const signature = await signOwnerIntent(
          walletClient,
          primaryAddress,
          baseDraft.intentHash,
        );
        const { v, r, s } = splitAndNormalizeSecp256k1Signature(signature);
        storeSignatureDraft({
          ...reusableDraft,
          ...baseDraft,
          v,
          r,
          s,
        });
        return;
      }

      if (!credentialId)
        throw new Error("Register a hardware key before signing with P-256.");
      await requirePlatformWebAuthn();
      setIsSigningP256(true);
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: bytesToArrayBuffer(hexToBytes(baseDraft.intentHash)),
          allowCredentials: [
            {
              type: "public-key",
              id: bytesToArrayBuffer(base64urlToBytes(credentialId)),
            },
          ],
          userVerification: "required",
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!assertion) throw new Error("Hardware key signing was cancelled.");
      const assertionResponse =
        assertion.response as AuthenticatorAssertionResponse;
      const authenticatorData = new Uint8Array(
        assertionResponse.authenticatorData,
      );
      const clientDataJSON = new Uint8Array(assertionResponse.clientDataJSON);
      validateWebAuthnChallenge(clientDataJSON, baseDraft.intentHash);
      const webAuthnHash = buildWebAuthnHash(authenticatorData, clientDataJSON);
      const p256Signature = parseDERSignature(
        new Uint8Array(assertionResponse.signature),
      );
      storeSignatureDraft({
        ...reusableDraft,
        ...baseDraft,
        authenticatorData: toHex(authenticatorData),
        clientDataJSON: toHex(clientDataJSON),
        webAuthnHash,
        p256R: bytesToBytes32Hex(p256Signature.r, "P-256 signature r"),
        p256S: bytesToBytes32Hex(p256Signature.s, "P-256 signature s"),
      });
    } catch (error) {
      setSignError(error instanceof Error ? error.message : "Signing failed.");
    } finally {
      setIsSigningWallet(false);
      setIsSigningP256(false);
    }
  }

  async function handleRelay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRelayError("");
    setRelayTxHash(null);

    try {
      if (!secondaryAddress)
        throw new Error(
          "Connect the secondary relayer wallet before relaying.",
        );
      if (!pendingSignatures) throw new Error("No pending signatures found.");
      if (pendingSignatures.chainId !== selectedNetwork.chainId) {
        throw new Error(
          `Pending signatures were created for chainId ${pendingSignatures.chainId}. Select that network to relay.`,
        );
      }

      const walletClient = getWalletClient();
      const executeArgs = [
        pendingSignatures.target,
        hexToBigInt(pendingSignatures.value),
        pendingSignatures.data,
        pendingSignatures.v,
        pendingSignatures.r,
        pendingSignatures.s,
        pendingSignatures.authenticatorData,
        pendingSignatures.clientDataJSON,
        pendingSignatures.p256R,
        pendingSignatures.p256S,
      ] as const;

      setIsRelaying(true);
      await ensureWalletNetwork();
      const estimatedGas = await publicClient.estimateContractGas({
        account: secondaryAddress,
        address: pendingSignatures.contractAddress,
        abi: twoFactorAccountAbi,
        functionName: "execute",
        args: executeArgs,
      });
      const gas = gasWithBuffer(estimatedGas);
      const hash = normalizeTransactionHash(
        await walletClient.writeContract({
          account: secondaryAddress,
          address: pendingSignatures.contractAddress,
          abi: twoFactorAccountAbi,
          functionName: "execute",
          args: executeArgs,
          gas,
        }),
      );

      setRelayTxHash(hash);
      await waitForReceipt(hash);
      setRelayTxHash(hash);
    } catch (error) {
      setRelayError(error instanceof Error ? error.message : "Relay failed.");
    } finally {
      setIsRelaying(false);
    }
  }

  return (
    <main>
      <header className="app-header">
        <div className="header-top">
          <div>
            <p className="eyebrow">EIP-7951 demo</p>
            <h1>TwoFactorAccount</h1>
          </div>
          <label className="network-select">
            Network
            <select
              value={selectedChainId}
              onChange={(event) =>
                setSelectedChainId(Number(event.target.value))
              }
            >
              {NETWORKS.map((network) => (
                <option key={network.chainId} value={network.chainId}>
                  {network.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => connectWallet("primary")}>
            {primaryAddress
              ? `Primary: ${primaryAddress.slice(0, 6)}...${primaryAddress.slice(-4)}`
              : "Connect primary wallet"}
          </button>
          <button type="button" onClick={() => connectWallet("secondary")}>
            {secondaryAddress
              ? `Secondary: ${secondaryAddress.slice(0, 6)}...${secondaryAddress.slice(-4)}`
              : "Connect secondary wallet"}
          </button>
        </div>
      </header>

      {!selectedNetwork.supportsP256Precompile && (
        <section className="warning">
          <strong>P256VERIFY warning:</strong> this network may not support the
          precompile at 0x100. Ethereum mainnet and Berachain mainnet are
          configured as supported; testnets may fail during relay.
        </section>
      )}

      <section className="card">
        <div className="section-heading">
          <p className="eyebrow">Section 1</p>
          <h2>Deploy</h2>
        </div>
        {contractAddress ? (
          <div className="stack">
            <p>
              Stored contract:{" "}
              <a
                href={`${selectedNetwork.blockExplorerUrl}/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {contractAddress}
              </a>
            </p>
            {deployTxHash && (
              <p>
                Deployment tx:{" "}
                <ExplorerLink hash={deployTxHash} network={selectedNetwork} />
              </p>
            )}
            <CredentialStatus credentialId={credentialId} />
            {credentialId && (
              <p className="warning-note">
                Registering a new device changes the P-256 public key. This
                deployed contract still trusts the previous device key, so
                deploy a new contract after replacing the device.
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                onClick={handleRegisterHardwareKey}
                disabled={isRegistering}
              >
                {isRegistering
                  ? "Waiting for biometric prompt..."
                  : credentialId
                    ? "Register new device"
                    : "Register device"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearHardwareKey}
                disabled={!credentialId}
              >
                Delete stored device
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearContract}
              >
                Clear contract
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleDeploy} className="stack">
            <div className="callout">
              <h3>Register hardware key</h3>
              <p className="note">
                Register a platform authenticator with Touch ID, Face ID, or
                Windows Hello. The browser returns only the public P-256 key;
                the private key stays in the device authenticator.
              </p>
              <CredentialStatus credentialId={credentialId} />
              <div className="button-row">
                <button
                  type="button"
                  onClick={handleRegisterHardwareKey}
                  disabled={isRegistering}
                >
                  {isRegistering
                    ? "Waiting for biometric prompt..."
                    : credentialId
                      ? "Register new device"
                      : "Register device"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={clearHardwareKey}
                  disabled={!credentialId}
                >
                  Delete stored device
                </button>
              </div>
            </div>
            <label>
              P-256 Public Key X (hex, bytes32)
              <input
                name="p256x"
                value={hardwareKey?.p256x ?? ""}
                placeholder="Register hardware key first"
                readOnly
                required
              />
            </label>
            <label>
              P-256 Public Key Y (hex, bytes32)
              <input
                name="p256y"
                value={hardwareKey?.p256y ?? ""}
                placeholder="Register hardware key first"
                readOnly
                required
              />
            </label>
            <p className="note">
              Coordinates come from{" "}
              <code>credential.response.getPublicKey()</code>. The app parses
              the DER-encoded SubjectPublicKeyInfo and uses the final
              uncompressed P-256 point bytes for X and Y.
            </p>
            <button type="submit" disabled={isDeploying}>
              {isDeploying ? "Deploying..." : "Deploy TwoFactorAccount"}
            </button>
            {deployTxHash && (
              <p className="status">
                Deployment tx:{" "}
                <ExplorerLink hash={deployTxHash} network={selectedNetwork} />
              </p>
            )}
            {deployStatus && <p className="status">{deployStatus}</p>}
            {deployError && <p className="error">{deployError}</p>}
          </form>
        )}
      </section>

      {contractAddress && (
        <section className="card">
          <div className="section-heading">
            <p className="eyebrow">Section 2</p>
            <h2>Fund Contract</h2>
          </div>
          <div className="stack">
            <p>
              Contract address:{" "}
              <a
                href={`${selectedNetwork.blockExplorerUrl}/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {contractAddress}
              </a>
            </p>
            <p className="status">
              Balance:{" "}
              {contractBalance === null
                ? "Not checked yet"
                : formatNativeAmount(contractBalance, selectedNetwork)}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                onClick={refreshContractBalance}
                disabled={isCheckingBalance}
              >
                {isCheckingBalance
                  ? "Checking balance..."
                  : "Check contract balance"}
              </button>
            </div>
            <form onSubmit={handleFundContract} className="stack">
              <label>
                Amount to send ({selectedNetwork.nativeCurrency.symbol})
                <input
                  name="fundAmount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.01"
                  required
                />
              </label>
              <div className="button-row">
                <button type="submit" disabled={isFunding}>
                  {isFunding
                    ? "Sending..."
                    : `Send ${selectedNetwork.nativeCurrency.symbol} to contract`}
                </button>
              </div>
            </form>
            {fundTxHash && (
              <p className="status">
                Funding tx:{" "}
                <ExplorerLink hash={fundTxHash} network={selectedNetwork} />
              </p>
            )}
            {fundStatus && <p className="status">{fundStatus}</p>}
            {fundError && <p className="error">{fundError}</p>}
          </div>
        </section>
      )}

      {contractAddress && (
        <section className="card">
          <div className="section-heading">
            <p className="eyebrow">Section 3</p>
            <h2>Sign</h2>
          </div>
          <form onSubmit={handleSign} className="stack">
            <label>
              Target address
              <input name="target" placeholder="0x..." required />
            </label>
            <label>
              Amount in ETH
              <input
                name="amount"
                type="number"
                min="0"
                step="any"
                placeholder="0.01"
                required
              />
            </label>
            <label>
              Call data (optional, defaults to 0x)
              <input name="data" placeholder="0x" />
            </label>
            <p className="note">
              Use the two signing steps separately. Both signatures are bound to
              the same target, amount, call data, nonce, contract, and chain.
            </p>
            <div className="button-row">
              <button
                type="submit"
                name="signatureStep"
                value="wallet"
                disabled={isSigningWallet || isSigningP256}
              >
                {isSigningWallet
                  ? "Signing wallet..."
                  : "1. Sign with owner wallet"}
              </button>
              <button
                type="submit"
                name="signatureStep"
                value="p256"
                disabled={isSigningWallet || isSigningP256}
              >
                {isSigningP256
                  ? "Signing hardware key..."
                  : "2. Sign with hardware key"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearSignatures}
              >
                Clear signatures
              </button>
            </div>
            {signStatus && <p className="status">{signStatus}</p>}
            {signError && <p className="error">{signError}</p>}
          </form>
          {signatureDraft && !pendingSignatures && (
            <div className="stack signature-output">
              <h3>Signature draft</h3>
              <p className="note">
                Wallet signature:{" "}
                {signatureDraft.r && signatureDraft.s
                  ? "complete"
                  : "not complete"}{" "}
                · Hardware P-256 signature:{" "}
                {signatureDraft.p256R && signatureDraft.p256S
                  ? "complete"
                  : "not complete"}
              </p>
              <StoredValues values={signatureDraft} />
            </div>
          )}
          {pendingSignatures && (
            <div className="stack signature-output">
              <h3>Stored signature values</h3>
              <StoredValues values={pendingSignatures} />
            </div>
          )}
        </section>
      )}

      {pendingSignatures && (
        <section className="card">
          <div className="section-heading">
            <p className="eyebrow">Section 4</p>
            <h2>Relay</h2>
          </div>
          <StoredValues values={pendingSignatures} />
          <form onSubmit={handleRelay} className="stack">
            <div className="button-row">
              <button type="submit" disabled={isRelaying}>
                {isRelaying
                  ? "Relaying..."
                  : "Relay execute() with secondary wallet"}
              </button>
            </div>
            {relayError && <p className="error">{relayError}</p>}
          </form>
          {relayTxHash && (
            <div className="stack action-result">
              <p>
                Relay tx:{" "}
                <ExplorerLink hash={relayTxHash} network={selectedNetwork} />
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={clearContract}
                >
                  Clear and reset
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
