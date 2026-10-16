import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { adminApi } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Button, Field, Input, Kpi, Section, Table, useAsync } from '../ui'
import type { Stats } from '../types'

// Estadísticas de pasajeros: todo sale de lo que el chofer cuenta al iniciar cada vuelta (app o WhatsApp).
// Gráficas en SVG propio (sin librerías: el CSP del servidor es estricto). Colores: ranuras categóricas
// del DIF (azul y naranja: se distinguen también con daltonismo) en claro y oscuro (hombres = 1, mujeres = 2).

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const fmt = (n: number) => n.toLocaleString('es-MX')
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
const dayLabel = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  const w = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(y, m - 1, d).getDay()]
  return `${w} ${d}/${m}`
}

const PRESETS: { label: string; days: number }[] = [
  { label: '7 días', days: 6 }, { label: '30 días', days: 29 }, { label: '90 días', days: 89 }, { label: '1 año', days: 364 },
]

export function Estadisticas() {
  const toast = useToast()
  const [desde, setDesde] = useState(daysAgo(29))
  const [hasta, setHasta] = useState(iso(new Date()))
  const { data, error, loading } = useAsync(() => adminApi.stats(desde, hasta), [desde, hasta])
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try { await adminApi.downloadStats(desde, hasta) } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="viz-root space-y-5">
      <style>{VIZ_CSS}</style>
      <div>
        <h1 className="text-lg font-semibold">Estadísticas de pasajeros</h1>
        <p className="text-sm text-slate-500">Se calculan solas con lo que cada chofer reporta al iniciar la vuelta: hombres, mujeres, personas con discapacidad, adultos mayores, embarazadas y acompañantes.</p>
      </div>

      {/* Filtros: una sola fila arriba de las gráficas */}
      <div className="neu-card-sm flex flex-wrap items-end gap-3 px-4 py-3">
        <Field label="Desde"><Input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const on = desde === daysAgo(p.days) && hasta === iso(new Date())
            return <button key={p.label} data-on={on} onClick={() => { setDesde(daysAgo(p.days)); setHasta(iso(new Date())) }}
              className={`neu-btn px-3 py-1.5 text-xs ${on ? 'text-sky-600' : 'text-slate-500'}`}>{p.label}</button>
          })}
        </div>
        <Button variant="green" className="ml-auto" onClick={download} disabled={busy || !data}>Descargar Excel con gráficas</Button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Cargando estadísticas…</p>}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {data && <Body s={data} />}
    </div>
  )
}

