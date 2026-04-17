import { ConnectBar } from "./ConnectBar";
import { WeatherForm } from "./WeatherForm";
import { activeChain } from "./config";

export function App() {
  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1>weather-x402</h1>
          <p className="muted">
            Pay <strong>HONEY</strong> on <strong>{activeChain.name}</strong> to
            fetch a US weather forecast via the x402 protocol.
          </p>
        </div>
        <ConnectBar />
      </header>

      <main>
        <WeatherForm />
      </main>
    </div>
  );
}
