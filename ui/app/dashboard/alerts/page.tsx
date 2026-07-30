'use client'

import { Bell, Hash, Mail, MessageSquare, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { type AlertRule, type NotificationChannel } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useChannels, useAlertRules, useCreateChannel, useUpdateChannel, useDeleteChannel, useCreateAlertRule, useUpdateAlertRule, useDeleteAlertRule } from '@/hooks/use-alerts'

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

  const { data: channels = [], isLoading: channelsLoading, error: channelsError, refetch: refetchChannels } = useChannels(org?.id ?? '')
  const { data: rules = [], isLoading: rulesLoading, error: rulesError, refetch: refetchRules } = useAlertRules(org?.id ?? '')
  const createChannel = useCreateChannel(org?.id ?? '')
  const updateChannelMutation = useUpdateChannel(org?.id ?? '')
  const deleteChannelMutation = useDeleteChannel(org?.id ?? '')
  const createAlertRule = useCreateAlertRule(org?.id ?? '')
  const updateAlertRuleMutation = useUpdateAlertRule(org?.id ?? '')
  const deleteAlertRuleMutation = useDeleteAlertRule(org?.id ?? '')

  // Channel dialog
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [channelType, setChannelType] = useState('email')
  const [channelName, setChannelName] = useState('')
  const [channelConfig, setChannelConfig] = useState('')
  const [deleteChannel, setDeleteChannel] = useState<NotificationChannel | null>(null)
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(null)

  // Rule dialog
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [ruleTrigger, setRuleTrigger] = useState('blob_expiring')
  const [ruleChannelIds, setRuleChannelIds] = useState<string[]>([])
  const [deleteRule, setDeleteRule] = useState<AlertRule | null>(null)
  const [editRule, setEditRule] = useState<AlertRule | null>(null)

  // Channel handlers
  const resetChannelForm = () => {
    setChannelType('email')
    setChannelName('')
    setChannelConfig('')
  }

  const handleCreateChannel = () => {
    if (!channelName.trim()) return
    createChannel.mutate(
      {
        type: channelType,
        name: channelName.trim(),
        config: channelConfig.trim() ? { address: channelConfig.trim() } : {},
      },
      {
        onSuccess: () => {
          setChannelDialogOpen(false)
          resetChannelForm()
          addToast({ type: 'success', title: 'Channel created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create channel' }),
      },
    )
  }

  const handleDeleteChannel = () => {
    if (!deleteChannel) return
    deleteChannelMutation.mutate(deleteChannel.id, {
      onSuccess: () => {
        setDeleteChannel(null)
        addToast({ type: 'success', title: 'Channel deleted' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to delete channel' }),
    })
  }

  const handleEditChannel = () => {
    if (!editChannel) return
    updateChannelMutation.mutate(
      { id: editChannel.id, data: { type: channelType, name: channelName.trim(), config: channelConfig.trim() ? { address: channelConfig.trim() } : {} } },
      {
        onSuccess: () => {
          setEditChannel(null)
          resetChannelForm()
          addToast({ type: 'success', title: 'Channel updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update channel' }),
      },
    )
  }

  // Rule handlers
  const resetRuleForm = () => {
    setRuleName('')
    setRuleTrigger('blob_expiring')
    setRuleChannelIds([])
  }

  const handleCreateRule = () => {
    if (!ruleName.trim()) return
    createAlertRule.mutate(
      {
        name: ruleName.trim(),
        trigger: ruleTrigger,
        channelIds: ruleChannelIds.length > 0 ? ruleChannelIds : undefined,
      },
      {
        onSuccess: () => {
          setRuleDialogOpen(false)
          resetRuleForm()
          addToast({ type: 'success', title: 'Alert rule created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create alert rule' }),
      },
    )
  }

  const handleDeleteRule = () => {
    if (!deleteRule) return
    deleteAlertRuleMutation.mutate(deleteRule.id, {
      onSuccess: () => {
        setDeleteRule(null)
        addToast({ type: 'success', title: 'Alert rule deleted' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to delete alert rule' }),
    })
  }

  const handleEditRule = () => {
    if (!editRule) return
    updateAlertRuleMutation.mutate(
      { id: editRule.id, data: { name: ruleName.trim(), trigger: ruleTrigger, channelIds: ruleChannelIds.length > 0 ? ruleChannelIds : undefined } },
      {
        onSuccess: () => {
          setEditRule(null)
          resetRuleForm()
          addToast({ type: 'success', title: 'Alert rule updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update alert rule' }),
      },
    )
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
    <PageTransition>
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
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add channel
          </Button>
        </div>
        {channelsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : channelsError ? (
          <ErrorState message={channelsError?.message ?? 'Something went wrong'} onRetry={refetchChannels} />
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
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => { setEditChannel(ch); setChannelType(ch.type); setChannelName(ch.name); setChannelConfig(typeof ch.config === 'object' && ch.config && 'address' in ch.config ? String(ch.config.address) : '') }}
                      aria-label={`Edit channel ${ch.name || ''}`}
                    >
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1465 1.14645L3.71455 8.57836C3.62468 8.66823 3.55963 8.77965 3.52557 8.90255L2.52628 12.1913C2.45977 12.4125 2.57578 12.645 2.79698 12.7115C3.01818 12.778 3.25074 12.662 3.31725 12.4408L4.31654 9.15207C4.3506 9.02917 4.35064 8.89843 4.31654 8.77553C4.28249 8.65263 4.21744 8.54121 4.12757 8.45134L2.00001 6.32378C1.60949 5.93326 1.60949 5.30009 2.00001 4.90957L10.2929 -0.383331C10.6834 -0.773855 11.3166 -0.773855 11.7071 -0.383331L15.2929 3.20245C15.6834 3.59298 15.6834 4.22614 15.2929 4.61667L11.8536 1.14645Z" fill="currentColor" transform="translate(-1.5, 1.5)" /></svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteChannel(ch)}
                      aria-label={`Delete channel ${ch.name}`}
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </div>
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
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add rule
          </Button>
        </div>
        {rulesLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : rulesError ? (
          <ErrorState message={rulesError?.message ?? 'Something went wrong'} onRetry={refetchRules} />
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
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { setEditRule(r); setRuleName(r.name); setRuleTrigger(r.trigger || 'blob_expiring'); setRuleChannelIds(r.channelIds || []) }}
                    aria-label={`Edit rule ${r.name || ''}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1465 1.14645L3.71455 8.57836C3.62468 8.66823 3.55963 8.77965 3.52557 8.90255L2.52628 12.1913C2.45977 12.4125 2.57578 12.645 2.79698 12.7115C3.01818 12.778 3.25074 12.662 3.31725 12.4408L4.31654 9.15207C4.3506 9.02917 4.35064 8.89843 4.31654 8.77553C4.28249 8.65263 4.21744 8.54121 4.12757 8.45134L2.00001 6.32378C1.60949 5.93326 1.60949 5.30009 2.00001 4.90957L10.2929 -0.383331C10.6834 -0.773855 11.3166 -0.773855 11.7071 -0.383331L15.2929 3.20245C15.6834 3.59298 15.6834 4.22614 15.2929 4.61667L11.8536 1.14645Z" fill="currentColor" transform="translate(-1.5, 1.5)" /></svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeleteRule(r)}
                    aria-label={`Delete rule ${r.name || ''}`}
                  >
<Trash2 data-icon="inline-start" />
                  </Button>
                  </div>
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
                <SelectGroup>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectGroup>
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
          <Button onClick={handleCreateChannel} disabled={createChannel.isPending || !channelName.trim()}>
            {createChannel.isPending ? 'Creating…' : 'Add channel'}
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
                <SelectGroup>
                  {triggerTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Notification channels">
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">No channels available</p>
              ) : (
                channels.map((ch) => (
                  <Button
                    key={ch.id}
                    variant="outline"
                    size="xs"
                    onClick={() => toggleChannelInRule(ch.id)}
                    className={cn(
                      ruleChannelIds.includes(ch.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {ch.name}
                  </Button>
                ))
              )}
            </div>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setRuleDialogOpen(false); resetRuleForm() }}>
            Cancel
          </Button>
          <Button onClick={handleCreateRule} disabled={createAlertRule.isPending || !ruleName.trim()}>
            {createAlertRule.isPending ? 'Creating…' : 'Add rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Edit Channel Dialog */}
    <Dialog open={!!editChannel} onOpenChange={(open) => { if (!open) { setEditChannel(null); resetChannelForm() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit channel</DialogTitle>
          <DialogDescription>Update the notification channel configuration.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Channel type">
            <Select value={channelType} onValueChange={(v) => v && setChannelType(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectGroup>
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
              placeholder="Configuration"
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEditChannel(null); resetChannelForm() }}>
            Cancel
          </Button>
          <Button onClick={handleEditChannel} disabled={updateChannelMutation.isPending || !channelName.trim()}>
            {updateChannelMutation.isPending ? 'Saving…' : 'Save'}
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
          <AlertDialogAction onClick={handleDeleteChannel} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Edit Rule Dialog */}
    <Dialog open={!!editRule} onOpenChange={(open) => { if (!open) { setEditRule(null); resetRuleForm() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit alert rule</DialogTitle>
          <DialogDescription>Update the alert rule configuration.</DialogDescription>
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
                <SelectGroup>
                  {triggerTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Notification channels">
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">No channels available</p>
              ) : (
                channels.map((ch) => (
                  <Button
                    key={ch.id}
                    variant="outline"
                    size="xs"
                    onClick={() => toggleChannelInRule(ch.id)}
                    className={cn(
                      ruleChannelIds.includes(ch.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {ch.name}
                  </Button>
                ))
              )}
            </div>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEditRule(null); resetRuleForm() }}>
            Cancel
          </Button>
          <Button onClick={handleEditRule} disabled={updateAlertRuleMutation.isPending || !ruleName.trim()}>
            {updateAlertRuleMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

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
          <AlertDialogAction onClick={handleDeleteRule} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}