function Body({ s }: { s: Stats }) {
  const u = s.usuarios
  const sinConteo = s.vueltas - s.vueltasConConteo
  const busiest = useMemo(() => [...s.horas].sort((a, b) => b.usuarios - a.usuarios)[0], [s])
  const usadas = s.rutas.filter((r) => r.usuarios.total > 0).length
  return (
    <>
      {s.vueltas === 0 && (
        <p className="neu-card-sm px-4 py-3 text-sm text-amber-700">
          Todavía no hay vueltas en estas fechas: las gráficas están en cero. Se llenan solas en cuanto los choferes inician sus vueltas desde la app (o por WhatsApp) y cuentan cuántos suben.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="neu-card-sm px-4 py-3 sm:col-span-2 lg:col-span-1">
          <div className="text-xs text-slate-500">Personas que usaron el servicio</div>
          <div className="mt-1 text-5xl font-semibold tabular-nums text-slate-700">{fmt(u.total)}</div>
          <div className="mt-1 text-xs text-slate-500">{fmt(s.vueltas)} vueltas · {s.vueltasConConteo ? (u.total / s.vueltasConConteo).toFixed(1) : '0'} por vuelta</div>
        </div>
        <Kpi label="Hombres" value={fmt(u.hombres)} sub={` · ${pct(u.hombres, u.total)}`} />
        <Kpi label="Mujeres" value={fmt(u.mujeres)} sub={` · ${pct(u.mujeres, u.total)}`} />
        <Kpi label="Hora con más usuarios" value={busiest && busiest.usuarios > 0 ? `${String(busiest.hora).padStart(2, '0')}:00` : '—'}
          sub={busiest && busiest.usuarios > 0 ? ` · ${fmt(busiest.usuarios)}` : ''} tone="green" />
      </div>
      {sinConteo > 0 && (
        <p className="text-xs text-amber-700">{fmt(sinConteo)} de {fmt(s.vueltas)} vueltas no traen el conteo de usuarios (se iniciaron sin contestar cuántos suben). No cuentan en los totales.</p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Hombres y mujeres" subtitle="Del total de personas que subieron">
          <Donut parts={[{ label: 'Hombres', value: u.hombres, color: 'var(--series-1)' }, { label: 'Mujeres', value: u.mujeres, color: 'var(--series-2)' }]} />
        </Section>
        <Section title="Usuarios por condición" subtitle="Cuántos de los usuarios son… (una persona puede contar en más de una)">
          <HBars rows={[
            { label: 'Personas con discapacidad', value: u.discapacidad },
            { label: 'Adultos mayores', value: u.adultosMayores },
            { label: 'Embarazadas', value: u.embarazadas },
            { label: 'Acompañantes', value: u.acompanantes },
          ]} total={u.total} />
        </Section>
      </div>

      <Section title="Rutas más usadas" subtitle={`Personas por ruta, de la más usada a la menos usada · ${usadas} de ${s.rutas.length} rutas con usuarios`}>
        <Legend items={[['Hombres', 'var(--series-1)'], ['Mujeres', 'var(--series-2)']]} />
        <StackedHBars total={u.total} rows={s.rutas.map((r, i) => ({ label: `${i + 1}. ${r.nombre}`, a: r.usuarios.hombres, b: r.usuarios.mujeres,
          tip: `${r.vueltas} vueltas · ${r.usuarios.discapacidad} con discapacidad · ${r.usuarios.adultosMayores} adultos mayores` }))} />
        <div className="mt-4">
          <Table head={['Ruta', 'Vueltas', 'Usuarios', 'Hombres', 'Mujeres', 'Discapacidad', 'Adultos mayores', 'Embarazadas', 'Acompañantes', 'Promedio']}>
            {s.rutas.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color || 'var(--series-1)' }} />{r.nombre}</td>
                {[r.vueltas, r.usuarios.total, r.usuarios.hombres, r.usuarios.mujeres, r.usuarios.discapacidad, r.usuarios.adultosMayores, r.usuarios.embarazadas, r.usuarios.acompanantes].map((v, i) => <td key={i} className="px-3 py-2 tabular-nums">{fmt(v)}</td>)}
                <td className="px-3 py-2 tabular-nums">{r.vueltas ? (r.usuarios.total / r.vueltas).toFixed(1) : '—'}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>

      <Section title="Usuarios por día" subtitle={s.dias.length > 62 ? 'Por semana (periodo largo)' : undefined}>
        <Legend items={[['Hombres', 'var(--series-1)'], ['Mujeres', 'var(--series-2)']]} />
        <Columns data={byDayOrWeek(s)} stacked />
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Usuarios por hora de salida" subtitle="Hora a la que inició la vuelta">
          <Columns data={s.horas.filter((_, i, all) => i >= firstUsed(all) && i <= lastUsed(all))
            .map((h) => ({ label: `${String(h.hora).padStart(2, '0')}h`, a: h.usuarios, tip: `${h.vueltas} vueltas` }))} />
        </Section>
        <Section title="Usuarios por día de la semana">
          <Columns data={s.semana.map((d) => ({ label: d.dia.slice(0, 3).toLowerCase(), a: d.usuarios.total, tip: `${d.vueltas} vueltas` }))} />
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Choferes" subtitle="Vueltas iniciadas y usuarios que reportaron">
          <Table head={['Chofer', 'Vueltas', 'Usuarios']}>
            {s.choferes.map((d) => <tr key={d.nombre}><td className="px-3 py-2">{d.nombre}</td><td className="px-3 py-2 tabular-nums">{fmt(d.vueltas)}</td><td className="px-3 py-2 tabular-nums">{fmt(d.usuarios)}</td></tr>)}
          </Table>
        </Section>
        <Section title="Fallas reportadas por los choferes">
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Rampa" value={fmt(s.incidentes.ramp_failure ?? 0)} tone="amber" />
            <Kpi label="Camión" value={fmt(s.incidentes.breakdown ?? 0)} tone="amber" />
            <Kpi label="Accidentes" value={fmt(s.incidentes.accident ?? 0)} tone="red" />
          </div>
          <p className="mt-3 text-xs text-slate-500">Cada falla también queda escrita sola en el Reporte de vehículo del día y en las observaciones de la bitácora.</p>
        </Section>
      </div>
    </>
  )
}

const firstUsed = (h: Stats['horas']) => Math.max(0, h.findIndex((x) => x.vueltas > 0))
const lastUsed = (h: Stats['horas']) => { for (let i = h.length - 1; i >= 0; i--) if (h[i].vueltas > 0) return i; return 23 }

// Más de dos meses: por semana, para que las columnas no queden de un pixel.
function byDayOrWeek(s: Stats) {
  const rows = s.dias.map((d) => ({ label: dayLabel(d.dia), a: d.usuarios.hombres, b: d.usuarios.mujeres, tip: `${d.vueltas} vueltas` }))
  if (s.dias.length <= 62) return rows
  const out: typeof rows = []
  for (let i = 0; i < s.dias.length; i += 7) {
    const chunk = s.dias.slice(i, i + 7)
    out.push({ label: `sem ${dayLabel(chunk[0].dia).split(' ')[1]}`, a: chunk.reduce((n, d) => n + d.usuarios.hombres, 0),
      b: chunk.reduce((n, d) => n + d.usuarios.mujeres, 0), tip: `${chunk.reduce((n, d) => n + d.vueltas, 0)} vueltas` })
  }
  return out
}

// ---- piezas de gráfica ----

const VIZ_CSS = `
.viz-root { --series-1:var(--dif-azul); --series-2:#e07b12; --grid:#cfd6e2; --viz-surface:var(--bg); }
:root[data-theme='dark'] .viz-root { --series-1:#5b8be0; --series-2:var(--dif-naranja); --grid:#3a414d; }
.viz-hit:hover .viz-mark { filter: brightness(1.08); }
`

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
      {items.map(([l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
    </div>
  )
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left: x, top: y - 8 }}>{children}</div>
  )
}

// Dona de dos partes (hombres | mujeres) con el total al centro y valor + porcentaje de cada parte.
function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  const R = 70, W = 22, C = 2 * Math.PI * R
  let off = 0
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <circle cx={90} cy={90} r={R} fill="none" stroke="var(--grid)" strokeWidth={W} />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * C
          const gap = parts.filter((x) => x.value > 0).length > 1 ? 2 : 0
          const el = p.value > 0 && (
            <circle key={p.label} cx={90} cy={90} r={R} fill="none" stroke={p.color} strokeWidth={W}
              strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)">
              <title>{`${p.label}: ${fmt(p.value)} (${pct(p.value, total)})`}</title>
            </circle>
          )
          off += len
          return el
        })}
        <text x={90} y={88} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--ink)">{fmt(total)}</text>
        <text x={90} y={108} textAnchor="middle" fontSize={11} fill="var(--ink-soft)">personas</text>
      </svg>
      <div className="space-y-3">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-700">{fmt(p.value)} <span className="text-sm font-normal text-slate-500">{pct(p.value, total)}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Barras horizontales de una serie, con el valor en la punta.
