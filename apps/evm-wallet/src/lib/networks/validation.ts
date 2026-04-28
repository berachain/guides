export interface NetworkInput {
  name: string;
  rpcUrl: string;
  chainId: string;
  currencySymbol: string;
  blockExplorerUrl: string;
}

export interface NetworkValidationResult {
  valid: boolean;
  errors: { [K in keyof NetworkInput]?: string };
  warnings: { [K in keyof NetworkInput]?: string };
}

function validateUrl(value: string, label: string): { error?: string; warning?: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${label} is required` };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: `${label} must be an HTTP or HTTPS URL` };
    }
    if (url.protocol === 'http:') {
      return { warning: 'HTTP URLs are not encrypted. Prefer HTTPS when available.' };
    }
    return {};
  } catch {
    return { error: `${label} must be a valid URL` };
  }
}

export function validateNetworkInput(input: NetworkInput): NetworkValidationResult {
  const errors: NetworkValidationResult['errors'] = {};
  const warnings: NetworkValidationResult['warnings'] = {};

  const name = input.name.trim();
  if (name.length === 0) errors.name = 'Network name is required';
  else if (name.length > 32) errors.name = 'Network name must be 32 characters or fewer';

  const rpc = validateUrl(input.rpcUrl, 'RPC URL');
  if (rpc.error) errors.rpcUrl = rpc.error;
  else if (rpc.warning) warnings.rpcUrl = rpc.warning;

  const chainId = input.chainId.trim();
  if (chainId.length === 0) {
    errors.chainId = 'Chain ID is required';
  } else if (!/^[0-9]+$/.test(chainId)) {
    errors.chainId = 'Chain ID must be a positive integer';
  } else if (chainId.length > 1 && chainId.startsWith('0')) {
    errors.chainId = 'Chain ID cannot have leading zeroes';
  } else {
    const n = Number(chainId);
    if (!Number.isInteger(n) || n <= 0 || n >= Number.MAX_SAFE_INTEGER) {
      errors.chainId = 'Chain ID must be a positive safe integer';
    }
  }

  const symbol = input.currencySymbol.trim();
  if (symbol.length === 0) errors.currencySymbol = 'Currency symbol is required';
  else if (!/^[A-Z]{2,6}$/.test(symbol)) {
    errors.currencySymbol = 'Use 2-6 uppercase letters';
  }

  const explorer = input.blockExplorerUrl.trim();
  if (explorer.length > 0) {
    const result = validateUrl(explorer, 'Block explorer URL');
    if (result.error) errors.blockExplorerUrl = result.error;
    else if (result.warning) warnings.blockExplorerUrl = result.warning;
  }

  return { valid: Object.keys(errors).length === 0, errors, warnings };
}
