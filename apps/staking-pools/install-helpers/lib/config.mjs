import {
  BEPOLIA_VALIDATOR_ROOT,
  MAINNET_VALIDATOR_ROOT,
  RPC_DEFAULTS,
  STAKING_POOL_FACTORY_BEPOLIA,
  STAKING_POOL_FACTORY_MAINNET,
  DELEGATION_HANDLER_FACTORY_BEPOLIA,
  DELEGATION_HANDLER_FACTORY_MAINNET,
} from './constants.mjs';

export function resolveRpcUrl(network, env = process.env) {
  const override = env.EL_RPC_URL || env.RPC_URL;
  if (override && override.trim()) {
    return override.trim();
  }
  return RPC_DEFAULTS[network] ?? '';
}

export function resolveClApiUrl(env = process.env) {
  const raw = env.CL_NODE_API_URL || env.NODE_API_ADDRESS || '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(
      'CL node API URL is required. Set CL_NODE_API_URL or NODE_API_ADDRESS.',
    );
  }
  return normalizeApiBase(trimmed);
}

export function normalizeApiBase(raw) {
  let addr = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
  if (/^\d+$/.test(addr)) {
    addr = `127.0.0.1:${addr}`;
  } else if (!addr.includes(':')) {
    addr = `${addr}:3500`;
  }
  return `http://${addr}`;
}

export function getFactoryAddress(network) {
  if (network === 'mainnet') return STAKING_POOL_FACTORY_MAINNET;
  if (network === 'bepolia') return STAKING_POOL_FACTORY_BEPOLIA;
  return '';
}

export function getDelegationHandlerFactory(network) {
  if (network === 'mainnet') return DELEGATION_HANDLER_FACTORY_MAINNET;
  if (network === 'bepolia') return DELEGATION_HANDLER_FACTORY_BEPOLIA;
  return '';
}

export function networkFromValidatorRoot(root) {
  const normalized = root.trim().toLowerCase();
  if (normalized === MAINNET_VALIDATOR_ROOT.toLowerCase()) return 'mainnet';
  if (normalized === BEPOLIA_VALIDATOR_ROOT.toLowerCase()) return 'bepolia';
  return 'unknown';
}
