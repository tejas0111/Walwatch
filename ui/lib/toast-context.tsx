'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export type Toast = {
  id: string
  type: ToastType
  title: string
  description?: string
}

type ToastContextType = {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

let toastId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = String(++toastId)
      setToasts((prev) => [...prev, { ...toast, id }])
      setTimeout(() => removeToast(id), 4000)
    },
    [removeToast],
  )

  const value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast])

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}
