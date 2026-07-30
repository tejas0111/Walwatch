'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Mail, MessageSquare, Plus, Trash2, Webhook } from 'lucide-react'
import { api, type NotificationChannel } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  discord: MessageSquare,
  slack: MessageSquare,
  telegram: MessageSquare,
  webhook: Webhook,
}

export function NotificationsSection() {
  const { addToast } = useToast()
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [channelOpen, setChannelOpen] = useState(false)
  const [channelType, setChannelType] = useState('email')
  const [channelName, setChannelName] = useState('')
  const [channelConfig, setChannelConfig] = useState('')
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null)

  const fetchChannels = useCallback(async () => {
    setLoadingChannels(true)
    try {
      const data = await api.listChannels()
      setChannels(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load notification channels' })
    } finally {
      setLoadingChannels(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  async function handleCreateChannel() {
    if (!channelName) return
    setCreatingChannel(true)
    try {
      await api.createChannel({
        type: channelType,
        name: channelName,
        config: channelType === 'webhook' ? { url: channelConfig } : { target: channelConfig },
      })
      addToast({ type: 'success', title: 'Channel created' })
      setChannelOpen(false)
      setChannelName('')
      setChannelConfig('')
      await fetchChannels()
    } catch {
      addToast({ type: 'error', title: 'Failed to create channel' })
    } finally {
      setCreatingChannel(false)
    }
  }

  async function handleDeleteChannel(id: string) {
    setDeletingChannelId(id)
    try {
      await api.deleteChannel(id)
      addToast({ type: 'success', title: 'Channel deleted' })
      await fetchChannels()
    } catch {
      addToast({ type: 'error', title: 'Failed to delete channel' })
    } finally {
      setDeletingChannelId(null)
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Notification channels"
        description="Configure where notifications are delivered."
        action={
          <Dialog open={channelOpen} onOpenChange={setChannelOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus data-icon="inline-start" /> Add channel
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add notification channel</DialogTitle>
                <DialogDescription>Set up a new destination for alerts.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Type</Label>
                  <Select defaultValue="email" value={channelType} onValueChange={(v) => v && setChannelType(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="discord">Discord</SelectItem>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="channel-name">Name</Label>
                  <Input
                    id="channel-name"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="e.g. Ops alerts"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="channel-config">
                    {channelType === 'webhook' ? 'Webhook URL' : channelType === 'email' ? 'Email address' : `${channelType} target`}
                  </Label>
                  <Input
                    id="channel-config"
                    value={channelConfig}
                    onChange={(e) => setChannelConfig(e.target.value)}
                    placeholder={
                      channelType === 'webhook'
                        ? 'https://hooks.example.com/...'
                        : channelType === 'email'
                          ? 'alerts@example.com'
                          : `Enter ${channelType} target`
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button onClick={handleCreateChannel} disabled={creatingChannel || !channelName || !channelConfig}>
                  {creatingChannel && <Spinner data-icon="inline-start" />}
                  {creatingChannel ? 'Adding...' : 'Add channel'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        {loadingChannels ? (
          <InlineSkeleton lines={2} />
        ) : channels.length === 0 ? (
          <EmptyState icon={Bell} title="No channels" description="Add a notification channel to receive alerts." />
        ) : (
          <div className="space-y-2">
            {channels.map((ch) => {
              const Icon = CHANNEL_ICONS[ch.type] || Bell
              return (
                <div
                  key={ch.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 place-items-center rounded-lg bg-muted">
                      <Icon size={16} className="text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{ch.name}</p>
                      <p className="text-xs text-muted-foreground">{ch.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-500/15 text-green-500 border-green-500/20">active</Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDeleteChannel(ch.id)}
                      disabled={deletingChannelId === ch.id}
                      aria-label={`Delete ${ch.name}`}
                    >
                      {deletingChannelId === ch.id ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Trash2 data-icon="inline-start" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}


