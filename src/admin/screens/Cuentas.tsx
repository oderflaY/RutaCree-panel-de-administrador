import { adminApi, roleLabel } from '../adminApi'
import { errMsg, useAuth, useToast } from '../ctx'
import { Badge, Button, Field, Input, Section, Select, Table, fmtDateTime, useAsync } from '../ui'
import type { Role } from '../types'

const ROLES: Role[] = ['superadmin', 'dispatcher', 'mechanic']

export function Cuentas() {
  const toast = useToast()
  const { session } = useAuth()
  const users = useAsync(() => adminApi.users(), [])
  const drivers = useAsync(() => adminApi.drivers(), [])
  const audit = useAsync(() => adminApi.audit(), [])

  const wrap = (fn: () => Promise<unknown>, after: () => void, msg?: string) => async () => {
    try { await fn(); if (msg) toast(msg); after() } catch (e) { toast(errMsg(e), 'error') }
  }

  async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const d = new FormData(f)
    try {
      await adminApi.createUser({ name: String(d.get('name')), username: String(d.get('username')), email: String(d.get('email')), role: String(d.get('role')), password: String(d.get('password')) })
      toast('Cuenta creada'); f.reset(); users.reload(); audit.reload()
    } catch (err) { toast(errMsg(err), 'error') }
  }
  async function createDriver(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const d = new FormData(f)
    try {
      await adminApi.createDriver({ id: String(d.get('id')).toUpperCase(), name: String(d.get('name')), email: String(d.get('email')), phone: String(d.get('phone')), password: String(d.get('password')) })
      toast('Chofer dado de alta'); f.reset(); drivers.reload(); audit.reload()
    } catch (err) { toast(errMsg(err), 'error') }
  }

  return (
    <div className="flex flex-col gap-5">
      <Section title="Cuentas del panel" subtitle="Quién puede entrar al centro de control.">
        <form className="grid gap-3 sm:grid-cols-5" onSubmit={createUser}>
          <Field label="Nombre"><Input name="name" required /></Field>
          <Field label="Usuario"><Input name="username" pattern="[A-Za-z0-9_.\-]{3,40}" placeholder="Despacho_Ana" required /></Field>
          <Field label="Correo"><Input name="email" type="email" required /></Field>
          <Field label="Rol"><Select name="role" defaultValue="dispatcher">{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select></Field>
          <Field label="Contraseña"><Input name="password" type="password" minLength={8} required /></Field>
          <div className="sm:col-span-5"><Button variant="blue" type="submit">Crear cuenta</Button></div>
        </form>
        <div className="mt-5">
          <Table head={['Nombre', 'Usuario', 'Correo', 'Rol', 'Estado', 'Acciones']}>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2 font-medium">{u.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{u.username}{session?.id === u.id && <span className="text-slate-400"> (tú)</span>}</td>
                <td className="px-3 py-2 text-slate-500">{u.email}</td>
                <td className="px-3 py-2">
                  <Select value={u.role} disabled={session?.id === u.id} className="w-auto py-1"
                    onChange={(e) => wrap(() => adminApi.patchUser(u.id, { role: e.target.value }), users.reload, 'Rol actualizado')()}>
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2">{!u.active ? <Badge tone="gray">De baja</Badge> : u.locked ? <Badge tone="amber">Bloqueada</Badge> : <Badge tone="green">Activa</Badge>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {session?.id !== u.id && (u.active
                      ? <Button className="px-2 py-1" onClick={wrap(() => adminApi.patchUser(u.id, { active: false }), users.reload, 'Cuenta dada de baja')}>Dar de baja</Button>
                      : <Button variant="green" className="px-2 py-1" onClick={wrap(() => adminApi.patchUser(u.id, { active: true }), users.reload, 'Cuenta reactivada')}>Reactivar</Button>)}
                    <Button className="px-2 py-1" onClick={() => { const p = prompt('Nueva contraseña (8+):'); if (p) wrap(() => adminApi.patchUser(u.id, { password: p }), users.reload, 'Contraseña actualizada')() }}>Contraseña</Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>

      <Section title="Choferes" subtitle="Acceso de los choferes a la app.">
        <form className="grid gap-3 sm:grid-cols-5" onSubmit={createDriver}>
          <Field label="Clave"><Input name="id" maxLength={16} pattern="[A-Za-z0-9\-]{1,16}" placeholder="CH-015" required /></Field>
          <Field label="Nombre"><Input name="name" required /></Field>
          <Field label="Correo"><Input name="email" type="email" required /></Field>
          <Field label="Teléfono"><Input name="phone" type="tel" placeholder="+52 618 555 0000" /></Field>
          <Field label="Contraseña"><Input name="password" type="password" minLength={8} required /></Field>
          <div className="sm:col-span-5"><Button variant="blue" type="submit">Dar de alta</Button></div>
        </form>
        <div className="mt-5">
          <Table head={['Clave', 'Nombre', 'Correo', 'Teléfono', 'Estado', 'Acciones']}>
            {drivers.data?.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 font-mono text-xs">{d.id}</td>
                <td className="px-3 py-2 font-medium">{d.name}</td>
                <td className="px-3 py-2 text-slate-500">{d.email}</td>
                <td className="px-3 py-2 text-slate-500">{d.phone || '—'}</td>
                <td className="px-3 py-2">{!d.active ? <Badge tone="gray">De baja</Badge> : d.locked ? <Badge tone="amber">Bloqueado</Badge> : <Badge tone="green">Activo</Badge>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {d.active
                      ? <Button className="px-2 py-1" onClick={wrap(() => adminApi.patchDriver(d.id, { active: false }), drivers.reload, 'Chofer dado de baja')}>Dar de baja</Button>
                      : <Button variant="green" className="px-2 py-1" onClick={wrap(() => adminApi.patchDriver(d.id, { active: true }), drivers.reload, 'Chofer reactivado')}>Reactivar</Button>}
                    <Button className="px-2 py-1" onClick={() => { const p = prompt('Nueva contraseña (8+):'); if (p) wrap(() => adminApi.patchDriver(d.id, { password: p }), drivers.reload, 'Contraseña actualizada')() }}>Contraseña</Button>
                    {/* El chatbot de WhatsApp reconoce al chofer por este número. */}
                    <Button className="px-2 py-1" onClick={() => { const p = prompt('WhatsApp del chofer (10 dígitos, ej. 618 555 0000). Vacío para quitarlo:', d.phone); if (p !== null) wrap(() => adminApi.patchDriver(d.id, { phone: p.trim() }), drivers.reload, 'Teléfono actualizado')() }}>Teléfono</Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>

      <Section title="Bitácora" subtitle="Últimas acciones de los administradores.">
        <Table head={['Cuándo', 'Quién', 'Acción']}>
          {audit.data?.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDateTime(a.at)}</td>
              <td className="px-3 py-2 font-mono text-xs">{a.actor}</td>
              <td className="px-3 py-2 text-slate-600">{a.action}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  )
}
