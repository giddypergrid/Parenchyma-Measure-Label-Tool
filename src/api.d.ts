import type { Project, ProjectRef } from './types'

export {}

type Opened = { dir: string; project: Project } | { error: string } | null

declare global {
  interface Window {
    api: {
      listProjects(): Promise<ProjectRef[]>
      forgetProject(dir: string): Promise<boolean>
      createProject(name: string): Promise<Opened>
      openProject(dir?: string): Promise<Opened>
      saveProject(o: { dir: string; project: Project }): Promise<boolean>
      pickVideos(): Promise<string[]>
      importVideo(o: { videoPath: string; outDir: string; fps?: number }): Promise<{
        videoPath: string
        frames: string[]
      }>
      listFrames(dirPath: string): Promise<string[]>
      writeFile(o: { filePath: string; contents: string }): Promise<string>
      deleteFolder(o: { projectDir: string; target: string }): Promise<boolean>
      readImage(filePath: string): Promise<string>
    }
  }
}
