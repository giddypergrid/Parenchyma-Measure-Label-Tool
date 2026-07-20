import { useEffect, useRef, useState } from 'react'
import { Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Capture, Project, Timepoint } from '../types'
import { metrics, quarterOf, scaleOf, selfIntersects } from '../measure'
import type { Capture as Cap } from '../types'
import { abs, rel, safeName } from '../paths'

type Props = {
  dir: string
  project: Project
  timepoint: Timepoint
  capture: Capture
  onSave: (captureId: string, patch: Partial<Cap>) => void
  onCaptureFrame: (captureId: string, framePath: string) => void
  onBack: () => void
}

const QUARTERS = ['LF', 'RF', 'LR', 'RR']
const DIETS = ['HC', 'LC']

export default function MeasureView({
  dir, project, timepoint, capture, onSave, onCaptureFrame, onBack,
}: Props) {
  const [frames, setFrames] = useState<string[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [vIdx, setVIdx] = useState(0)                       // scrub position (left panel)
  const [framePath, setFramePath] = useState<string | undefined>(capture.framePath)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [pts, setPts] = useState<number[][]>(capture.border ?? [])
  const [closed, setClosed] = useState((capture.border?.length ?? 0) >= 3)
  const [calf, setCalf] = useState(capture.calf ?? '')
  const [diet, setDiet] = useState(capture.diet ?? '')
  // undefined = inherit the project default
  const [quarter, setQuarter] = useState<string | undefined>(capture.quarter)
  const [ppc, setPpc] = useState<number | undefined>(capture.scalePpc)
  const [ppcDraft, setPpcDraft] = useState(String(capture.scalePpc ?? project.scalePpc))
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(560)

  useEffect(() => {
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
    const load = (url: string) => {
      const i = new Image()
      i.onload = () => setImg(i)
      i.src = url
    }
    if (urls[framePath]) load(urls[framePath])
    else window.api.readImage(abs(dir, framePath)!).then(load)
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
  const m = crossed ? null : metrics(closed ? pts : null, scale_)

  const overlay = m
    ? `AREA ${m.area.toFixed(2)} mm²   W ${m.width.toFixed(2)}   D ${m.depth.toFixed(2)}   scale ${scale_} px/cm`
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
    if (e.target.getClassName() !== 'Image' || closed) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    const p = [pos.x / scale, pos.y / scale]
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
          <span className="muted small">project default — type a value and press Enter to override</span>
        )}
      </div>

      <div className="measure">
        {/* LEFT: scrub the clip */}
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

        {/* RIGHT: draw on the captured still */}
        <div>
          <div className="plabel">2 · Captured image — draw the outline</div>
          <div className="canvasbox" ref={boxRef}>
            {img ? (
              <Stage width={stageW} height={stageH} onMouseDown={onStageDown}>
                <Layer>
                  <KImage image={img} width={stageW} height={stageH} />
                  {pts.length > 0 && (
                    <>
                      <Line points={flat} closed={closed} stroke="#fff" strokeWidth={1.6} />
                      <Line points={flat} closed={closed} stroke="#14171b" strokeWidth={0.75}
                        fill={closed ? 'rgba(255,255,255,0.07)' : undefined} />
                    </>
                  )}
                  {pts.map((p, i) => (
                    <Rect key={i} x={p[0] * scale - 2} y={p[1] * scale - 2} width={4} height={4}
                      fill="#fff" stroke="#14171b" strokeWidth={0.7} draggable
                      hitStrokeWidth={12} /* small dot, still easy to grab */
                      onDragMove={(e) => moveVertex(i, e.target.x() + 2, e.target.y() + 2)} />
                  ))}
                  <Rect x={0} y={0} width={stageW} height={26} fill="rgba(255,255,255,0.92)" />
                  <Text x={8} y={7} text={overlay} fontSize={13}
                    fontFamily="Cascadia Mono, Consolas, monospace" fill="#14171b" />
                </Layer>
              </Stage>
            ) : (
              <span className="nocap">Drag the video, then press Capture.</span>
            )}
          </div>
          <div className="mtools">
            <span className={'mval' + (crossed ? ' bad' : '')}>
              {crossed
                ? 'outline crosses itself — the area would be wrong; drag a point to untangle it'
                : m
                  ? `${m.area.toFixed(2)} mm² · w ${m.width.toFixed(2)} · d ${m.depth.toFixed(2)}`
                  : '—'}
            </span>
            <button onClick={() => { setPts(pts.slice(0, -1)); setClosed(false) }} disabled={!pts.length}>Undo</button>
            <button onClick={() => setClosed(true)} disabled={pts.length < 3 || closed}>Close loop</button>
            <button onClick={() => { setPts([]); setClosed(false) }} disabled={!pts.length}>Clear</button>
            <button className="pri" disabled={!m || !framePath}
              onClick={() => onSave(capture.id, {
                border: pts, framePath, calf: calf.trim(), diet: diet.trim(),
                quarter: qOverridden ? quarter : undefined,
                scalePpc: overridden ? ppc : undefined,
              })}>
              Save measurement
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
