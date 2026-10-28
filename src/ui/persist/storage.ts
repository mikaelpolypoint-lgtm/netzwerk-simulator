// Automatisches Zwischenspeichern in IndexedDB. Es bleibt im Browserprofil
// der nutzenden Person; schlägt der Zugriff fehl (privates Fenster,
// file:// in manchen Browsern), läuft die App ohne Zwischenspeicher weiter.

const DB_NAME = 'netzwerk-simulator';
const STORE = 'projects';
const AUTOSAVE_KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveAutosave(text: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(text, AUTOSAVE_KEY));
  } catch {
    // Zwischenspeicher ist ein Komfort, kein Muss.
  }
}

export async function loadAutosave(): Promise<string | null> {
  try {
    const value = await withStore<unknown>('readonly', (store) => store.get(AUTOSAVE_KEY));
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
