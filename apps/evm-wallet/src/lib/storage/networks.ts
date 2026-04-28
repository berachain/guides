import type { Network, NetworksState } from '../types';
import { storage } from './mmkv';

const NETWORKS_KEY = 'networks_state';
const NETWORKS_SCHEMA_VERSION = 1;

const EMPTY_NETWORKS_STATE: NetworksState = {
  schemaVersion: NETWORKS_SCHEMA_VERSION,
  networks: [],
  activeNetworkId: null,
};

function isNetwork(value: unknown): value is Network {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.rpcUrl === 'string' &&
    typeof v.chainId === 'number' &&
    Number.isInteger(v.chainId) &&
    v.chainId > 0 &&
    typeof v.currencySymbol === 'string' &&
    (typeof v.blockExplorerUrl === 'undefined' || typeof v.blockExplorerUrl === 'string') &&
    typeof v.addedAt === 'number'
  );
}

export function readNetworksState(): NetworksState {
  const raw = storage.getString(NETWORKS_KEY);
  if (typeof raw !== 'string' || raw.length === 0) return EMPTY_NETWORKS_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return EMPTY_NETWORKS_STATE;
    const value = parsed as Record<string, unknown>;
    if (value.schemaVersion !== NETWORKS_SCHEMA_VERSION || !Array.isArray(value.networks)) {
      return EMPTY_NETWORKS_STATE;
    }

    const networks = value.networks.filter((network, idx): network is Network => {
      const valid = isNetwork(network);
      if (!valid) console.warn(`readNetworksState: dropped invalid network entry at index ${idx}`);
      return valid;
    });
    const activeNetworkId =
      typeof value.activeNetworkId === 'string' ? value.activeNetworkId : null;
    if (activeNetworkId !== null && networks.some((network) => network.id === activeNetworkId)) {
      return { schemaVersion: NETWORKS_SCHEMA_VERSION, networks, activeNetworkId };
    }
    if (activeNetworkId !== null) {
      console.warn('readNetworksState: active network id was missing from network list');
    }
    return {
      schemaVersion: NETWORKS_SCHEMA_VERSION,
      networks,
      activeNetworkId: networks[0]?.id ?? null,
    };
  } catch {
    return EMPTY_NETWORKS_STATE;
  }
}

export function writeNetworksState(state: NetworksState): void {
  storage.set(NETWORKS_KEY, JSON.stringify(state));
}

export function clearNetworksState(): void {
  storage.set(NETWORKS_KEY, '');
}
