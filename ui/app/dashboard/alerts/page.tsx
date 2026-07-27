'use client'

import {
  Bell,
  Hash,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, type AlertRule, type NotificationChannel } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const channelIcons: Record<string, React.ElementType> = {
  email: Mail,
  slack: Hash,
  discord: MessageSquare,
  telegram: Send,
  webhook: Webhook,
}

const triggerTypes: { value: string; label: string }[] = [
  { value: 'blob_expiring', label: 'Blob expiring' },
  { value: 'renewal_failed', label: 'Renewal failed' },
  { value: 'renewal_succeeded', label: 'Renewal succeeded' },
  { value: 'wallet_balance_low', label: 'Wallet balance low' },
  { value: 'budget_exceeded', label: 'Budget exceeded' },
]

export default function AlertsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [rulesLoading, setRulesLoading] = useState(true)

  // Channel dialog
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [channelType, setChannelType] = useState('email')
  const [channelName, setChannelName] = useState('')
  const [channelConfig, setChannelConfig] = useState('')
  const [channelSaving, setChannelSaving] = useState(false)
  const [deleteChannel, setDeleteChannel] = useState<NotificationChannel | null>(null)

  // Rule dialog
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [ruleTrigger, setRuleTrigger] = useState('blob_expiring')
  const [ruleChannelIds, setRuleChannelIds] = useState<string[]>([])
  const [ruleSaving, setRuleSaving] = useState(false)
  const [deleteRule, setDeleteRule] = useState<AlertRule | null>(null)

  const fetchChannels = useCallback(async () => {
    if (!org?.id) return
    try {
      const data = await api.listChannels(org.id)
      setChannels(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load channels' })
    } finally {
      setChannelsLoading(false)
    }
  }, [org?.id, addToast])

  const fetchRules = useCallback(async () => {
    if (!org?.id) return
    try {
      const data = await api.listAlertRules(org.id)
      setRules(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load alert rules' })
    } finally {
      setRulesLoading(false)
    }
  }, [org?.id, addToast])

  useEffect(() => {
    fetchChannels()
    fetchRules()
  }, [fetchChannels, fetchRules])

  // Channel handlers
  const resetChannelForm = () => {
    setChannelType('email')
    setChannelName('')
    setChannelConfig('')
  }

  const handleCreateChannel = async () => {
    if (!org?.id || !channelName.trim()) return
    setChannelSaving(true)
    try {
      const channel = await api.createChannel(org.id, {
        type: channelType,
        name: channelName.trim(),
        config: channelConfig.trim() ? { address: channelConfig.trim() } : {},
      })
      setChannels((prev) => [...prev, channel])
      setChannelDialogOpen(false)
      resetChannelForm()
      addToast({ type: 'success', title: 'Channel created' })
    } catch {
      addToast({ type: 'error', title: 'Failed to create channel' })
    } finally {
      setChannelSaving(false)
    }
  }

  const handleDeleteChannel = async () => {
    if (!org?.id || !deleteChannel) return
    try {
      await api.deleteChannel(org.id, deleteChannel.id)
      setChannels((prev) => prev.filter((c) => c.id !== deleteChannel.id))
      setDeleteChannel(null)
      addToast({ type: 'success', title: 'Channel deleted' })
    } catch {
      addToast({ type: 'error', title: 'Failed to delete channel' })
    }
  }

  // Rule handlers
  const resetRuleForm = () => {
    setRuleName('')
    setRuleTrigger('blob_expiring')
    setRuleChannelIds([])
  }

  const handleCreateRule = async () => {
    if (!org?.id || !ruleName.trim()) return
    setRuleSaving(true)
    try {
      const rule = await api.createAlertRule(org.id, {
        name: ruleName.trim(),
        trigger: ruleTrigger,
        channelIds: ruleChannelIds.length > 0 ? ruleChannelIds : undefined,
      })
      setRules((prev) => [...prev, rule])
      setRuleDialogOpen(false)
      resetRuleForm()
      addToast({ type: 'success', title: 'Alert rule created' })
    } catch {
      addToast({ type: 'error', title: 'Failed to create alert rule' })
    } finally {
      setRuleSaving(false)
    }
  }

  const handleDeleteRule = async () => {
    if (!org?.id || !deleteRule) return
    try {
      await api.deleteAlertRule(org.id, deleteRule.id)
      setRules((prev) => prev.filter((r) => r.id !== deleteRule.id))
      setDeleteRule(null)
      addToast({ type: 'success', title: 'Alert rule deleted' })
    } catch {
      addToast({ type: 'error', title: 'Failed to delete alert rule' })
    }
  }

  const toggleChannelInRule = (channelId: string) => {
    setRuleChannelIds((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId],
    )
  }

  const getChannelConfigPlaceholder = () => {
    switch (channelType) {
      case 'email': return 'e.g. team@example.com'
      case 'slack': return 'e.g. #alerts or webhook URL'
      case 'discord': return 'e.g. Webhook URL'
      case 'telegram': return 'e.g. Chat ID'
      case 'webhook': return 'e.g. https://hooks.example.com/alerts'
      default: return 'Configuration'
    }
  }

  return (
      <>
        <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Alerts' }]} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Notifications</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Alerts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure notification channels and alert rules.
            </p>
          </div>
        </div>

        {/* Notification channels */}
        <section aria-labelledby="channels-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="channels-heading" className="text-sm font-semibold">Notification channels</h2>
            <Button variant="outline" size="sm" onClick={() => { resetChannelForm(); setChannelDialogOpen(true) }}>
              <Plus size={13} aria-hidden="true" />
              Add channel
            </Button>
          </div>
          {channelsLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No channels configured"
              description="Add a notification channel to receive alerts."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {channels.map((ch) => {
                const Icon = channelIcons[ch.type] || Bell
                return (
                  <div
                    key={ch.id}
                    className="group relative flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                      <Icon size={18} className="text-muted-foreground" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{ch.name}</p>
                      <p className="text-[11px] capitalize text-muted-foreground">{ch.type}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteChannel(ch)}
                      aria-label={`Delete channel ${ch.name}`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Alert rules */}
        <section aria-labelledby="rules-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="rules-heading" className="text-sm font-semibold">Alert rules</h2>
            <Button variant="outline" size="sm" onClick={() => { resetRuleForm(); setRuleDialogOpen(true) }}>
              <Plus size={13} aria-hidden="true" />
              Add rule
            </Button>
          </div>
          {rulesLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No alert rules"
              description="Create a rule to get notified about important events."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline">{r.trigger?.replace(/_/g, ' ')}</Badge>
                      <Badge variant={r.enabled ? 'default' : 'secondary'}>
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeleteRule(r)}
                    aria-label={`Delete rule ${r.name || ''}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create Channel Dialog */}
      <Dialog open={channelDialogOpen} onOpenChange={(open) => { if (!open) { setChannelDialogOpen(false); resetChannelForm() } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
            <DialogDescription>Choose a channel type and provide the configuration.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <FormField label="Channel type">
              <Select value={channelType} onValueChange={(v) => v && setChannelType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Channel name">
              <Input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. Team alerts"
              />
            </FormField>
            <FormField label="Configuration">
              <Input
                value={channelConfig}
                onChange={(e) => setChannelConfig(e.target.value)}
                placeholder={getChannelConfigPlaceholder()}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setChannelDialogOpen(false); resetChannelForm() }}>
              Cancel
            </Button>
            <Button onClick={handleCreateChannel} disabled={channelSaving || !channelName.trim()}>
              {channelSaving ? 'Creating…' : 'Add channel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={(open) => { if (!open) { setRuleDialogOpen(false); resetRuleForm() } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add alert rule</DialogTitle>
            <DialogDescription>Define when alerts should fire and where to send them.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <FormField label="Rule name">
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. Blob expiring soon"
              />
            </FormField>
            <FormField label="Trigger">
              <Select value={ruleTrigger} onValueChange={(v) => v && setRuleTrigger(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {triggerTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Notification channels">
              <div className="flex flex-wrap gap-2">
                {channels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No channels available</p>
                ) : (
                  channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => toggleChannelInRule(ch.id)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                        ruleChannelIds.includes(ch.id)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {ch.name}
                    </button>
                  ))
                )}
              </div>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRuleDialogOpen(false); resetRuleForm() }}>
              Cancel
            </Button>
            <Button onClick={handleCreateRule} disabled={ruleSaving || !ruleName.trim()}>
              {ruleSaving ? 'Creating…' : 'Add rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Channel Confirmation */}
      <AlertDialog open={!!deleteChannel} onOpenChange={(open) => { if (!open) setDeleteChannel(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete channel</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the channel &ldquo;{deleteChannel?.name}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChannel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Rule Confirmation */}
      <AlertDialog open={!!deleteRule} onOpenChange={(open) => { if (!open) setDeleteRule(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete alert rule</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the rule &ldquo;{deleteRule?.name}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
  )
}