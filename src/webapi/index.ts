/**
 * The browser build of `window.api`.
 *
 * Electron injects `window.api` from its preload script. In a plain browser tab
 * nothing injects it, which is why the web version could not open files at all.
 * This module implements the same surface on top of the File System Access API,
 * so every screen runs unchanged in a tab.
 *
 * Differences from the desktop app, all of them deliberate:
 *  - a folder can only be opened in Chrome or Edge; elsewhere projects are kept
 *    in origin-private browser storage instead
 *  - clips are split by the browser's own video decoder, not ffmpeg, so formats
 *    it has no codec for (AVI, most MKV) must be imported in the desktop app
 */

import type { Project, ProjectRef } from '../types'
import type { ImportedImage } from '../api'
import { safeName } from '../paths'
import { allProjects, deleteProject, getProject, putProject, type WebProjectRecord } from './db'
import * as fs from './fs'
import { extractFrames } from './frames'
import { ensureAccess, folderPickerAvailable, pickFiles, pickParentFolder, pickProjectFolder } from './pick'
import { markBrowser, reportProgress } from './support'

type Opened = { dir: string; project: Project } | { error: string } | null

const PROJECT_FILE = 'project.json'

/**
 * Philips Lumify, measured off the burnt-in depth ruler: ticks every 154.0 px,
 * and the labelled 0 -> 1 cm span is 308.0 px in every sample. Identical at both
 * the 1.0 cm and 2.5 cm depth settings — depth changes the field of view, not
 * the scale. (The Mindray used in Vang et al is 132.0; calibrate per project.)
 */
const DEFAULT_PPC = 308.0
const NO_PICKER =
  'This browser cannot open a folder from your computer. Use Chrome or Edge, ' +
  'or create a project — it will be kept in this browser instead.'

const projectPath = (token: string) => `${token}\\${PROJECT_FILE}`

async function remember(rec: WebProjectRecord) {
  fs.registerRoot(rec.token, rec.handle)
  await putProject(rec)
}

/** Reopening a folder already in the list must reuse its token, not add a twin. */
async function tokenFor(handle: FileSystemDirectoryHandle) {
  for (const rec of await allProjects()) {
    if (await rec.handle.isSameEntry(handle)) return rec.token
  }
  return fs.claimToken(handle.name)
}

async function readProject(token: string): Promise<Project | null> {
  try {
    return JSON.parse(await fs.readText(projectPath(token))) as Project
  } catch {
    return null
  }
}

async function openHandle(handle: FileSystemDirectoryHandle, visible: boolean): Promise<Opened> {
  const token = await tokenFor(handle)
  fs.registerRoot(token, handle)
  const project = await readProject(token)
  if (!project) return { error: `That folder is not a project (no ${PROJECT_FILE}).` }
  await remember({ token, name: project.name, lastOpened: new Date().toISOString(), handle, visible })
  return { dir: token, project }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.append(a)      // Firefox ignores a click on a detached anchor
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}

/** Unique folder name for a capture, checked against what is already on disk. */
async function uniqueClip(baseDir: string, wanted: string) {
  const taken = new Set(await fs.listSubdirs(baseDir))
  let clip = wanted
  for (let n = 2; taken.has(clip); n++) clip = `${wanted}-${n}`
  return clip
}

const api: Window['api'] = {
  async listProjects(): Promise<ProjectRef[]> {
    const recs = await allProjects()
    recs.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))
    // register up front so paths resolve the moment a project is reopened
    for (const r of recs) fs.registerRoot(r.token, r.handle)
    return recs.map((r) => ({ dir: r.token, name: r.name, lastOpened: r.lastOpened }))
  },

  async forgetProject(dir: string) {
    await deleteProject(dir)
    fs.forgetRoot(dir)
    return true
  },

  async createProject(name: string): Promise<Opened> {
    const parent = await pickParentFolder()
    if (!parent) return null
    const handle = await parent.handle.getDirectoryHandle(safeName(name), { create: true })
    const token = await tokenFor(handle)
    fs.registerRoot(token, handle)
    if (await fs.exists(projectPath(token))) {
      return { error: 'A project already exists in that folder.' }
    }
    const project: Project = {
      name,
      createdAt: new Date().toISOString(),
      scalePpc: DEFAULT_PPC,
      timepoints: [],
      captures: [],
    }
    await fs.writeFile(projectPath(token), JSON.stringify(project, null, 2))
    await remember({
      token, name, lastOpened: new Date().toISOString(), handle, visible: parent.visible,
    })
    return { dir: token, project }
  },

  async openProject(dir?: string): Promise<Opened> {
    if (dir) {
      const rec = await getProject(dir)
      if (!rec) return { error: 'That project is no longer in this browser.' }
      if (!(await ensureAccess(rec.handle))) {
        return { error: 'Access to that folder was not granted.' }
      }
      return openHandle(rec.handle, rec.visible)
    }
    if (!folderPickerAvailable) return { error: NO_PICKER }
    const handle = await pickProjectFolder()
    if (!handle) return null
    return openHandle(handle, true)
  },

  async saveProject({ dir, project }) {
    await fs.writeFile(projectPath(dir), JSON.stringify(project, null, 2))
    return true
  },

  async pickVideos() {
    return (await pickFiles('video')).map(fs.registerPick)
  },

  async pickImages() {
    return (await pickFiles('image')).map(fs.registerPick)
  },

  async importVideo({ videoPath, outDir, fps = 5 }) {
    const file = fs.pickedFile(videoPath)
    if (!file) throw new Error('that video is no longer available — pick it again')
    const dest = `${outDir}\\${file.name}`
    // stills from an earlier import of this folder would otherwise survive and be
    // scrubbed through as if they belonged to this clip
    for (const stale of await fs.listImages(outDir)) await fs.removeFile(stale)
    await fs.writeFile(dest, file)
    const frames: string[] = []
    for await (const f of extractFrames(file, fps)) {
      await fs.writeFile(`${outDir}\\${f.name}`, f.blob)
      frames.push(`${outDir}\\${f.name}`)
      reportProgress(`Extracting stills… ${f.index + 1} / ${f.total}`)
    }
    return { videoPath: dest, frames }
  },

  async importImages({ files, baseDir }): Promise<ImportedImage[]> {
    const out: ImportedImage[] = []
    for (const path of files) {
      const file = fs.pickedFile(path)
      if (!file) throw new Error('that image is no longer available — pick it again')
      const clip = await uniqueClip(baseDir, safeName(file.name.replace(/\.[^.]+$/, '')))
      const framesDir = `${baseDir}\\${clip}`
      const imagePath = `${framesDir}\\${file.name}`
      await fs.writeFile(imagePath, file)
      out.push({ clip, framesDir, imagePath })
    }
    return out
  },

  listFrames: (dirPath) => fs.listImages(dirPath),

  async writeFile({ filePath, contents }) {
    await fs.writeFile(filePath, contents)
    // A tab cannot show the user where the project folder is, and for a project
    // kept in browser storage there is no folder to open at all — so hand the
    // file over as a download as well. The desktop app just writes it.
    download(filePath.split(/[\\/]/).pop() ?? 'export.csv', contents)
    return filePath
  },

  async deleteFolder({ projectDir, target }) {
    if (!target || target.includes('..') || /^[a-zA-Z]:[\\/]/.test(target)) {
      throw new Error('refused: target is not inside the project folder')
    }
    await fs.removeDir(`${projectDir}\\${target}`)
    return true
  },

  readImage: (filePath) => fs.objectUrl(filePath),
}

/** Called at start-up only when Electron has not already injected the real api. */
export function installWebApi() {
  window.api = api
  markBrowser()
}
