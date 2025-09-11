// ExtraData decoder interface (reuse your JS logic but we only need type + version strings here)
export function classifyClient(clientString: string): {
  type: string;
  version: string;
  full: string;
} {
  const lower = (clientString || "").toLowerCase();
  let type = "Unknown";
  if (lower.includes("reth")) type = "Reth";
  else if (lower.includes("geth")) type = "Geth";
  else if (lower.includes("erigon")) type = "Erigon";
  else if (lower.includes("nethermind")) type = "Nethermind";
  else if (lower.includes("besu")) type = "Besu";
  const m = clientString.match(/v?(\d+\.\d+\.\d+)/);
  const version = m ? m[1] : "unknown";
  return { type, version, full: clientString };
}

export function decodeExtraDataAscii(
  extraDataHex: string | null | undefined,
): string {
  if (!extraDataHex || extraDataHex === "0x") return "";
  const hex = extraDataHex.startsWith("0x")
    ? extraDataHex.slice(2)
    : extraDataHex;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    const ascii = String.fromCharCode(...bytes);
    const clean = ascii.replace(/[\x00-\x1F\x7F]/g, "").trim();
    return clean;
  } catch {
    return "";
  }
}
