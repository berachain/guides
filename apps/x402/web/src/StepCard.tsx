import { type ReactNode } from "react";

export type StepState =
  | { kind: "idle" }
  | { kind: "loading"; note?: string }
  | { kind: "success"; status: number; body: unknown; extra?: ReactNode }
  | { kind: "error"; message: string; status?: number; body?: unknown };

interface StepCardProps {
  index: number;
  title: string;
  subtitle?: string;
  endpoint: string;
  method?: "GET";
  action?: ReactNode;
  state: StepState;
}

export function StepCard({
  index,
  title,
  subtitle,
  endpoint,
  method = "GET",
  action,
  state,
}: StepCardProps) {
  return (
    <section className="step">
      <header className="step-header">
        <div className="step-num">Step {index}</div>
        <div>
          <h2 className="step-title">{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
      </header>

      <div className="step-endpoint">
        <span className="method">{method}</span>
        <code>{endpoint}</code>
      </div>

      {action && <div className="step-action">{action}</div>}

      <StepResult state={state} />
    </section>
  );
}

function StepResult({ state }: { state: StepState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <div className="step-result">
        <div className="step-status muted">
          <Spinner /> {state.note ?? "Loading…"}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="step-result">
        {state.status !== undefined && <StatusBadge status={state.status} />}
        <p className="error">{state.message}</p>
        {state.body !== undefined && state.body !== null && (
          <JsonBlock data={state.body} />
        )}
      </div>
    );
  }

  return (
    <div className="step-result">
      <StatusBadge status={state.status} />
      <JsonBlock data={state.body} />
      {state.extra}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  let variant: "ok" | "warn" | "err" = "ok";
  if (status >= 500) variant = "err";
  else if (status >= 400) variant = "warn";

  const label =
    status === 200
      ? "200 OK"
      : status === 402
        ? "402 Payment Required"
        : `${status}`;

  return <span className={`status-badge status-${variant}`}>{label}</span>;
}

function JsonBlock({ data }: { data: unknown }) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return <pre className="json">{text}</pre>;
}

function Spinner() {
  return <span className="spinner" aria-hidden />;
}
