/**
 * The parts of the File System Access API that TypeScript's DOM library still
 * ships without — the pickers and the persisted-permission calls.
 */

export {}

type FsaPermission = { mode?: 'read' | 'readwrite' }

type FilePickerAccept = { description?: string; accept: Record<string, string[]> }

declare global {
  interface FileSystemHandle {
    queryPermission(opts?: FsaPermission): Promise<PermissionState>
    requestPermission(opts?: FsaPermission): Promise<PermissionState>
  }

  function showDirectoryPicker(opts?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string | FileSystemHandle
  }): Promise<FileSystemDirectoryHandle>

  function showOpenFilePicker(opts?: {
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: FilePickerAccept[]
  }): Promise<FileSystemFileHandle[]>
}
