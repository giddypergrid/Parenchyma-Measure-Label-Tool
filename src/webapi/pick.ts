/**
 * File and folder dialogs in a browser tab.
 *
 * Chrome and Edge can hand back a real folder on disk (File System Access API).
 * Everything else falls back to a hidden <input type=file> for files, and to
 * origin-private storage for folders — the project then lives inside the
 * browser rather than in a folder the user can see.
 */

const canPickFolder = typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
const canPickFile = typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'

export const folderPickerAvailable = canPickFolder

export type PickKind = 'video' | 'image'

const ACCEPT: Record<PickKind, { description: string; ext: string[] }> = {
  video: { description: 'Video', ext: ['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'] },
  image: { description: 'Image', ext: ['.png', '.jpg', '.jpeg', '.bmp', '.webp'] },
}

/** Falls back to a throwaway <input>, which every browser supports. */
function inputFallback(kind: PickKind): Promise<File[]> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.multiple = true
    el.accept = ACCEPT[kind].ext.join(',')
    el.style.display = 'none'
    el.onchange = () => {
      resolve(Array.from(el.files ?? []))
      el.remove()
    }
    // a cancelled dialog fires no event in older browsers; the element just goes unused
    document.body.append(el)
    el.click()
  })
}

/**
 * Closing a dialog is an AbortError and means "nothing to do". Anything else is
 * a real failure and must reach the user — swallowing both made a blocked
 * picker look identical to a cancelled one.
 */
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

export async function pickFiles(kind: PickKind): Promise<File[]> {
  if (!canPickFile) return inputFallback(kind)
  const { description, ext } = ACCEPT[kind]
  try {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [{ description, accept: { [`${kind}/*`]: ext } }],
    })
    return Promise.all(handles.map((h) => h.getFile()))
  } catch (e) {
    if (cancelled(e)) return []
    throw e
  }
}

/** Origin-private storage, used when the browser cannot open a real folder. */
async function privateRoot() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('projects', { create: true })
}

/**
 * Where a new project folder should be created. Returns null if cancelled.
 * `visible` is false when the folder lives inside browser storage.
 */
export async function pickParentFolder() {
  if (!canPickFolder) return { handle: await privateRoot(), visible: false }
  try {
    return { handle: await showDirectoryPicker({ mode: 'readwrite' }), visible: true }
  } catch (e) {
    if (cancelled(e)) return null
    throw e
  }
}

/** An existing project folder to open. Returns null if cancelled or unsupported. */
export async function pickProjectFolder() {
  if (!canPickFolder) return null
  try {
    return await showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (cancelled(e)) return null
    throw e
  }
}

/**
 * A stored handle is only usable once the user re-grants access, and the grant
 * must come from a click — every caller here is behind one.
 */
export async function ensureAccess(handle: FileSystemDirectoryHandle) {
  // origin-private handles carry no permission API — nothing to grant
  if (typeof handle.queryPermission !== 'function') return true
  const opts = { mode: 'readwrite' } as const
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}
