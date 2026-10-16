import { useMemo, useState } from 'react'
import { adminApi } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Badge, Button, Modal, fmtDateTime, useAsync } from '../ui'
import type { Card } from '../types'

const COLS: { id: Card['column']; title: string }[] = [
  { id: 'nuevo', title: 'Nuevos' },
  { id: 'revision', title: 'En Revisión' },
  { id: 'cerrado', title: 'Cerrados' },
]

export function Incidencias() {
  const toast = useToast()
  const { data, error, loading, setData, reload } = useAsync(() => adminApi.board(), [])
  const [open, setOpen] = useState<Card | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<Card['column'] | null>(null)

  const byCol = useMemo(() => {
    const m: Record<Card['column'], Card[]> = { nuevo: [], revision: [], cerrado: [] }
    for (const c of data ?? []) m[c.column].push(c)
    for (const k of Object.keys(m) as Card['column'][]) m[k].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return m
  }, [data])

  async function move(id: string, column: Card['column']) {
    const card = data?.find((c) => c.id === id)
    if (!card || card.column === column) return
    setData((data ?? []).map((c) => (c.id === id ? { ...c, column } : c))) // optimista
    try {
      const updated = await adminApi.setCard(id, { column })
      setData((d) => (d ?? []).map((c) => (c.id === id ? updated : c)))
    } catch (err) {
      toast(errMsg(err), 'error')
      reload()
    }
  }
  async function saveResolution(id: string, resolution: string) {
    try {
      const updated = await adminApi.setCard(id, { resolution })
      setData((d) => (d ?? []).map((c) => (c.id === id ? updated : c)))
      setOpen(updated)
      toast('Resolución guardada')
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Cargando tablero…</p>
  if (error) return <p className="text-sm text-rose-500">{error}</p>

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Incidencias</h1>
        <p className="text-sm text-slate-500">Reportes de pasajeros y alarmas de choferes, cruzados con el GPS. Arrastra las tarjetas entre columnas.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {COLS.map((col) => (
          <section
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
            onDrop={() => { if (dragId) move(dragId, col.id); setDragId(null); setOverCol(null) }}
            className={`rounded-2xl border bg-[var(--bg)] p-3 transition ${overCol === col.id ? 'border-sky-400/70 bg-sky-200/30' : 'border-slate-300/50'}`}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{col.title}</h2>
              <Badge tone="gray">{byCol[col.id].length}</Badge>
            </div>
            <div className="flex flex-col gap-2">
              {byCol[col.id].map((c) => (
                <button
                  key={c.id}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null) }}
                  onClick={() => setOpen(c)}
                  className="cursor-grab rounded-xl border border-slate-300/50 bg-[var(--bg)] p-3 text-left hover:border-slate-400/60 active:cursor-grabbing"
                >
                  <div className="flex items-center justify-between">
                    <Badge tone={c.severity === 'emergencia' ? 'red' : 'amber'}>{c.severity === 'emergencia' ? 'Emergencia' : 'Reporte'}</Badge>
                    <span className="font-mono text-[11px] text-slate-400">{c.folio}</span>
                  </div>
                  <strong className="mt-1.5 block text-sm">{c.title}</strong>
                  <span className="text-xs text-slate-500">{c.who} · {fmtDateTime(c.at)}</span>
                  {c.resolution && <div className="mt-1 text-xs text-emerald-600">Con resolución</div>}
                </button>
              ))}
              {byCol[col.id].length === 0 && <div className="rounded-lg border border-dashed border-slate-300/50 py-6 text-center text-xs text-slate-400">Suelta aquí una tarjeta</div>}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={open.severity === 'emergencia' ? 'red' : 'amber'}>{open.folio}</Badge>
              <span className="text-slate-500">{fmtDateTime(open.at)}</span>
            </div>
            <p className="rounded-lg bg-[var(--bg-sunk)] p-3 text-slate-600">{open.detail}</p>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Mover a</div>
              <div className="flex gap-2">
                {COLS.map((c) => (
                  <Button key={c.id} variant={open.column === c.id ? 'blue' : 'base'} onClick={() => move(open.id, c.id)}>{c.title}</Button>
                ))}
              </div>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); saveResolution(open.id, String(new FormData(e.currentTarget).get('resolution'))) }}
            >
              <div className="mb-1 text-xs font-medium text-slate-500">Resolución</div>
              <textarea
                name="resolution"
                rows={3}
                defaultValue={open.resolution ?? ''}
                className="w-full rounded-lg border border-slate-300/50 bg-[var(--bg-sunk)] px-3 py-2 text-sm outline-none focus:border-sky-400/70"
                placeholder="Qué se hizo con este caso…"
              />
              <div className="mt-2 text-right"><Button variant="green" type="submit">Guardar resolución</Button></div>
            </form>
          </div>
        </Modal>
      )}
    </>
  )
}
