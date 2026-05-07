import { formatEther, formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import type { TokenWithBalance } from "../types/token";
import { useSwapStore } from "../store/swapStore";

interface TokenRowProps {
  token: TokenWithBalance;
}

export const TokenRow = ({ token }: TokenRowProps) => {
  const addr = token.address.toLowerCase() as string;
  const selectedTokens = useSwapStore((s) => s.selectedTokens);
  const amountByToken = useSwapStore((s) => s.amountByToken);
  const quotes = useSwapStore((s) => s.quotes);
  const toggleTokenSelected = useSwapStore((s) => s.toggleTokenSelected);
  const setTokenAmount = useSwapStore((s) => s.setTokenAmount);

  const selected = selectedTokens.has(addr);
  const amountWei = amountByToken[addr] ?? "";
  const quote = quotes[addr];
  const disabledRow = quote?.status === "no_route" || quote?.status === "error";

  const onToggle = (checked: boolean) => {
    toggleTokenSelected(token.address as Address, checked);
    if (checked) {
      setTokenAmount(token.address as Address, token.balance.toString());
    }
  };

  const onAmountChange = (raw: string) => {
    if (raw === "" || raw === ".") {
      setTokenAmount(token.address as Address, "");
      return;
    }
    try {
      const wei = parseUnits(raw, token.decimals);
      if (wei > token.balance) {
        setTokenAmount(token.address as Address, token.balance.toString());
        return;
      }
      setTokenAmount(token.address as Address, wei.toString());
    } catch {
      /* ignore partial input */
    }
  };

  let displayAmount = "";
  if (amountWei !== "") {
    try {
      displayAmount = formatUnits(BigInt(amountWei), token.decimals);
    } catch {
      displayAmount = "";
    }
  }

  const beraOut =
    quote?.status === "ok" && quote.amountOutWei
      ? formatEther(BigInt(quote.amountOutWei))
      : null;

  return (
    <div
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border px-4 py-3 transition ${
        disabledRow && selected
          ? "border-red-500/40 bg-red-500/5 opacity-80"
          : "border-zinc-700 bg-zinc-800/40"
      }`}
    >
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-500 bg-zinc-900 text-amber-500 focus:ring-amber-500"
        />
        <img
          src={token.logoUri}
          alt=""
          className="h-10 w-10 rounded-full border border-zinc-600"
          loading="lazy"
        />
      </label>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold text-zinc-100">{token.symbol}</span>
          <span className="text-xs text-zinc-500">{token.name}</span>
        </div>
        <p className="truncate text-xs text-zinc-500">
          Balance {token.formattedBalance} ·{" "}
          {token.usdValue > 0 ? `$${token.usdValue.toFixed(2)}` : "— USD"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            disabled={!selected || disabledRow}
            value={selected ? displayAmount : ""}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="0.0"
            className="w-36 rounded-lg border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-40"
          />
          <button
            type="button"
            disabled={!selected || disabledRow}
            onClick={() =>
              setTokenAmount(token.address as Address, token.balance.toString())
            }
            className="text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-40"
          >
            Max
          </button>
        </div>
      </div>

      <div className="text-right text-sm">
        {quote?.status === "loading" ? (
          <div className="space-y-1">
            <div className="ml-auto h-3 w-24 animate-pulse rounded bg-zinc-700" />
            <div className="ml-auto h-3 w-16 animate-pulse rounded bg-zinc-700" />
          </div>
        ) : null}
        {quote?.status === "ok" && beraOut ? (
          <div>
            <p className="font-medium text-emerald-400">~{beraOut} BERA</p>
            <p className="text-xs text-zinc-500">via Kyber</p>
          </div>
        ) : null}
        {quote?.status === "no_route" ? (
          <p className="text-yellow-400">No route found</p>
        ) : null}
        {quote?.status === "error" ? (
          <p className="max-w-[140px] text-right text-xs text-red-400">
            {quote.errorMessage ?? "Error"}
          </p>
        ) : null}
      </div>
    </div>
  );
};
