import React, { useRef, useState } from 'react'

const LABELS = ['P wave', 'QRS complex', 'T wave', 'ST segment', 'Artifact', 'Rhythm strip', 'Other']

export default function EcgImageAnnotator({ imageUrl, marks, onChange, readOnly = false }) {
  const frameRef = useRef(null)
  const [label, setLabel] = useState(LABELS[1])
  const [start, setStart] = useState(null)
  const [draft, setDraft] = useState(null)

  const point = (event) => {
    const rect = frameRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    }
  }

  const begin = (event) => {
    if (readOnly) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    setStart(p)
    setDraft({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const move = (event) => {
    if (!start || readOnly) return
    const p = point(event)
    setDraft({
      x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y)
    })
  }

  const finish = () => {
    if (draft && draft.width > 0.005 && draft.height > 0.005) {
      onChange([...marks, { id: crypto.randomUUID(), label, ...draft }])
    }
    setStart(null)
    setDraft(null)
  }

  return (
    <div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
          <label className="font-medium text-gray-700">Mark:</label>
          <select value={label} onChange={(e) => setLabel(e.target.value)} className="border rounded px-3 py-2">
            {LABELS.map(item => <option key={item}>{item}</option>)}
          </select>
          <span className="text-gray-500">Drag a box over the ECG image. Coordinates are stored independent of screen size.</span>
          {marks.length > 0 && <button onClick={() => onChange(marks.slice(0, -1))} className="text-blue-600">Undo</button>}
          {marks.length > 0 && <button onClick={() => onChange([])} className="text-red-600">Clear</button>}
        </div>
      )}
      <div className="overflow-auto border rounded-lg bg-gray-900 p-2">
        <div
          ref={frameRef}
          className={`relative inline-block min-w-full select-none ${readOnly ? '' : 'cursor-crosshair'}`}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          <img src={imageUrl} alt="ECG record for annotation" draggable="false" className="block w-full h-auto" />
          {[...marks, ...(draft ? [{ id: 'draft', label, ...draft }] : [])].map(mark => (
            <div
              key={mark.id}
              className="absolute border-2 border-red-500 bg-red-500/10 pointer-events-none"
              style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.width * 100}%`, height: `${mark.height * 100}%` }}
            >
              <span className="absolute -top-6 left-0 bg-red-600 text-white text-xs px-1.5 py-0.5 whitespace-nowrap">{mark.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
