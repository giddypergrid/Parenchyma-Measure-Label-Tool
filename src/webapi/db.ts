/**
 * Recent projects. A page cannot remember a filesystem path, so the directory
 * HANDLE itself is stored in IndexedDB — that is the only way to reopen a real
 * folder on a later visit without re-picking it. Structured clone keeps the
 * handle usable across sessions.
 */

export type WebProjectRecord = {
  token: string                        // the synthetic "dir" string the app carries around
  name: string
  lastOpened: string
  handle: FileSystemDirectoryHandle
  visible: boolean                     // false = kept in browser storage, not a folder on disk
}

const DB = 'parenchyma-measure'
const STORE = 'projects'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'token' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const allProjects = () => run<WebProjectRecord[]>('readonly', (s) => s.getAll())
export const getProject = (token: string) =>
  run<WebProjectRecord | undefined>('readonly', (s) => s.get(token))
export const putProject = (rec: WebProjectRecord) => run('readwrite', (s) => s.put(rec))
export const deleteProject = (token: string) => run('readwrite', (s) => s.delete(token))
