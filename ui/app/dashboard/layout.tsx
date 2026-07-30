'use client'

import { AppShell } from '@/components/dashboard/app-shell'
import { AuthGuard } from '@/app/auth-guard'
import { SuiProvider } from '@/lib/sui-provider'
import { ToastProvider } from '@/lib/toast-context'
import { Toaster } from '@/components/ui/toast'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SuiProvider>
      <ToastProvider>
        <AuthGuard>
          <AppShell>{children}</AppShell>
        </AuthGuard>
        <Toaster />
      </ToastProvider>
    </SuiProvider>
  )
}
