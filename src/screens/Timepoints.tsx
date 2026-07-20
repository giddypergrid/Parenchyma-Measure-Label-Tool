import { useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Project, Timepoint } from '../types'
import { metrics, scaleOf } from '../measure'

type Props = {
  project: Project
  onAdd: (name: string, date: string) => void
  onRename: (id: string, name: string, date: string) => void
  onOpen: (t: Timepoint) => void
  onDelete: (id: string) => void
}

const today = () => new Date().toISOString().slice(0, 10)
const DASH = [undefined, '5 4', '2 3', '8 3 2 3']

export default function Timepoints({ project, onAdd, onRename, onOpen, onDelete }: Props) {
  const [editing, setEditing] = useState<Timepoint | 'new' | null>(null)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today())

  function openDialog(t: Timepoint | 'new') {
    setEditing(t)
    setName(t === 'new' ? '' : t.name)
    setDate(t === 'new' ? today() : t.date)
  }

  function save() {
    if (!name.trim()) return
    if (editing === 'new') onAdd(name.trim(), date)
    else if (editing) onRename(editing.id, name.trim(), date)
    setEditing(null)
  }

  const sorted = [...project.timepoints].sort((a, b) => a.date.localeCompare(b.date))
  const diets = Array.from(new Set(project.captures.map((c) => c.diet).filter(Boolean)))

  const chart = sorted.map((t) => {
    const row: Record<string, string | number | null> = { name: t.name }
    for (const d of diets) {
      const xs = project.captures
        .filter((c) => c.timepointId === t.id && c.diet === d)
        .map((c) => metrics(c.border, scaleOf(project, c))?.area)
        .filter((a): a is number => typeof a === 'number')
      row[d] = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
    }
    return row
  })
  const hasData = chart.some((r) => diets.some((d) => r[d] !== null))

  return (
    <>
      <div className="head">
        <h2>Timepoints</h2>
        <button className="pri" onClick={() => openDialog('new')}>+ Add timepoint</button>
      </div>

      <div className="dash">
        <div className="tpside">
          {sorted.length === 0 ? (
            <div className="empty">
              <p>No timepoints yet.</p>
              <p className="muted small">
                A timepoint is one round of scanning — name it whatever suits, e.g. “Week 1”.
              </p>
              <button className="pri" onClick={() => openDialog('new')}>+ Add your first</button>
            </div>
          ) : (
            <ul className="tplist">
              {sorted.map((t) => {
                const caps = project.captures.filter((c) => c.timepointId === t.id)
                const done = caps.filter((c) => c.border && c.border.length >= 3).length
                return (
                  <li key={t.id}>
                    <button className="tprow" onClick={() => onOpen(t)}>
                      <span className="tpname">{t.name}</span>
                      <span className="tpmeta">{t.date}</span>
                      <span className="tpmeta">
                        {caps.length ? `${done}/${caps.length} measured` : 'empty'}
                      </span>
                    </button>
                    <button className="tpedit" title="Rename" onClick={() => openDialog(t)}>✎</button>
                    <button className="tpedit del" title={`Delete ${t.name}`}
                      onClick={() => onDelete(t.id)}>✕</button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="card chartcard">
          <h2>Parenchymal area by timepoint (mm²)</h2>
          {hasData ? (
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="#d2d4d7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#565b62" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#565b62" />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(1)} mm²`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {diets.map((d, i) => (
                    <Line key={d} type="linear" dataKey={d} name={d} stroke="#14171b"
                      strokeWidth={2} strokeDasharray={DASH[i % DASH.length]}
                      dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chartempty">
              {project.timepoints.length === 0
                ? 'Add a timepoint, then measure some outlines — the trend appears here.'
                : 'No measured outlines yet — the trend appears here as you measure.'}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="modal" onClick={() => setEditing(null)}>
          <div className="box" onClick={(e) => e.stopPropagation()}>
            <h2>{editing === 'new' ? 'Add timepoint' : 'Rename timepoint'}</h2>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Week 1" autoFocus />
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="row end">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="pri" disabled={!name.trim()} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
