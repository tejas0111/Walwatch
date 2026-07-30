'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, type User, type Organization } from '@/lib/api-client'

interface AuthContextType {
  user: User | null
  org: Organization | null
  orgs: Organization[]
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: (idToken: string, nonce: string, ephemeralPublicKey: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  createOrg: (name: string, slug: string) => Promise<Organization>
  switchOrg: (orgId: string) => void
  refreshOrgs: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('walwatch_token')
      if (!token) {
        setUser(null)
        return
      }
      api.setToken(token)
      const u = await api.getMe()
      setUser(u)
    } catch {
      setUser(null)
      api.clearAuth()
    }
  }, [])

  const refreshOrgs = useCallback(async () => {
    try {
      const organizations = await api.listOrgs()
      setOrgs(organizations)
      const storedOrgId = localStorage.getItem('walwatch_org_id')
      const selected = organizations.find(o => o.id === storedOrgId) || organizations[0]
      if (selected) {
        setOrg(selected)
        api.setOrgId(selected.id)
        localStorage.setItem('walwatch_org_id', selected.id)
      } else {
        setOrg(null)
      }
    } catch {
      setOrgs([])
      setOrg(null)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('walwatch_token')
      if (!token) {
        setLoading(false)
        return
      }
      api.setToken(token)
      try {
        await refreshUser()
        await refreshOrgs()
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [refreshUser, refreshOrgs])

  const login = useCallback(async (email: string, password: string) => {
    const { token } = await api.login(email, password)
    api.setToken(token)
    localStorage.setItem('walwatch_token', token)
    await refreshUser()
    await refreshOrgs()
  }, [refreshUser, refreshOrgs])

  const loginWithGoogle = useCallback(async (idToken: string, nonce: string, ephemeralPublicKey: string) => {
    const { token } = await api.loginWithGoogle(idToken, nonce, ephemeralPublicKey)
    api.setToken(token)
    localStorage.setItem('walwatch_token', token)
    await refreshUser()
    await refreshOrgs()
  }, [refreshUser, refreshOrgs])

  const register = useCallback(async (email: string, password: string) => {
    const { token } = await api.register(email, password)
    api.setToken(token)
    localStorage.setItem('walwatch_token', token)
    await refreshUser()
  }, [refreshUser])

  const logout = useCallback(() => {
    api.clearAuth()
    setUser(null)
    setOrg(null)
    setOrgs([])
  }, [])

  const createOrg = useCallback(async (name: string, slug: string) => {
    const organization = await api.createOrg(name, slug)
    setOrgs(prev => [...prev, organization])
    setOrg(organization)
    api.setOrgId(organization.id)
    localStorage.setItem('walwatch_org_id', organization.id)
    return organization
  }, [])

  const switchOrg = useCallback((orgId: string) => {
    const found = orgs.find(o => o.id === orgId)
    if (found) {
      setOrg(found)
      api.setOrgId(found.id)
      localStorage.setItem('walwatch_org_id', found.id)
    }
  }, [orgs])

  const value = useMemo(() => ({
    user, org, orgs, loading,
    login, loginWithGoogle, register, logout, createOrg, switchOrg,
    refreshOrgs, refreshUser,
  }), [user, org, orgs, loading, login, loginWithGoogle, register, logout, createOrg, switchOrg, refreshOrgs, refreshUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
