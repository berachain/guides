type UnsupportedBannerProps = {
  className?: string;
};

export function UnsupportedBanner({ className }: UnsupportedBannerProps) {
  return (
    <div
      className={`rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-100 ${className ?? ""}`}
      role="status"
    >
      <p className="font-medium text-amber-200">
        Execution permissions API not available
      </p>
      <p className="mt-2 leading-relaxed text-amber-100/90">
        This wallet does not expose{" "}
        <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-xs text-amber-200">
          wallet_getSupportedExecutionPermissions
        </code>{" "}
        (JSON-RPC -32601 method not found). Install{" "}
        <a
          className="font-medium text-[#F5A623] underline decoration-amber-200/50 underline-offset-2 hover:text-[#FFB84D]"
          href="https://metamask.io/flask/"
          rel="noopener noreferrer"
          target="_blank"
        >
          MetaMask Flask
        </a>{" "}
        or a MetaMask build that supports ERC-7715 execution permissions.
      </p>
    </div>
  );
}
