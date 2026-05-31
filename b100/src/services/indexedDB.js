import { openDB } from 'idb';

const DB_NAME = 'FpgaFirmwareDB';
const DB_VERSION = 1;
const STORE_NAME = 'upgradeLogs';

let dbPromise = null;

export const initDB = async () => {
  if (dbPromise) return dbPromise;

  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    }
  });

  return dbPromise;
};

export const addLog = async (logData) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  await store.add({
    ...logData,
    timestamp: logData.timestamp || new Date().toISOString()
  });
  
  await tx.done;
};

export const getAllLogs = async () => {
  const db = await initDB();
  return await db.getAll(STORE_NAME);
};

export const getLogsByType = async (type) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index('type');
  
  return await index.getAll(type);
};

export const clearLogs = async () => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).clear();
  await tx.done;
};

export const deleteLog = async (id) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).delete(id);
  await tx.done;
};
