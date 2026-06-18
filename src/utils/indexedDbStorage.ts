import type { MatchResult } from '../types/football';

const DB_NAME = 'mpp-worldcup-predictor-db';
const DB_VERSION = 1;
const STORE_NAME = 'matches';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Impossible d’ouvrir IndexedDB.'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveMatchesToIndexedDb(
  matches: MatchResult[]
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.put(matches, 'historicalMatches');

    transaction.oncomplete = () => resolve();

    transaction.onerror = () => {
      reject(new Error('Erreur pendant la sauvegarde IndexedDB.'));
    };
  });
}

export async function loadMatchesFromIndexedDb(): Promise<
  MatchResult[] | null
> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get('historicalMatches');

    request.onsuccess = () => {
      resolve((request.result as MatchResult[]) ?? null);
    };

    request.onerror = () => {
      reject(new Error('Erreur pendant le chargement IndexedDB.'));
    };
  });
}

export async function clearMatchesFromIndexedDb(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.delete('historicalMatches');

    transaction.oncomplete = () => resolve();

    transaction.onerror = () => {
      reject(new Error('Erreur pendant la suppression IndexedDB.'));
    };
  });
}
