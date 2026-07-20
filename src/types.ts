export type Timepoint = { id: string; name: string; date: string }

export type Capture = {
  id: string
  timepointId: string
  clip: string
  calf: string
  diet: string
  quarter?: string          // LF / RF / LR / RR — the udder has four separate glands
  scalePpc?: number         // per-image override, if this clip used a different depth
  framesDir?: string
  videoPath?: string
  framePath?: string
  border?: number[][] | null
}

export type Project = {
  name: string
  createdAt: string
  scalePpc: number          // project default; a capture may override it
  defaultQuarter?: string   // usually the same gland all study; overridable per capture
  timepoints: Timepoint[]
  captures: Capture[]
}

export type ProjectRef = { dir: string; name: string; lastOpened: string }

export const newId = () => Math.random().toString(36).slice(2, 10)
