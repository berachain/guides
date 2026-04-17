import { useMemo, useState } from "react";
import {
  useAccount,
  useConnect,
  useConnectors,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  fetchPaymentRequirements,
  geocodeCity,
  geocodeUrl,
  payAndFetchWeather,
  weatherUrl,
  type GeocodingResult,
  type SettlementReceipt,
} from "./api";
import { activeChain } from "./config";
import { SequenceDiagram } from "./SequenceDiagram";
import { StepCard, type StepState } from "./StepCard";
import { usePaidFetch } from "./usePaidFetch";

export function WeatherForm() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const connectors = useConnectors();
  const { connect, isPending: isConnecting } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { isLoading: isWalletClientLoading } = useWalletClient();
  const paidFetch = usePaidFetch();

  const [city, setCity] = useState("San Francisco");

  const [step1, setStep1] = useState<StepState>({ kind: "idle" });
  const [geo, setGeo] = useState<GeocodingResult | null>(null);

  const [step2, setStep2] = useState<StepState>({ kind: "idle" });

  const [step3, setStep3] = useState<StepState>({ kind: "idle" });

  const metamask =
    connectors.find((c) => c.id === "io.metamask" || c.name === "MetaMask") ??
    connectors.find((c) => c.type === "injected");

  const wrongChain =
    isConnected &&
    walletChainId !== undefined &&
    walletChainId !== activeChain.id;
  const walletReady = Boolean(paidFetch) && !wrongChain;

  const geocodeEndpoint = useMemo(() => geocodeUrl(city || "..."), [city]);
  const weatherEndpoint = useMemo(
    () =>
      geo
        ? weatherUrl(geo.lat, geo.lon)
        : `${weatherUrl(0, 0).split("?")[0]}?lat=…&lon=…`,
    [geo],
  );

  // Resolve coordinates on-demand. If Step 1 has already populated `geo`, reuse
  // it. Otherwise geocode inline and also reflect the result in Step 1's card
  // so the user can see what was fetched.
  async function resolveGeo(): Promise<GeocodingResult | null> {
    if (geo) return geo;
    setStep1({ kind: "loading", note: "Resolving city to coordinates…" });
    try {
      const res = await geocodeCity(city);
      setGeo(res.body);
      setStep1({ kind: "success", status: res.status, body: res.body });
      return res.body;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStep1({ kind: "error", message });
      return null;
    }
  }

  async function runStep1() {
    setGeo(null);
    setStep2({ kind: "idle" });
    setStep3({ kind: "idle" });
    setStep1({ kind: "loading", note: "Fetching /geocode…" });
    try {
      const res = await geocodeCity(city);
      setGeo(res.body);
      setStep1({ kind: "success", status: res.status, body: res.body });
    } catch (err) {
      setStep1({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  async function runStep2() {
    setStep2({ kind: "loading", note: "Requesting /weather without payment…" });
    const coords = await resolveGeo();
    if (!coords) {
      setStep2({
        kind: "error",
        message: "Could not resolve city to coordinates.",
      });
      return;
    }
    try {
      const res = await fetchPaymentRequirements(coords.lat, coords.lon);
      if (res.status === 402) {
        setStep2({
          kind: "success",
          status: res.status,
          body: res.body,
        });
      } else {
        setStep2({
          kind: "error",
          message: `expected HTTP 402 but got ${res.status}`,
          status: res.status,
          body: res.body,
        });
      }
    } catch (err) {
      setStep2({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  async function runStep3() {
    if (!isConnected) {
      if (metamask) connect({ connector: metamask });
      return;
    }
    if (wrongChain || !paidFetch) {
      switchChain({ chainId: activeChain.id });
      return;
    }

    setStep3({ kind: "loading", note: "Resolving coordinates…" });
    const coords = await resolveGeo();
    if (!coords) {
      setStep3({
        kind: "error",
        message: "Could not resolve city to coordinates.",
      });
      return;
    }

    setStep3({
      kind: "loading",
      note: "Sign the HONEY authorization in MetaMask…",
    });
    try {
      const res = await payAndFetchWeather(paidFetch, coords.lat, coords.lon);
      setStep3({
        kind: "success",
        status: res.status,
        body: res.body as unknown,
        extra: res.receipt ? <ReceiptBlock receipt={res.receipt} /> : null,
      });
    } catch (err) {
      setStep3({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const step1Busy = step1.kind === "loading";
  const step2Busy = step2.kind === "loading";
  const step3Busy = step3.kind === "loading";
  const step3Button = getStep3ButtonState({
    isConnected,
    wrongChain,
    walletChainId,
    isConnecting,
    isSwitching,
    metamask: Boolean(metamask),
    paidFetch: Boolean(paidFetch),
    isWalletClientLoading,
    step3Busy,
    hasCity: Boolean(city.trim()),
  });

  return (
    <div className="stack">
      <details className="card seq-card">
        <summary>
          <span>How x402 payments work</span>
          <span className="seq-chevron" aria-hidden="true" />
        </summary>
        <SequenceDiagram />
      </details>

      <section className="card">
        <label className="label">
          City
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="San Francisco"
            required
            disabled={step1Busy}
          />
        </label>
        <p
          className="muted small"
          style={{ marginTop: "1.25rem", lineHeight: 1.6 }}
        >
          Enter a city, then walk through the three requests below to see what
          the free API, the x402 handshake, and the paid endpoint each return.
        </p>
      </section>

      <StepCard
        index={1}
        title="Free request"
        subtitle="Hit the open geocoding endpoint to resolve the city to lat/lon."
        endpoint={geocodeEndpoint}
        action={
          <button
            type="button"
            className="primary"
            onClick={runStep1}
            disabled={step1Busy || !city.trim()}
          >
            {step1Busy ? "Running…" : "Run free request"}
          </button>
        }
        state={step1}
      />

      <StepCard
        index={2}
        title="Fetch x402 payment requirements"
        subtitle="Call the paid endpoint with no X-PAYMENT header. The server responds 402 with the accepted payment options."
        endpoint={weatherEndpoint}
        action={
          <button
            type="button"
            className="primary"
            onClick={runStep2}
            disabled={step2Busy || !city.trim()}
          >
            {step2Busy ? "Requesting…" : "Fetch 402 requirements"}
          </button>
        }
        state={step2}
      />

      <StepCard
        index={3}
        title="Pay and fetch the forecast"
        subtitle="Sign an ERC-3009 authorization for HONEY, retry the request with X-PAYMENT, and receive the weather payload plus X-PAYMENT-RESPONSE receipt."
        endpoint={weatherEndpoint}
        action={
          <button
            type="button"
            className="primary"
            onClick={runStep3}
            disabled={step3Button.disabled}
          >
            {step3Button.label}
          </button>
        }
        state={step3}
      />

      {!walletReady && isConnected && (
        <p className="muted small">
          Wallet connected on chain id {walletChainId}. Target chain:{" "}
          {activeChain.name} ({activeChain.id}).
        </p>
      )}
    </div>
  );
}

function ReceiptBlock({ receipt }: { receipt: SettlementReceipt }) {
  return (
    <div className="receipt">
      <strong>X-PAYMENT-RESPONSE (decoded)</strong>
      <div>
        tx: <code>{receipt.transaction}</code>
      </div>
      <div>network: {receipt.network}</div>
      {receipt.payer && (
        <div>
          payer: <code>{receipt.payer}</code>
        </div>
      )}
      {receipt.amount && <div>amount: {receipt.amount}</div>}
    </div>
  );
}

function getStep3ButtonState(params: {
  isConnected: boolean;
  wrongChain: boolean;
  walletChainId: number | undefined;
  isConnecting: boolean;
  isSwitching: boolean;
  metamask: boolean;
  paidFetch: boolean;
  isWalletClientLoading: boolean;
  step3Busy: boolean;
  hasCity: boolean;
}): { label: string; disabled: boolean } {
  const {
    isConnected,
    wrongChain,
    walletChainId,
    isConnecting,
    isSwitching,
    metamask,
    paidFetch,
    isWalletClientLoading,
    step3Busy,
    hasCity,
  } = params;

  if (!hasCity) return { label: "Enter a city", disabled: true };
  if (step3Busy) return { label: "Waiting for payment…", disabled: true };

  if (!isConnected) {
    if (!metamask) return { label: "MetaMask not detected", disabled: true };
    if (isConnecting) return { label: "Connecting…", disabled: true };
    return { label: "Connect MetaMask", disabled: false };
  }

  if (isSwitching) return { label: "Switching chain…", disabled: true };

  if (wrongChain) {
    return { label: `Switch wallet to ${activeChain.name}`, disabled: false };
  }

  if (!paidFetch) {
    if (isWalletClientLoading || walletChainId === undefined) {
      return { label: "Preparing wallet…", disabled: true };
    }
    return { label: `Switch wallet to ${activeChain.name}`, disabled: false };
  }

  return { label: "Pay with HONEY & fetch", disabled: false };
}
