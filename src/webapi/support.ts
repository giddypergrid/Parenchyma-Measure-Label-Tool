/**
 * What the current environment can and cannot do, so the screens can say so up
 * front instead of failing at the moment the user clicks something.
 */

let browser = false

/** Set once at start-up, when Electron turned out not to have injected its api. */
export const markBrowser = () => { browser = true }

export const isBrowser = () => browser

/**
 * Splitting a clip in the browser is slow enough that the screen must say how
 * far it has got. The desktop app never calls this — ffmpeg returns in one step.
 */
let progress: (text: string) => void = () => {}

export const onImportProgress = (fn: (text: string) => void) => { progress = fn }
export const reportProgress = (text: string) => progress(text)

const hasFolderPicker = () =>
  typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

/** Null in the desktop app, where none of this applies. */
export function browserNotice(): string | null {
  if (!browser) return null
  if (hasFolderPicker()) {
    return 'Running in a browser. A project is saved into a folder you choose, the same as the ' +
      'desktop app. Clips are split by the browser itself, so MP4 works and AVI does not — ' +
      'import those in the desktop app. Still images work either way.'
  }
  return 'Running in a browser that cannot open folders on your computer, so projects are kept ' +
    'inside this browser instead. Chrome or Edge can use a real folder.'
}
