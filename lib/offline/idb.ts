/**
 * A thin promise layer over IndexedDB, and nothing else (MOB-09 §19).
 *
 * The offline database needs indexed stores, transactions and explicit schema
 * versions; it does not need a framework. Everything above this file talks in
 * stores and records.
 */

export type Upgrade = (database: IDBDatabase, transaction: IDBTransaction, oldVersion: number) => void;

export function openDatabase(name: string, version: number, upgrade: Upgrade, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (transaction) upgrade(request.result, transaction, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
  });
}

export function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error("IndexedDB request failed."));
  });
}

/** Resolves when the transaction has committed — not when its last request succeeded. */
export function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return Promise.resolve(false);
  return navigator.storage.persist().catch(() => false);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