function HBars({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[10rem_1fr] items-center gap-3 text-sm">
          <span className="truncate text-slate-600">{r.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-4 rounded-r" style={{ width: `${(r.value / max) * 85}%`, minWidth: r.value ? 3 : 0, background: 'var(--series-1)' }} title={`${r.label}: ${fmt(r.value)}`} />
            <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{fmt(r.value)} <span className="text-slate-400">· {pct(r.value, total)}</span></span>
          </div>
        </div>
      ))}
    </div>
  )
}

// Barras horizontales apiladas (hombres | mujeres) con el total en la punta y detalle al pasar el mouse.
function StackedHBars({ rows, total }: { rows: { label: string; a: number; b: number; tip?: string }[]; total?: number }) {
  const [hover, setHover] = useState(-1)
  const max = Math.max(1, ...rows.map((r) => r.a + r.b))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.label} className="viz-hit relative grid grid-cols-[minmax(8rem,16rem)_1fr] items-center gap-3 py-0.5 text-sm"
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
          <span className="truncate text-slate-600" title={r.label}>{r.label}</span>
          <div className="relative flex items-center gap-2">
            <div className="flex h-5 gap-[2px]" style={{ width: `${((r.a + r.b) / max) * 85}%`, minWidth: r.a + r.b ? 3 : 0 }}>
              {r.a > 0 && <div className="viz-mark h-full" style={{ flex: r.a, background: 'var(--series-1)' }} />}
              {r.b > 0 && <div className="viz-mark h-full rounded-r" style={{ flex: r.b, background: 'var(--series-2)' }} />}
            </div>
            <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-600">{fmt(r.a + r.b)}{total !== undefined && <span className="font-normal text-slate-400"> · {pct(r.a + r.b, total)}</span>}</span>
            {hover === i && (
              <Tip x={60} y={0}>
                <strong>{r.label}</strong><br />Hombres {fmt(r.a)} · Mujeres {fmt(r.b)}{r.tip && <><br />{r.tip}</>}
              </Tip>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// Columnas (una serie, o hombres+mujeres apiladas) en SVG con eje y redondeado y tooltip por columna.
function Columns({ data, stacked = false }: { data: { label: string; a: number; b?: number; tip?: string }[]; stacked?: boolean }) {
  const [hover, setHover] = useState(-1)
  const [box, W] = useWidth(720)
  const H = 220, L = 34, B = 26, T = 10
  const tot = (d: (typeof data)[number]) => d.a + (stacked ? d.b ?? 0 : 0)
  const rawMax = Math.max(1, ...data.map(tot))
  const step = niceStep(rawMax)
  const max = Math.ceil(rawMax / step) * step
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const band = (W - L) / Math.max(1, data.length)
  const bw = Math.min(24, band * 0.7)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const every = Math.ceil(data.length / Math.max(1, Math.floor(W / 56)))
  return (
    <div ref={box} className="relative">
      <svg width={W} height={H} className="block" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + band * i + (band - bw) / 2
          const a = d.a, b = stacked ? d.b ?? 0 : 0
          return (
            <g key={i} className="viz-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" />
              {a > 0 && <Bar x={x} w={bw} y0={y(0)} y1={y(a)} color="var(--series-1)" round={!b} />}
              {b > 0 && <Bar x={x} w={bw} y0={y(a) - (a > 0 ? 2 : 0)} y1={y(a + b)} color="var(--series-2)" round />}
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-soft)">{d.label}</text>}
            </g>
          )
        })}
      </svg>
      {hover >= 0 && (() => {
        const d = data[hover]
        const xPct = ((L + band * hover + band / 2) / W) * 100
        return (
          <div className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: `${xPct}%`, top: 0 }}>
            <strong>{d.label}</strong> · {fmt(tot(d))} usuarios
            {stacked && <><br />Hombres {fmt(d.a)} · Mujeres {fmt(d.b ?? 0)}</>}
            {d.tip && <><br />{d.tip}</>}
          </div>
        )
      })()}
    </div>
  )
}

// Columna con punta redondeada de 4 px y base cuadrada.
function Bar({ x, w, y0, y1, color, round }: { x: number; w: number; y0: number; y1: number; color: string; round: boolean }) {
  const h = Math.max(0, y0 - y1)
  if (h <= 0) return null
  const r = round ? Math.min(4, h, w / 2) : 0
  const d = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
  return <path className="viz-mark" d={d} fill={color} />
}

// Ancho real del contenedor, para dibujar en pixeles (texto siempre de 11 px, sin escalar).
function useWidth(initial: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceStep(max: number) {
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p)
  return Math.max(1, 10 * p)
}
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n))
