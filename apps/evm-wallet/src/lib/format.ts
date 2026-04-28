import { formatUnits } from 'viem';

export function truncateAddress(address: string, leading = 6, trailing = 4): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return `${address.slice(0, leading + 2)}...${address.slice(-trailing)}`;
}

export function formatBalance(value: bigint, decimals = 18): string {
  if (value === 0n) return '0';
  const raw = formatUnits(value, decimals);
  const [integerPart = '0', fractionalPart = ''] = raw.split('.');
  const groupedInteger = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Number(integerPart));
  // Truncate instead of round so the UI never displays more native currency
  // than the account actually holds.
  const truncatedFraction = fractionalPart.slice(0, 4).replace(/0+$/, '');
  const result =
    truncatedFraction.length > 0 ? `${groupedInteger}.${truncatedFraction}` : groupedInteger;
  return result === '0' ? '<0.0001' : result;
}

export function formatBalanceWithSymbol(value: bigint, symbol: string, decimals = 18): string {
  return `${formatBalance(value, decimals)} ${symbol}`;
}

export function redactRpcUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'RPC host';
  }
}

export type TxErrorKind =
  | 'user_canceled'
  | 'insufficient_funds'
  | 'network'
  | 'rpc'
  | 'nonce'
  | 'gas'
  | 'unknown';

export function categorizeTxError(err: Error): { kind: TxErrorKind; message: string } {
  const details = collectErrorDetails(err);
  const lower = details.toLowerCase();
  const message = redactUrls(details);

  if (lower.includes('user canceled') || lower.includes('user_canceled')) {
    return { kind: 'user_canceled', message: 'Authentication canceled.' };
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient balance')) {
    return {
      kind: 'insufficient_funds',
      message: 'Insufficient funds for amount plus network fee.',
    };
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('fetch failed')) {
    return { kind: 'network', message: 'Could not connect to the RPC.' };
  }
  if (
    lower.includes('nonce too low') ||
    lower.includes('nonce too high') ||
    lower.includes('nonce')
  ) {
    return { kind: 'nonce', message: 'Nonce conflict. Wait a moment and try again.' };
  }
  if (lower.includes('gas')) {
    return { kind: 'gas', message };
  }
  if (
    lower.includes('transactionexecutionerror') ||
    lower.includes('estimategasexecutionerror') ||
    lower.includes('json-rpc') ||
    lower.includes('rpc')
  ) {
    return { kind: 'rpc', message };
  }
  return { kind: 'unknown', message };
}

function collectErrorDetails(err: Error): string {
  const parts = [err.name, err.message];
  let cause: unknown = err.cause;
  while (cause !== undefined && cause !== null) {
    if (cause instanceof Error) {
      parts.push(cause.name, cause.message);
      cause = cause.cause;
    } else {
      parts.push(String(cause));
      break;
    }
  }
  return parts.filter(Boolean).join(': ');
}

function redactUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s)]+/g, (url) => redactRpcUrl(url));
}
