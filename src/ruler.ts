/**
 * Find the depth ruler in an ultrasound still.
 *
 * Scanners burn a tick scale down one edge of the image. The distance between
 * those ticks is the only reliable link between pixels and millimetres, and it
 * changes with the scanner and the depth setting — the Lumify stills measure
 * 308 px/cm where the Mindray ones measure 132.
 *
 * This only locates the ticks. How far apart they really are is still typed in
 * by the operator, so nothing is assumed about any particular machine.
 */

const STRIP = 14        // px scanned in from the edge
const BRIGHT = 120      // a tick is white on black; mid-grey speckle stays below this
const MIN_TICKS = 3
const TOLERANCE = 0.15  // a gap this far off the median is not part of the scale

export type Ruler = { x: number; first: number; last: number; gap: number; ticks: number }

/** Rows whose brightest pixel inside the strip is a tick, merged into centres. */
function tickCentres(data: Uint8ClampedArray, width: number, height: number, from: number) {
  const runs: number[][] = []
  for (let y = 0; y < height; y++) {
    let peak = 0
    for (let x = from; x < from + STRIP; x++) {
      const i = (y * width + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (lum > peak) peak = lum
    }
    if (peak <= BRIGHT) continue
    const last = runs[runs.length - 1]
    if (last && y - last[last.length - 1] <= 2) last.push(y)
    else runs.push([y])
  }
  return runs.map((r) => r.reduce((a, b) => a + b, 0) / r.length)
}

/**
 * Keep the longest run of ticks that share one spacing — this drops the header
 * text and the focus marker, which are bright but not evenly spaced.
 */
function evenlySpaced(centres: number[]) {
  if (centres.length < MIN_TICKS) return null
  const gaps = centres.slice(1).map((c, i) => c - centres[i])
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median < 8) return null

  let best: number[] = []
  let run = [centres[0]]
  for (let i = 0; i < gaps.length; i++) {
    if (Math.abs(gaps[i] - median) / median <= TOLERANCE) run.push(centres[i + 1])
    else {
      if (run.length > best.length) best = run
      run = [centres[i + 1]]
    }
  }
  if (run.length > best.length) best = run
  if (best.length < MIN_TICKS) return null

  const first = best[0]
  const last = best[best.length - 1]
  return { first, last, gap: (last - first) / (best.length - 1), ticks: best.length }
}

/** Null when no ruler is found — the operator then clicks the two marks themselves. */
export function findRuler(img: HTMLImageElement): Ruler | null {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // a cross-origin image taints the canvas
  }

  // the scale sits on one edge or the other; take whichever gives more ticks
  const sides = [0, Math.max(0, w - STRIP)]
  let best: Ruler | null = null
  for (const x of sides) {
    const found = evenlySpaced(tickCentres(data, w, h, x))
    if (found && (!best || found.ticks > best.ticks)) best = { x: x + STRIP / 2, ...found }
  }
  return best
}
