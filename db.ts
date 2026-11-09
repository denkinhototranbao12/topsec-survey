/** Lưu trữ bền vững bằng IndexedDB. Không dùng localStorage vì giới hạn 5 MB
 *  và lỗi ghi bị nuốt im lặng. Mọi lỗi ghi đều được ném ra cho UI hiển thị. */

const DB_NAME = 'topsec-survey';
const DB_VERSION = 1;

export type StoreName = 'projects' | 'points';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('points')) {
        const store = db.createObjectStore('points', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Không mở được cơ sở dữ liệu.'));
    req.onblocked = () => reject(new Error('Cơ sở dữ liệu đang bị khóa bởi tab khác.'));
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Lỗi truy cập dữ liệu.'));
        tx.onabort = () => reject(tx.error ?? new Error('Giao dịch bị hủy.'));
      }),
  );
}

export function loadAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export function putMany<T>(store: StoreName, items: T[]): Promise<void> {
  if (!items.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const item of items) os.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Ghi dữ liệu thất bại.'));
        tx.onabort = () => reject(tx.error ?? new Error('Ghi dữ liệu bị hủy (có thể do hết dung lượng).'));
      }),
  );
}

export function removeMany(store: StoreName, ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const id of ids) os.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Xóa dữ liệu thất bại.'));
      }),
  );
}

export function clearStore(store: StoreName): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>).then(() => undefined);
}

/** Dung lượng đã dùng / hạn mức của trình duyệt (nếu hỗ trợ). */
export async function usage(): Promise<{ used: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { used: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Yêu cầu trình duyệt không tự xóa dữ liệu khi máy hết chỗ. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
