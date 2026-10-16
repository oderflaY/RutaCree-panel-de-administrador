import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { adminApi, ApiError, getToken, setOnSessionLost } from './adminApi'
import type { Session } from './types'

// --- Avisos (toasts) ---
type Toast = { id: number; text: string; type: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, type?: Toast['type']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

// --- Sesión ---
type Auth = {
  session: Session | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}
const AuthCtx = createContext<Auth>(null as unknown as Auth)
export const useAuth = () => useContext(AuthCtx)

export function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const toast = useCallback((text: string, type: Toast['type'] = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, text, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3000)
  }, [])

  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setOnSessionLost(() => {
      adminApi.logout()
      setSession(null)
    })
    if (!getToken()) {
      setLoading(false)
      return
    }
    adminApi.me().then(setSession).catch(() => adminApi.logout()).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    await adminApi.login(email, password)
    setSession(await adminApi.me())
  }, [])
  const logout = useCallback(() => {
    adminApi.logout()
    setSession(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ session, loading, login, logout }}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`neu-card-sm pointer-events-auto px-4 py-2.5 text-sm font-medium ${
                t.type === 'error' ? 'text-rose-500' : 'text-emerald-600'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </AuthCtx.Provider>
  )
}

// Muestra el mensaje de un ApiError en un toast y devuelve undefined (para cortar el flujo).
export function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : String(e)
}
