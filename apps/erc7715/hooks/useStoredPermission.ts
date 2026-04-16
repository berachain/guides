"use client";

import { useCallback, useEffect, useState } from "react";
import type { PermissionRequest, PermissionResponse } from "@/types/erc7715";

const STORAGE_KEY = "erc7715:grant";

export type StoredGrant = {
  submitted: PermissionRequest;
  response: PermissionResponse;
};

function readFromStorage(): StoredGrant | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.response === "object" &&
      parsed.response !== null &&
      typeof parsed.response.context === "string" &&
      typeof parsed.response.delegationManager === "string" &&
      Array.isArray(parsed.response.dependencies) &&
      typeof parsed.submitted === "object" &&
      parsed.submitted !== null
    ) {
      return parsed as StoredGrant;
    }
    return null;
  } catch {
    return null;
  }
}

function writeToStorage(grant: StoredGrant | null) {
  if (typeof window === "undefined") return;
  if (grant) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grant));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Persists a granted permission (submitted request + wallet response) in
 * localStorage so both the success card and redeem form survive page reloads.
 */
export function useStoredPermission() {
  const [grant, setGrantState] = useState<StoredGrant | null>(null);

  useEffect(() => {
    setGrantState(readFromStorage());
  }, []);

  const setGrant = useCallback((next: StoredGrant | null) => {
    setGrantState(next);
    writeToStorage(next);
  }, []);

  const clear = useCallback(() => {
    setGrantState(null);
    writeToStorage(null);
  }, []);

  return { grant, setGrant, clear } as const;
}
