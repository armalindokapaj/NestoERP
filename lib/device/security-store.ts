"use client";

import * as React from "react";

import type { DeviceSecurityState } from "./security-types";

/**
 * The latest security state the server gave this app (MOB-11 §80, §127), for
 * components that need to know — the lock, the sensitive-surface guard, the
 * device card. One module-level value, no network: reading it is free, which is
 * what keeps policy out of every route transition (§176).
 */
let current: DeviceSecurityState | null = null;
const listeners = new Set<() => void>();

export function setSecurityState(next: DeviceSecurityState | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export const getSecurityState = (): DeviceSecurityState | null => current;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDeviceSecurity(): DeviceSecurityState | null {
  return React.useSyncExternalStore(subscribe, getSecurityState, () => null);
}
