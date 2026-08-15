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
const MIN_GAP = 8       // below this it is texture, not a scale
const MAX_MARKS = 60    // guard on the O(n^3) fit; a real ruler has far fewer
const COMPLETE = 0.75   // share of predicted positions that must actually hold a mark

/**
 * Measured on the Lumify stills: a tick is a 4 px run. The patient banner is
 * 17 px, and the focus caret is 8-9 px and can merge with the tick it sits on,
 * so the window has to stay loose enough to keep that merged mark.
 */
const MIN_TICK_H = 2
const MAX_TICK_H = 10

/** `spans` is how many gaps lie between first and last — what the operator is asked about. */
export type Ruler = { x: number; first: number; last: number; gap: number; spans: number }

/**
 * Bright rows in the strip, grouped into marks and reduced to their centres.
 * Runs outside the tick-height window are dropped — that is what removes the
 * burnt-in banner and most overlay text before any fitting happens.
 */
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
  return runs
    .filter((r) => {
      const tall = r[r.length - 1] - r[0] + 1
      return tall >= MIN_TICK_H && tall <= MAX_TICK_H
    })
    .map((r) => r.reduce((a, b) => a + b, 0) / r.length)
}

/**
 * Fit an evenly spaced lattice to the marks and keep the one with the most
 * members.
 *
 * A run-based rule is not enough: the patient banner at the top and the focus
 * caret beside the sector are both bright, and a single stray mark between two
 * real ticks skews a median-of-all-gaps badly enough to reject the whole scale.
 * Testing every candidate spacing and scoring it by how many marks land on it
 * ignores strays instead, and tolerates a tick missing from the middle.
 */
function latticeFit(centres: number[]) {
  if (centres.length < MIN_TICKS) return null
  let best: { first: number; last: number; gap: number; spans: number; hits: number } | null = null

  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      const step = centres[j] - centres[i]
      if (step < MIN_GAP) continue
      const tol = Math.max(2, step * 0.03)
      const on = centres.filter(
        (c) => Math.abs(c - (centres[i] + Math.round((c - centres[i]) / step) * step)) <= tol,
      )
      if (on.length < MIN_TICKS) continue

      const first = on[0]
      const last = on[on.length - 1]
      const spans = Math.round((last - first) / step)
      if (spans < 1) continue
      // A fine spacing can catch scattered marks by luck. Demand that most of the
      // positions it predicts are actually occupied, which a real scale satisfies.
      if (on.length / (spans + 1) < COMPLETE) continue
      // re-derive the spacing across the full span: averages out per-tick error
      const gap = (last - first) / spans
      // more marks wins; on a tie prefer the finer spacing, which is the real one
      if (!best || on.length > best.hits || (on.length === best.hits && gap < best.gap)) {
        best = { first, last, gap, spans, hits: on.length }
      }
    }
  }
  return best
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

  // Left edge only. Both scanners in this project draw the depth scale there,
  // and the right edge carries the settings panel, whose evenly spaced label
  // rows fit a lattice convincingly enough to be picked over the real ruler.
  const found = latticeFit(tickCentres(data, w, h, 0).slice(0, MAX_MARKS))
  if (!found) return null
  return {
    x: STRIP / 2, first: found.first, last: found.last, gap: found.gap, spans: found.spans,
  }
}
