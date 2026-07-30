'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function WalletsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/settings?tab=wallets') }, [router])
  return null
}