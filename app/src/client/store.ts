import type { PendingMetrics, QuestionMarks, SessionRecord, Store } from "../engine/types";

const DB = "bottom-line";
const SESSIONS = "sessions";
/** The learner's marks on Question bank entries: { id, seen?, struck? }. Kept apart from Sessions, so deleting history doesn't bring seen questions back. */
const QUESTIONS = "questions";
/** Answer audio kept for a transcription retry (PendingMetrics), by Session id. Deleted with its Session. */
const PENDING = "pendingMetrics";

interface QuestionMarkRecord { id: string; seen?: boolean; struck?: boolean }
/** Where ticket 02–04 builds kept Sessions; moved into IndexedDB once. */
const LEGACY_KEY = "bl.sessions";

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(SESSIONS)) req.result.createObjectStore(SESSIONS, { keyPath: "id" });
      if (!names.contains(QUESTIONS)) req.result.createObjectStore(QUESTIONS, { keyPath: "id" });
      if (!names.contains(PENDING)) req.result.createObjectStore(PENDING, { keyPath: "sessionId" });
    };
    req.onsuccess = () => {
      // A newer build in another tab may need to upgrade the database: let it.
      req.result.onversionchange = () => { req.result.close(); db = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  }).then(migrate);
  db.catch(() => { db = null; });
  return db;
}

/** Runs one request in its own transaction and resolves once the transaction has committed. */
async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>, name = SESSIONS): Promise<T> {
  const tx = (await open()).transaction(name, mode);
  const req = op(tx.objectStore(name));
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  });
}

/** Changes the Sessions and their kept audio together. */
async function inOne(op: (store: (name: string) => IDBObjectStore) => unknown) {
  const tx = (await open()).transaction([SESSIONS, PENDING], "readwrite");
  op((name) => tx.objectStore(name));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

async function migrate(d: IDBDatabase): Promise<IDBDatabase> {
  let legacy: SessionRecord[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
  } catch { /* nothing to move */ }
  if (!legacy.length) return d;
  const tx = d.transaction(SESSIONS, "readwrite");
  legacy.forEach((r) => tx.objectStore(SESSIONS).put(r));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* moved again next time; the puts are keyed, so that's harmless */ }
  return d;
}

/** Sessions saved on this device, in IndexedDB. If it's unavailable (some private modes), nothing persists. */
export const idbStore: Store = {
  async loadSessions() {
    const all = await run("readonly", (s) => s.getAll() as IDBRequest<SessionRecord[]>);
    return all.sort((a, b) => a.startedAt - b.startedAt);
  },
  async saveSession(record) {
    await run("readwrite", (s) => s.put(record));
  },
  async replaceSession(record) {
    const tx = (await open()).transaction(SESSIONS, "readwrite");
    const store = tx.objectStore(SESSIONS);
    const get = store.getKey(record.id);
    get.onsuccess = () => { if (get.result !== undefined) store.put(record); };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },
  async deleteSession(id) {
    await inOne((s) => [s(SESSIONS).delete(id), s(PENDING).delete(id)]);
  },
  async deleteAllSessions() {
    await inOne((s) => [s(SESSIONS).clear(), s(PENDING).clear()]);
  },
  async loadPendingMetrics() {
    return run("readonly", (s) => s.getAll() as IDBRequest<PendingMetrics[]>, PENDING);
  },
  async savePendingMetrics(pending) {
    await run("readwrite", (s) => s.put(pending), PENDING);
  },
  async deletePendingMetrics(sessionId) {
    await run("readwrite", (s) => s.delete(sessionId), PENDING);
  },
  async loadQuestionMarks(): Promise<QuestionMarks> {
    const all = await run("readonly", (s) => s.getAll() as IDBRequest<QuestionMarkRecord[]>, QUESTIONS);
    return { seen: all.filter((r) => r.seen).map((r) => r.id), struck: all.filter((r) => r.struck).map((r) => r.id) };
  },
  async markSeen(id) {
    await updateMark(id, { seen: true });
  },
  async setStruck(id, struck) {
    await updateMark(id, { struck });
  },
};

/** Reads and rewrites one question's marks in a single transaction. */
async function updateMark(id: string, patch: Partial<QuestionMarkRecord>) {
  const tx = (await open()).transaction(QUESTIONS, "readwrite");
  const store = tx.objectStore(QUESTIONS);
  const get = store.get(id) as IDBRequest<QuestionMarkRecord | undefined>;
  get.onsuccess = () => store.put({ ...(get.result ?? { id }), ...patch });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
