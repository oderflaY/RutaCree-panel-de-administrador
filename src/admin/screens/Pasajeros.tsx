import { useEffect, useState } from 'react'
import { adminApi } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Badge, Button, Input, Kpi, Section, Table, fmtDate } from '../ui'
import type { RidersResponse } from '../types'

export function Pasajeros() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [data, setData] = useState<RidersResponse | null>(null)
  const [error, setError] = useState('')

  async function load(query: string) {
    try {
      setData(await adminApi.riders(query))
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
  }
  // Busca al teclear, con un pequeño retardo.
  useEffect(() => {
    const t = setTimeout(() => load(q), 300)
    return () => clearTimeout(t)
  }, [q])

  async function patch(id: number, body: Parameters<typeof adminApi.patchRider>[1], msg: string) {
    try {
      await adminApi.patchRider(id, body)
      toast(msg)
      load(q)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  async function del(id: number, name: string) {
    if (!confirm(`¿Eliminar la cuenta de ${name} y todos sus datos?`)) return
    try {
      await adminApi.deleteRider(id)
      toast('Cuenta eliminada')
      load(q)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  async function password(id: number) {
    const p = prompt('Nueva contraseña (8-128 caracteres):')
    if (!p) return
    patch(id, { password: p }, 'Contraseña actualizada')
  }

  const r = data
  return (
    <div className="flex flex-col gap-5">
      {r && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Cuentas" value={r.total} tone="blue" />
          <Kpi label="Silla de ruedas" value={r.wheelchair} />
          <Kpi label="Baja visión" value={r.lowVision} />
          <Kpi label="Movilidad reducida" value={r.reducedMobility} />
          <Kpi label="Suspendidas" value={r.suspended} tone={r.suspended ? 'red' : 'green'} />
        </div>
      )}
      <Section title="Pasajeros" subtitle="Cuentas registradas en la app.">
        <Input type="search" placeholder="Buscar por nombre o correo…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} className="mb-4 max-w-sm" />
        {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}
        <Table head={['Nombre', 'Correo', 'Necesidades', 'Alta', 'Estado', 'Acciones']}>
          {r?.riders.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 font-medium">{p.name}</td>
              <td className="px-3 py-2 text-slate-500">{p.email}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {p.wheelchair && <Badge tone="blue">Silla</Badge>}
                  {p.lowVision && <Badge tone="blue">Baja visión</Badge>}
                  {p.reducedMobility && <Badge tone="blue">Mov. reducida</Badge>}
                  {!p.wheelchair && !p.lowVision && !p.reducedMobility && <span className="text-slate-400">—</span>}
                </div>
              </td>
              <td className="px-3 py-2 text-slate-500">{fmtDate(p.createdAt)}</td>
              <td className="px-3 py-2">
                {!p.active ? <Badge tone="red">Suspendida</Badge> : p.locked ? <Badge tone="amber">Bloqueada</Badge> : <Badge tone="green">Activa</Badge>}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap justify-end gap-1">
                  {p.active
                    ? <Button className="px-2 py-1" onClick={() => patch(p.id, { active: false }, 'Cuenta suspendida')}>Suspender</Button>
                    : <Button variant="green" className="px-2 py-1" onClick={() => patch(p.id, { active: true }, 'Cuenta reactivada')}>Reactivar</Button>}
                  {p.locked && p.active && <Button className="px-2 py-1" onClick={() => patch(p.id, { unlock: true }, 'Cuenta desbloqueada')}>Desbloquear</Button>}
                  <Button className="px-2 py-1" onClick={() => password(p.id)}>Contraseña</Button>
                  <Button variant="red" className="px-2 py-1" onClick={() => del(p.id, p.name)}>Eliminar</Button>
                </div>
              </td>
            </tr>
          ))}
          {r && r.riders.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin resultados.</td></tr>}
        </Table>
        {r && r.riders.length >= 200 && <p className="mt-2 text-xs text-slate-400">Mostrando 200 como máximo; afina la búsqueda para ver otras.</p>}
      </Section>
    </div>
  )
}
