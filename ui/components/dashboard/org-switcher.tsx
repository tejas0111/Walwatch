'use client'

import { useState } from 'react'
import { Building2, Check, ChevronDown, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function OrgSwitcher({ className }: { className?: string }) {
  const { org, orgs, switchOrg, createOrg, refreshOrgs } = useAuth()
  const { addToast } = useToast()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const slug = newName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const org = await createOrg(newName.trim(), slug)
      addToast({ type: 'success', title: 'Organization created', description: org.name })
      setNewName('')
      setCreateOpen(false)
      void refreshOrgs()
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to create organization',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setCreating(false)
    }
  }

  const handleCreateClick = () => {
    setDropdownOpen(false)
    setCreateOpen(true)
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger
          className={cn(
            'flex w-full items-center gap-2 rounded-md p-2 text-sm outline-none hover:bg-sidebar-accent transition-colors',
            className,
          )}
        >
          <Building2 className="size-4 shrink-0 text-sidebar-foreground/70" />
          <span className="flex-1 truncate text-left text-sidebar-foreground">
            {org?.name || 'No Organization'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-sidebar-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          </DropdownMenuGroup>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)}>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {o.id === org?.id && <Check />}
              </span>
              <span className="truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}
          {orgs.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No organizations yet
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateClick}>
            <Plus />
            <span>Create Organization</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Set up a new organization to manage your vaults and teams.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="org-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="org-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My Organization"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="org-slug" className="text-sm font-medium">
                Slug
              </label>
              <Input
                id="org-slug"
                value={slug}
                disabled
                className="font-mono text-xs"
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={!newName.trim() || creating}>
                {creating ? 'Creating\u2026' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
