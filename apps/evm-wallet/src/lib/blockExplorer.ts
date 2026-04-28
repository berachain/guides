export function buildExplorerAddressUrl(explorerUrl: string, address: string): string {
  return `${stripTrailingSlash(explorerUrl)}/address/${address}`;
}

export function buildExplorerTxUrl(explorerUrl: string, txHash: string): string {
  return `${stripTrailingSlash(explorerUrl)}/tx/${txHash}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
