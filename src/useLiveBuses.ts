import { useEffect, useRef, useState } from 'react'
import type { WsMessage } from './api'

export type Bus = {
  id: number
  name: string
  routeId: string
  // Interpolación: posición previa → objetivo en [t0, t0+dur]. El mapa calcula la actual por frame.
  prevLng: number
  prevLat: number
  tgtLng: number
  tgtLat: number
  t0: number
  dur: number
  bearing: number // grados, 0 = norte
  updated: number // última vez que reportó (ms)
}

export type Status = 'conectando' | 'en vivo' | 'reconectando'

// Mantiene la flota viva en un ref (sin provocar renders) y un contador `tick` que sube ~1/s para
// refrescar la UI lateral. Reconecta con espera creciente, como la app.
export function useLiveBuses() {
  const busesRef = useRef<Map<number, Bus>>(new Map())
  const [status, setStatus] = useState<Status>('conectando')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let ws: WebSocket | null = null
    let backoff = 1000
    let closed = false
    let reconnectTimer: number | undefined

    const lerp = (a: number, b: number, f: number) => a + (b - a) * f

    const apply = (msg: WsMessage) => {
      const now = performance.now()
      const buses = busesRef.current
      // Dispositivos: altas (con ruta) y bajas (sin ruta = oculto).
      for (const d of msg.devices ?? []) {
        const ruta = d.attributes?.ruta
        if (!ruta) {
          buses.delete(d.id)
          continue
        }
        const b = buses.get(d.id)
        if (b) {
          b.routeId = ruta
          b.name = d.name
        } else {
          buses.set(d.id, {
            id: d.id, name: d.name, routeId: ruta,
            prevLng: NaN, prevLat: NaN, tgtLng: NaN, tgtLat: NaN,
            t0: now, dur: 1000, bearing: 0, updated: now,
          })
        }
      }
      // Posiciones: nuevo objetivo; la previa pasa a ser la posición interpolada actual (sin brincos).
      for (const p of msg.positions ?? []) {
        const b = buses.get(p.deviceId)
        if (!b) continue
        if (Number.isNaN(b.tgtLng)) {
          b.prevLng = b.tgtLng = p.longitude
          b.prevLat = b.tgtLat = p.latitude
        } else {
          const f = Math.min(1, (now - b.t0) / b.dur)
          b.prevLng = lerp(b.prevLng, b.tgtLng, f)
          b.prevLat = lerp(b.prevLat, b.tgtLat, f)
          const dLng = p.longitude - b.prevLng
          const dLat = p.latitude - b.prevLat
          if (Math.abs(dLng) + Math.abs(dLat) > 1e-7) {
            // rumbo (0=norte, horario), corrigiendo la longitud por la latitud
            const k = Math.cos((b.prevLat * Math.PI) / 180)
            b.bearing = (Math.atan2(dLng * k, dLat) * 180) / Math.PI
          }
          b.tgtLng = p.longitude
          b.tgtLat = p.latitude
        }
        b.dur = Math.min(4000, Math.max(500, now - b.t0))
        b.t0 = now
        b.updated = now
      }
    }

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/socket`)
      ws.onopen = () => {
        backoff = 1000
        setStatus('en vivo')
      }
      ws.onmessage = (e) => {
        try {
          apply(JSON.parse(e.data as string) as WsMessage)
        } catch {
          /* ignora marcos no-JSON */
        }
      }
      ws.onclose = () => {
        if (closed) return
        setStatus('reconectando')
        reconnectTimer = window.setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 15000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    // Refresca la UI lateral una vez por segundo (el mapa anima aparte a 60fps).
    const ui = window.setInterval(() => setTick((t) => t + 1), 1000)

    return () => {
      closed = true
      clearInterval(ui)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  return { busesRef, status, tick }
}
