/**
 * A tiny path layer over the File System Access API.
 *
 * The rest of the app speaks Windows-style strings ("<dir>\Week 1\clip\frame.png").
 * A page never learns a real filesystem path, so a project folder is registered
 * under a synthetic token and every path is resolved by walking directory
 * handles from that token.
 */

const roots = new Map<string, FileSystemDirectoryHandle>()

/** Files chosen in a file dialog: no real path exists, so they get a pseudo one. */
const picked = new Map<string, File>()
let pickSeq = 0

export const PICK_PREFIX = 'picked:\\'

export function registerRoot(token: string, handle: FileSystemDirectoryHandle) {
  roots.set(token, handle)
}

export function rootOf(token: string) {
  return roots.get(token)
}

/** Turn a chosen File into something the import handlers can take as a "path". */
export function registerPick(file: File) {
  const path = `${PICK_PREFIX}${pickSeq++}\\${file.name}`
  picked.set(path, file)
  return path
}

export function pickedFile(path: string) {
  return picked.get(path)
}

/** Free the token so a name can be reused after the project is forgotten. */
export function forgetRoot(token: string) {
  roots.delete(token)
}

/** A token unique among the ones already registered, derived from the folder name. */
export function claimToken(name: string) {
  const base = `browser:\\${name}`
  let token = base
  for (let n = 2; roots.has(token); n++) token = `${base} (${n})`
  return token
}

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean)

type Located = { root: FileSystemDirectoryHandle; segments: string[] }

/** Longest registered token wins, so nested project folders can't be confused. */
function locate(fullPath: string): Located {
  let best = ''
  for (const token of roots.keys()) {
    if (fullPath === token || fullPath.startsWith(token + '\\') || fullPath.startsWith(token + '/')) {
      if (token.length > best.length) best = token
    }
  }
  if (!best) throw new Error(`not inside an open project: ${fullPath}`)
  return { root: roots.get(best)!, segments: parts(fullPath.slice(best.length)) }
}

async function walk(root: FileSystemDirectoryHandle, segments: string[], create: boolean) {
  let dir = root
  for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create })
  return dir
}

/** Directory handle for a full path. `create` mirrors mkdir -p. */
export async function dirHandle(fullPath: string, create = false) {
  const { root, segments } = locate(fullPath)
  return walk(root, segments, create)
}

/** [parent directory, filename] for a full path. */
export async function fileParent(fullPath: string, create = false) {
  const { root, segments } = locate(fullPath)
  const name = segments.pop()
  if (!name) throw new Error(`not a file path: ${fullPath}`)
  return [await walk(root, segments, create), name] as const
}

export async function readFile(fullPath: string) {
  const [dir, name] = await fileParent(fullPath)
  return (await dir.getFileHandle(name)).getFile()
}

export async function readText(fullPath: string) {
  return (await readFile(fullPath)).text()
}

/**
 * Writes run one at a time. project.json is rewritten on every edit and the app
 * does not await those saves, so two overlapping createWritable streams on the
 * same file could otherwise interleave and leave it truncated or invalid.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

export function writeFile(fullPath: string, data: BlobPart) {
  const run = writeQueue.then(async () => {
    const [dir, name] = await fileParent(fullPath, true)
    const handle = await dir.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    await w.write(data)
    await w.close()
    return fullPath
  })
  // a failed write must not wedge every later one
  writeQueue = run.catch(() => {})
  return run
}

export async function exists(fullPath: string) {
  try {
    await readFile(fullPath)
    return true
  } catch {
    return false
  }
}

const IMAGE = /\.(png|jpe?g|bmp|webp)$/i

export async function listImages(fullPath: string) {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await dirHandle(fullPath)
  } catch {
    return []
  }
  const names: string[] = []
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && IMAGE.test(name)) names.push(name)
  }
  return names.sort().map((n) => `${fullPath}\\${n}`)
}

export async function listSubdirs(fullPath: string) {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await dirHandle(fullPath)
  } catch {
    return []
  }
  const names: string[] = []
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'directory') names.push(name)
  }
  return names
}

export async function removeDir(fullPath: string) {
  const [parent, name] = await fileParent(fullPath)
  await parent.removeEntry(name, { recursive: true })
  dropUrl(fullPath)
}

export async function removeFile(fullPath: string) {
  const [parent, name] = await fileParent(fullPath)
  await parent.removeEntry(name)
  dropUrl(fullPath)
}

/**
 * Object URLs, cached per path — a clip can be hundreds of stills and base64
 * data URIs at that count are what make the browser build feel broken.
 */
const urls = new Map<string, string>()

export async function objectUrl(fullPath: string) {
  const hit = urls.get(fullPath)
  if (hit) return hit
  const url = URL.createObjectURL(await readFile(fullPath))
  urls.set(fullPath, url)
  return url
}

export function dropUrl(fullPath: string) {
  const url = urls.get(fullPath)
  if (!url) return
  URL.revokeObjectURL(url)
  urls.delete(fullPath)
}
