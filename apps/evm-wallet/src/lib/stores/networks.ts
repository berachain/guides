import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { clearNetworksState, readNetworksState, writeNetworksState } from '../storage/networks';
import type { Network, NetworksState } from '../types';

type NetworkInput = Omit<Network, 'id' | 'addedAt'>;

interface NetworksStore {
  networks: Network[];
  activeNetworkId: string | null;
  hydrated: boolean;
  hydrate: () => void;
  addNetwork: (input: NetworkInput) => Network;
  updateNetwork: (id: string, input: Partial<NetworkInput>) => void;
  deleteNetwork: (id: string) => void;
  setActiveNetwork: (id: string) => void;
  resetAll: () => void;
}

const EMPTY_STATE: NetworksState = {
  schemaVersion: 1,
  networks: [],
  activeNetworkId: null,
};

function persist(networks: Network[], activeNetworkId: string | null): void {
  writeNetworksState({ schemaVersion: 1, networks, activeNetworkId });
}

export const useNetworksStore = create<NetworksStore>((set, get) => ({
  networks: [],
  activeNetworkId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const state = readNetworksState();
    set({ networks: state.networks, activeNetworkId: state.activeNetworkId, hydrated: true });
  },

  addNetwork: (input) => {
    const network: Network = {
      ...input,
      id: Crypto.randomUUID(),
      addedAt: Date.now(),
      blockExplorerUrl: input.blockExplorerUrl?.trim() || undefined,
    };
    const networks = [...get().networks, network];
    const activeNetworkId = get().activeNetworkId ?? network.id;
    persist(networks, activeNetworkId);
    set({ networks, activeNetworkId });
    return network;
  },

  updateNetwork: (id, input) => {
    let found = false;
    const networks = get().networks.map((network) => {
      if (network.id !== id) return network;
      found = true;
      return {
        ...network,
        ...input,
        blockExplorerUrl: input.blockExplorerUrl?.trim() || undefined,
      };
    });
    if (!found) throw new Error(`Unknown network ${id}`);
    persist(networks, get().activeNetworkId);
    set({ networks });
  },

  deleteNetwork: (id) => {
    const existing = get().networks;
    if (!existing.some((network) => network.id === id)) throw new Error(`Unknown network ${id}`);
    const networks = existing.filter((network) => network.id !== id);
    const activeNetworkId =
      get().activeNetworkId === id ? (networks[0]?.id ?? null) : get().activeNetworkId;
    persist(networks, activeNetworkId);
    set({ networks, activeNetworkId });
  },

  setActiveNetwork: (id) => {
    if (!get().networks.some((network) => network.id === id)) {
      throw new Error(`Unknown network ${id}`);
    }
    persist(get().networks, id);
    set({ activeNetworkId: id });
  },

  resetAll: () => {
    clearNetworksState();
    set({ networks: EMPTY_STATE.networks, activeNetworkId: EMPTY_STATE.activeNetworkId });
  },
}));

export function getActiveNetwork(
  networks: Network[],
  activeNetworkId: string | null,
): Network | null {
  return networks.find((network) => network.id === activeNetworkId) ?? null;
}
