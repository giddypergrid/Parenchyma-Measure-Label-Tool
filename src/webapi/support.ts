/**
 * What this browser can and cannot do, so the screens can say so up front
 * instead of failing at the moment the user clicks something.
 */

/**
 * Splitting a clip is slow enough that the screen must say how far it has got.
 */
let progress: (text: string) => void = () => {}

export const onImportProgress = (fn: (text: string) => void) => { progress = fn }
export const reportProgress = (text: string) => progress(text)

const hasFolderPicker = () =>
  typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

/** Null when everything works — no notice worth showing. */
export function browserNotice(): string | null {
  if (hasFolderPicker()) return null
  return 'This browser cannot open a folder on your computer, so projects will be kept inside ' +
    'the browser instead and are lost if you clear its data. Use Chrome or Edge to work in a ' +
    'real folder.'
}
