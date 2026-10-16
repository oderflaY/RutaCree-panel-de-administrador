// Geometría del editor de rutas: distancias, proyección de un punto sobre el trazo y simplificación.
// Todo en coordenadas [lng, lat]; las distancias en metros (aproximación plana, de sobra precisa a
// escala de ciudad).

export type LngLat = [number, number]

const KX = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const KY = 110540

export function dist(a: LngLat, b: LngLat) {
  const kx = KX((a[1] + b[1]) / 2)
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KY)
}

export function lineLength(line: LngLat[], from = 0, to = line.length - 1) {
  let d = 0
  for (let i = from; i < to; i++) d += dist(line[i], line[i + 1])
  return d
}

export type Projection = { point: LngLat; index: number; t: number; along: number; distance: number }

/** El punto del trazo (entre los vértices `from` y `to`) más cercano a `p`. */
export function project(line: LngLat[], p: LngLat, from = 0, to = line.length - 1): Projection | null {
  if (line.length < 2 || to <= from) return line.length ? { point: line[0], index: 0, t: 0, along: 0, distance: dist(line[0], p) } : null
  const kx = KX(p[1])
  let best: Projection | null = null
  let along = lineLength(line, 0, from)
  for (let i = from; i < to; i++) {
    const a = line[i], b = line[i + 1]
    const ax = (b[0] - a[0]) * kx, ay = (b[1] - a[1]) * KY
    const px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * KY
    const L2 = ax * ax + ay * ay
    const t = L2 ? Math.max(0, Math.min(1, (px * ax + py * ay) / L2)) : 0
    const d = Math.hypot(px - t * ax, py - t * ay)
    const segLen = Math.sqrt(L2)
    if (!best || d < best.distance) {
      best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i, t, along: along + t * segLen, distance: d }
    }
    along += segLen
  }
  return best
}

/** Índice del vértice más cercano a `p`. */
export function nearestVertex(line: LngLat[], p: LngLat, from = 0) {
  let best = from, bd = Infinity
  for (let i = from; i < line.length; i++) {
    const d = dist(line[i], p)
    if (d < bd) { bd = d; best = i }
  }
  return best
}

/** Douglas–Peucker: índices de los vértices que conservan la forma con error < tol metros. */
export function simplifyIdx(line: LngLat[], tol: number): number[] {
  if (line.length <= 2) return line.map((_, i) => i)
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let idx = -1, max = tol
    for (let i = s + 1; i < e; i++) {
      const pr = project([line[s], line[e]], line[i])
      const d = pr ? pr.distance : 0
      if (d > max) { max = d; idx = i }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]) }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/** Une tramos sin repetir el punto donde se tocan. */
export function joinSegments(parts: LngLat[][]): LngLat[] {
  const out: LngLat[] = []
  for (const part of parts) {
    for (const c of part) {
      const last = out[out.length - 1]
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
    }
  }
  return out
}

export const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
export const fmtMin = (s: number) => {
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

/** "Ruta 6 - Las Flores" → "ruta-6-las-flores" (el id que acepta el servidor). */
export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** "Boulevard José María Patoni" → "Blvd. José María Patoni", como se rotulan las paradas. */
export function shortStreet(n: string) {
  const rules: [RegExp, string][] = [
    [/^Boulevard\s+/i, 'Blvd. '], [/^Avenida\s+/i, 'Av. '], [/^Calle\s+/i, ''], [/^Privada\s+/i, 'Priv. '],
    [/^Prolongación\s+/i, 'Prol. '], [/^Carretera\s+/i, 'Carr. '], [/^Calzada\s+/i, 'Calz. '], [/^Circuito\s+/i, 'Circ. '],
  ]
  for (const [re, rep] of rules) if (re.test(n)) return n.replace(re, rep)
  return n
}
