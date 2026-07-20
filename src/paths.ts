/**
 * Paths inside project.json are stored RELATIVE to the project folder, so the
 * whole folder can be moved, copied or opened on another machine and still work.
 * Absolute paths only ever exist at the IPC boundary.
 */

const isAbsolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
const trimEnd = (d: string) => d.replace(/[\\/]+$/, '')

/** project-relative -> absolute, for handing to the main process */
export function abs(dir: string, rel?: string): string | undefined {
  if (!rel) return undefined
  if (isAbsolute(rel)) return rel // legacy value that lives outside the project
  return `${trimEnd(dir)}\\${rel.replace(/^[\\/]+/, '')}`
}

/**
 * Timepoint and project names become folder names, so strip anything Windows
 * rejects (\ / : * ? " < > |) and trailing dots/spaces, which silently fail.
 */
export function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim()
  return (cleaned || 'unnamed').slice(0, 80)
}

/** absolute -> project-relative, before storing in project.json */
export function rel(dir: string, p: string): string {
  const d = trimEnd(dir)
  if (p.toLowerCase().startsWith(d.toLowerCase())) {
    return p.slice(d.length).replace(/^[\\/]+/, '')
  }
  return p
}
