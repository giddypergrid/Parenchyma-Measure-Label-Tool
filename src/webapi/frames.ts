/**
 * Splitting a clip into stills without ffmpeg.
 *
 * The desktop app shells out to ffmpeg, which decodes anything. A browser can
 * only decode what it ships a codec for — practically mp4/webm — so an AVI from
 * the Mindray will fail here and must be imported in the desktop app instead.
 */

const MAX_FRAMES = 900 // ~3 min at 5 fps; a guard, not a limit anyone should hit

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.onloadeddata = () => {
      if (!v.videoWidth || !isFinite(v.duration)) {
        reject(new Error(`this browser cannot decode ${file.name}`))
      } else resolve(v)
    }
    v.onerror = () =>
      reject(new Error(
        `this browser cannot decode ${file.name} — ` +
        `convert it to MP4, or import the clip in the desktop app`,
      ))
    v.src = url
  })
}

const seekTo = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    v.onseeked = () => resolve()
    v.currentTime = t
  })

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('frame could not be encoded'))), 'image/png'),
  )

/** Yields one PNG per sampled time, in order, named like ffmpeg's output. */
export async function* extractFrames(file: File, fps: number) {
  const v = await loadVideo(file)
  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth
  canvas.height = v.videoHeight
  const ctx = canvas.getContext('2d')!
  const step = 1 / fps
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.floor(v.duration * fps)))
  try {
    for (let i = 0; i < count; i++) {
      await seekTo(v, i * step)
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      yield {
        name: `frame_${String(i + 1).padStart(4, '0')}.png`,
        blob: await toPng(canvas),
        index: i,
        total: count,
      }
    }
  } finally {
    URL.revokeObjectURL(v.src)
    v.src = ''
  }
}
