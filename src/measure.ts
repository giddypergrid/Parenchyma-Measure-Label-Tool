export function shoelace(pts: number[][]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.abs(a) / 2
}

/**
 * A crossing ("figure-of-eight") outline makes the shoelace area silently wrong,
 * because the overlapping lobes cancel out. Detect it so we can refuse to save.
 */
export function selfIntersects(pts: number[][]): boolean {
  const n = pts.length
  if (n < 4) return false
  const ccw = (a: number[], b: number[], c: number[]) =>
    (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((j + 1) % n === i || (i + 1) % n === j) continue // neighbours share a vertex
      const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n]
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) return true
    }
  }
  return false
}

/* Project-level defaults, overridable per capture. Undefined on the capture = inherit. */

export const scaleOf = (
  project: { scalePpc: number },
  capture: { scalePpc?: number },
) => capture.scalePpc ?? project.scalePpc

export const quarterOf = (
  project: { defaultQuarter?: string },
  capture: { quarter?: string },
) => capture.quarter ?? project.defaultQuarter ?? ''

/** Border is in image pixels; ppc = pixels per cm from the depth ruler. */
export function metrics(border: number[][] | null | undefined, ppc: number) {
  if (!border || border.length < 3) return null
  const mm = 10 / ppc
  const xs = border.map((p) => p[0])
  const ys = border.map((p) => p[1])
  return {
    area: shoelace(border) * mm * mm,
    width: (Math.max(...xs) - Math.min(...xs)) * mm,
    depth: (Math.max(...ys) - Math.min(...ys)) * mm,
  }
}
