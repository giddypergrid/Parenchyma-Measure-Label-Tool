import { useEffect, useRef, useState } from 'react'
import { Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Capture, Project, Timepoint } from '../types'
import { metrics, quarterOf, scaleOf, selfIntersects } from '../measure'
import { findRuler } from '../ruler'
import type { Capture as Cap } from '../types'
import { abs, rel, safeName } from '../paths'

type Props = {
  dir: string
  project: Project
  timepoint: Timepoint
  capture: Capture
  onSave: (captureId: string, patch: Partial<Cap>) => void
  onCaptureFrame: (captureId: string, framePath: string) => void
  onSetProjectScale: (ppc: number) => void
  onBack: () => void
}

const QUARTERS = ['LF', 'RF', 'LR', 'RR']
const DIETS = ['HC', 'LC']

// outline colours that stay readable on grey speckle
const COLOURS: [string, string][] = [
  ['Black', '#14171b'], ['White', '#ffffff'], ['Red', '#e23b2e'],
  ['Yellow', '#f5c518'], ['Cyan', '#22d3ee'], ['Green', '#4ade80'],
]

/** Pick a halo that contrasts with whatever outline colour is chosen. */
function haloFor(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum < 140 ? '#ffffff' : '#14171b'
}

export default function MeasureView({
  dir, project, timepoint, capture, onSave, onCaptureFrame, onSetProjectScale, onBack,
}: Props) {
  // a still has nothing to scrub through, so the whole left panel goes away
  const isImage = capture.source === 'image'
  const [frames, setFrames] = useState<string[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [vIdx, setVIdx] = useState(0)                       // scrub position (left panel)
  const [framePath, setFramePath] = useState<string | undefined>(capture.framePath)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [pts, setPts] = useState<number[][]>(capture.border ?? [])
  const [closed, setClosed] = useState((capture.border?.length ?? 0) >= 3)
  const [calf, setCalf] = useState(capture.calf ?? '')
  const [diet, setDiet] = useState(capture.diet ?? '')
  // undefined = inherit the project default
  const [quarter, setQuarter] = useState<string | undefined>(capture.quarter)
  const [ppc, setPpc] = useState<number | undefined>(capture.scalePpc)
  const [ppcDraft, setPpcDraft] = useState(String(capture.scalePpc ?? project.scalePpc))
  // a display preference, so it lives with the app, not in the study data
  const [colour, setColour] = useState(() => localStorage.getItem('outlineColour') ?? '#14171b')
  // two clicks on the depth ruler, then the real distance between them
  const [calib, setCalib] = useState<number[][] | null>(null)
  const [calibCm, setCalibCm] = useState('1')
  const [calibSpans, setCalibSpans] = useState(0)   // 0 = the marks were placed by hand
  const halo = haloFor(colour)
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(560)

  useEffect(() => {
    setImg(null)
    setLoadErr('')
    setFramePath(capture.framePath)
    setPts(capture.border ?? [])
    setClosed((capture.border?.length ?? 0) >= 3)
    setCalf(capture.calf ?? '')
    setDiet(capture.diet ?? '')
    setQuarter(capture.quarter)
    setPpc(capture.scalePpc)
    setPpcDraft(String(capture.scalePpc ?? project.scalePpc))
  }, [capture.id])

  // all stills for this clip, loaded once; the slider scrubs through them
  useEffect(() => {
    setCalib(null)
    if (isImage) {
      setFrames([])
      return
    }
    // stored per capture so renaming a timepoint can't orphan its stills
    const d = abs(dir, capture.framesDir ?? `${safeName(timepoint.name)}\\${capture.clip}`)!
    window.api.listFrames(d).then(async (list) => {
      const relList = list.map((p) => rel(dir, p)) // keep app state project-relative
      setFrames(relList)
      const start = capture.framePath ? relList.indexOf(capture.framePath) : 0
      setVIdx(start < 0 ? 0 : start)
      if (!capture.framePath && relList.length) setFramePath(relList[0])
      const pairs = await Promise.all(
        relList.map(async (p) => [p, await window.api.readImage(abs(dir, p)!)] as const),
      )
      setUrls(Object.fromEntries(pairs))
    })
  }, [capture.id])

  useEffect(() => {
    if (!framePath) return
    setLoadErr('')
    const load = (url: string) => {
      const i = new Image()
      i.onload = () => setImg(i)
      i.onerror = () => setLoadErr(`${framePath} could not be displayed.`)
      i.src = url
    }
    if (urls[framePath]) load(urls[framePath])
    else {
      window.api
        .readImage(abs(dir, framePath)!)
        .then(load)
        .catch(() => setLoadErr(`${framePath} is missing from the project folder.`))
    }
  }, [framePath, urls])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el)
    setBoxW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const iw = img?.naturalWidth ?? 800
  const ih = img?.naturalHeight ?? 600
  const scale = Math.min(boxW / iw, 1)
  const stageW = iw * scale
  const stageH = ih * scale
  const crossed = closed && selfIntersects(pts)
  const scale_ = scaleOf(project, { scalePpc: ppc })   // per-image override wins
  const effQuarter = quarterOf(project, { quarter })
  const overridden = ppc !== undefined && ppc !== project.scalePpc
  const qOverridden = quarter !== undefined && quarter !== (project.defaultQuarter ?? '')

  /** Editing either field overrides it for THIS image only — confirm before it sticks. */
  function commitScale() {
    const v = Number(ppcDraft)
    if (!v || v === project.scalePpc) {
      setPpc(undefined)
      setPpcDraft(String(project.scalePpc))
      return
    }
    if (confirm(`Overwrite the scale for this image only?\n\n` +
      `Project default: ${project.scalePpc} px/cm\nThis image: ${v} px/cm`)) {
      setPpc(v)
    } else {
      setPpc(undefined)
      setPpcDraft(String(project.scalePpc))
    }
  }

  function commitQuarter(v: string) {
    const def = project.defaultQuarter ?? ''
    if (v === def) return setQuarter(undefined)
    if (confirm(`Overwrite the quarter for this image only?\n\n` +
      `Project default: ${def || '—'}\nThis image: ${v}`)) setQuarter(v)
  }
  /**
   * Scale straight off the image: click two marks on the depth ruler, say how
   * far apart they really are. Needed because px/cm depends on the scanner and
   * on the depth setting — a Lumify still at 2.5 cm is nothing like the Mindray.
   */
  /** Drop the two markers straight onto the scanner's own tick marks. */
  function autoCalibrate() {
    if (!img) return
    const r = findRuler(img)
    setCalibSpans(r?.spans ?? 0)
    if (!r) {
      alert('No depth ruler found in this image — click the two marks yourself.')
      setCalib([])
      return
    }
    setCalib([[r.x, r.first], [r.x, r.last]])
    setCalibCm('')
  }

  function applyCalibration(scope: 'image' | 'project') {
    const [a, b] = calib!
    const cm = Number(calibCm)
    const px = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (!cm || px < 5) return
    const value = Number((px / cm).toFixed(1))
    if (scope === 'project') {
      onSetProjectScale(value)
      setPpc(undefined)
    } else {
      setPpc(value)
    }
    setPpcDraft(String(value))
    setCalib(null)
  }

  const m = crossed ? null : metrics(closed ? pts : null, scale_)
  // outlines that would move if the project scale changed — excludes overrides
  const measuredCount = project.captures.filter(
    (c) => c.border && c.border.length >= 3 && c.scalePpc === undefined,
  ).length
  // identity edits are worth saving on their own, without an outline
  const idDirty =
    calf.trim() !== (capture.calf ?? '') || diet.trim() !== (capture.diet ?? '') ||
    quarter !== capture.quarter || ppc !== capture.scalePpc

  const overlay = calib
    ? `CALIBRATING — click two marks on the depth ruler (${calib.length}/2)`
    : m
      ? `AREA ${m.area.toFixed(4)} cm²   W ${m.width.toFixed(3)} cm   D ${m.depth.toFixed(3)} cm   scale ${scale_} px/cm`
      : `click around the parenchyma · click the first dot to close   ·   scale ${scale_} px/cm`

  function capture_() {
    const p = frames[vIdx]
    if (!p || p === framePath) return
    if (pts.length && !confirm('Capture this frame? It clears the current outline.')) return
    setFramePath(p)
    setPts([])
    setClosed(false)
    onCaptureFrame(capture.id, p) // persist now, so the thumbnail updates and survives navigation
  }

  function onStageDown(e: KonvaEventObject<MouseEvent>) {
    if (e.target.getClassName() !== 'Image') return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    const p = [pos.x / scale, pos.y / scale]
    if (calib) {
      if (calib.length < 2) setCalib([...calib, p])
      return
    }
    if (closed) return
    if (pts.length >= 3) {
      const d = Math.hypot((pts[0][0] - p[0]) * scale, (pts[0][1] - p[1]) * scale)
      if (d < 9) return setClosed(true)
    }
    setPts([...pts, p])
  }

  function moveVertex(i: number, x: number, y: number) {
    const next = pts.slice()
    next[i] = [x / scale, y / scale]
    setPts(next)
  }

  const flat = pts.flatMap((p) => [p[0] * scale, p[1] * scale])
  const scrubUrl = frames[vIdx] ? urls[frames[vIdx]] : undefined

  return (
    <>
      <div className="head">
        <h2>
          {timepoint.name} <span className="muted small">{capture.clip}</span>
        </h2>
        <button onClick={onBack}>‹ Back to {timepoint.name}</button>
      </div>

      <div className="idbar">
        <label>Calf id</label>
        <input value={calf} onChange={(e) => setCalf(e.target.value)} style={{ width: 84 }} />
        <label>Quarter</label>
        <select value={effQuarter} onChange={(e) => commitQuarter(e.target.value)} style={{ width: 74 }}>
          <option value="">—</option>
          {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
        {qOverridden && <span className="overridden">this image only</span>}

        <label>Diet</label>
        <select value={diet} onChange={(e) => setDiet(e.target.value)} style={{ width: 74 }}>
          <option value="">—</option>
          {DIETS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <span className="sep" />
        <label>Scale</label>
        <input value={ppcDraft} onChange={(e) => setPpcDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitScale() }}
          onBlur={commitScale} style={{ width: 84 }} />
        <span className="muted small">px/cm</span>
        {overridden ? (
          <>
            <span className="overridden">this image only</span>
            <button onClick={() => { setPpc(undefined); setPpcDraft(String(project.scalePpc)) }}>
              Use project default
            </button>
          </>
        ) : (
          <span className="muted small">project default — mark 2 points on the ruler to adjust</span>
        )}
        <button onClick={() => (calib ? setCalib(null) : autoCalibrate())} disabled={!img}>
          {calib ? 'Cancel calibration' : 'Calibrate from ruler…'}
        </button>
      </div>

      <div className={'measure' + (isImage ? ' single' : '')}>
        {/* LEFT: scrub the clip — a still has no frames to scrub */}
        {!isImage && (
          <div>
            <div className="plabel">1 · Original video — drag to a clear frame</div>
            <div className="vbox">{scrubUrl && <img src={scrubUrl} alt="video frame" />}</div>
            <div className="vscrub">
              <input
                type="range"
                min={0}
                max={Math.max(0, frames.length - 1)}
                value={vIdx}
                onChange={(e) => setVIdx(Number(e.target.value))}
              />
              <span className="flab">frame {frames.length ? vIdx + 1 : 0} / {frames.length}</span>
              <button className="pri" onClick={capture_} disabled={!frames.length}>Capture ▸</button>
            </div>
          </div>
        )}

        {/* RIGHT: draw on the captured still */}
        <div>
          <div className="plabel">
            {isImage ? 'Image — draw the outline' : '2 · Captured image — draw the outline'}
          </div>
          <div className="canvasbox" ref={boxRef}>
            {img ? (
              <Stage width={stageW} height={stageH} onMouseDown={onStageDown}>
                <Layer>
                  <KImage image={img} width={stageW} height={stageH} />
                  {pts.length > 0 && (
                    <>
                      <Line points={flat} closed={closed} stroke={halo} strokeWidth={1.2} />
                      <Line points={flat} closed={closed} stroke={colour} strokeWidth={0.6}
                        fill={closed ? 'rgba(255,255,255,0.06)' : undefined} />
                    </>
                  )}
                  {pts.map((p, i) => (
                    <Rect key={i} x={p[0] * scale - 1.5} y={p[1] * scale - 1.5} width={3} height={3}
                      fill={colour} stroke={halo} strokeWidth={0.6} draggable
                      hitStrokeWidth={8} /* small enough to pack 30 dots, still grabbable */
                      onDragMove={(e) => moveVertex(i, e.target.x() + 1.5, e.target.y() + 1.5)} />
                  ))}
                  {calib?.map((p, i) => (
                    <Rect key={'c' + i} x={p[0] * scale - 4} y={p[1] * scale - 4} width={8} height={8}
                      fill="#e23b2e" stroke="#ffffff" strokeWidth={1} />
                  ))}
                  {calib?.length === 2 && (
                    <Line points={calib.flatMap((p) => [p[0] * scale, p[1] * scale])}
                      stroke="#e23b2e" strokeWidth={1.5} />
                  )}
                  <Rect x={0} y={0} width={stageW} height={26} fill="rgba(255,255,255,0.92)" />
                  <Text x={8} y={7} text={overlay} fontSize={13}
                    fontFamily="Cascadia Mono, Consolas, monospace" fill="#14171b" />
                </Layer>
              </Stage>
            ) : (
              <span className="nocap">
                {loadErr || (isImage ? 'Loading the image…' : 'Drag the video, then press Capture.')}
              </span>
            )}
          </div>
          <div className="mtools">
            <span className={'mval' + (crossed ? ' bad' : '')}>
              {crossed
                ? 'outline crosses itself — the area would be wrong; drag a point to untangle it'
                : m
                  ? `${m.area.toFixed(4)} cm²  ·  w ${m.width.toFixed(3)} cm  ·  d ${m.depth.toFixed(3)} cm` +
                    `  ·  ${pts.length} dots`
                  : '—'}
            </span>
            <select value={colour} title="outline colour"
              onChange={(e) => { setColour(e.target.value); localStorage.setItem('outlineColour', e.target.value) }}
              style={{ width: 84 }}>
              {COLOURS.map(([name, hex]) => <option key={hex} value={hex}>{name}</option>)}
            </select>
            <button onClick={() => { setPts(pts.slice(0, -1)); setClosed(false) }} disabled={!pts.length}>Undo</button>
            <button onClick={() => setClosed(true)} disabled={pts.length < 3 || closed}>Close loop</button>
            <button onClick={() => { setPts([]); setClosed(false) }} disabled={!pts.length}>Clear</button>
            <button className="pri" disabled={!framePath || (!m && !idDirty)}
              onClick={() => onSave(capture.id, {
                // an unmeasured capture can still have its identity corrected;
                // saving must not then write an empty border over nothing
                ...(m ? { border: pts } : {}),
                framePath, calf: calf.trim(), diet: diet.trim(),
                quarter: qOverridden ? quarter : undefined,
                scalePpc: overridden ? ppc : undefined,
              })}>
              {m ? 'Save measurement' : 'Save details'}
            </button>
          </div>
        </div>
      </div>

      {calib?.length === 2 && (
        <div className="modal">
          <div className="box">
            <h2>How far apart are those two marks?</h2>
            <p className="muted small" style={{ marginTop: -8 }}>
              {Math.hypot(calib[0][0] - calib[1][0], calib[0][1] - calib[1][1]).toFixed(1)} pixels
              between them.
              {calibSpans > 0 && ` The line spans ${calibSpans} ruler
                gap${calibSpans > 1 ? 's' : ''}, so if each gap is 0.5 cm the answer is
                ${(calibSpans * 0.5).toFixed(1)}.`}
            </p>
            <div className="field">
              <label>Real distance</label>
              <div className="row">
                <input type="number" step="0.1" min="0.1" value={calibCm} autoFocus
                  onChange={(e) => setCalibCm(e.target.value)} style={{ width: 90 }} />
                <span className="muted small">cm</span>
                {Number(calibCm) > 0 && (
                  <span className="muted small">
                    gives {(Math.hypot(calib[0][0] - calib[1][0], calib[0][1] - calib[1][1]) /
                      Number(calibCm)).toFixed(1)} px/cm
                  </span>
                )}
              </div>
            </div>
            <div className="row end">
              <button onClick={() => { setCalib([]); setCalibSpans(0) }}>Pick them myself</button>
              <button onClick={() => applyCalibration('image')} disabled={!Number(calibCm)}>
                This image only
              </button>
              <button className="pri" onClick={() => applyCalibration('project')}
                disabled={!Number(calibCm)}>
                Set as project default
              </button>
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Every image from the same scanner shares one scale, so the project default is
              usually the right choice.
              {measuredCount > 0 && ` It also re-scales the ${measuredCount} measurement` +
                `${measuredCount > 1 ? 's' : ''} already saved in this project — correct if they ` +
                `were taken with the wrong scale, wrong if they were not.`}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
