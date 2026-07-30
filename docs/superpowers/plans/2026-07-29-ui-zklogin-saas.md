# UI: zkLogin SaaS Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wallet-connect UX with a deposit-address model, add OAuth login, and add self-serve key recovery — all while making the blockchain invisible to users.

**Architecture:** Rewrite `wallet-button.tsx` to show deposit address + balance, update vault creation/detail pages to talk to the new API flow, add Google/GitHub OAuth buttons to auth pages, update billing for Stripe, and add key export to settings. No direct Sui client imports — all blockchain interaction goes through the API.

**Tech Stack:** Next.js (App Router), React, shadcn/ui primitives, Tailwind CSS, `@mysten/dapp-kit` retained for power users only

## Global Constraints

- All blockchain operations go through the API — no direct `@mysten/sui` imports in UI code
- `@mysten/dapp-kit` is kept ONLY for the power-user path (direct wallet connection); the default path uses zero wallet interaction
- Every API call that creates/modifies on-chain state shows a loading state and the resulting digest (not a fake "success")
- Auth pages must support both email/password (existing) and OAuth (new) — OAuth is the primary recommended path
- Key export page must clearly warn the user about the security implications
- Wire up with `@/lib/api-client` — add new methods for OAuth login, vault create, key export

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `ui/components/dashboard/wallet-button.tsx` | Rewrite | Show deposit address + WAL balance instead of "Connect Wallet" |
| `ui/components/dashboard/connect-wallet-prompt.tsx` | Modify | Add "Connect external wallet" for power users |
| `ui/app/dashboard/new/page.tsx` | Modify | Wire vault creation to new API flow (real tx confirmation) |
| `ui/app/dashboard/vaults/[id]/page.tsx` | Modify | Wire deposit to actually work; show withdraw UI |
| `ui/app/dashboard/vaults/page.tsx` | Modify | Show on-chain vault status (confirmed/pending) |
| `ui/app/login/page.tsx` | Modify | Add "Sign in with Google" / "Sign in with GitHub" buttons |
| `ui/app/register/page.tsx` | Modify | Add "Sign up with Google" / "Sign up with GitHub" buttons |
| `ui/app/dashboard/billing/page.tsx` | Modify | Wire to Stripe pricing (if Stripe is integrated) |
| `ui/app/dashboard/settings/page.tsx` | Modify | Add OAuth linking section, add key export section |
| `ui/app/dashboard/wallets/page.tsx` | Modify | Show deposit address + connected external wallets |
| `ui/lib/api-client.ts` | Modify | Add `loginWithGoogle`, `createVaultAndSubmit`, `exportKey`, `linkOAuth` methods |
| `ui/components/dashboard/vault-create-form.tsx` | Create | Extracted vault creation form component with real tx flow |
| `ui/components/dashboard/deposit-address-card.tsx` | Create | Shows deposit address, copy button, balance, recent deposits |

---

### Task 1: Update API client with new methods

**Files:**
- Modify: `ui/lib/api-client.ts`

**Interfaces:**
- Consumes: Existing API client pattern (fetch with JWT)
- Produces: `loginWithGoogle(idToken): { token, user }`
- Produces: `loginWithGithub(code): { token, user }`
- Produces: `createVaultAndSubmit(params): { vaultId, digest, status }`
- Produces: `exportKey(): { ephemeralKey, zkloginProof, jwtRandomness, maxEpoch }`
- Produces: `linkOAuth(idToken, provider): { message, zkloginAddress }`
- Produces: `getWalletBalance(): { address, balance, recentDeposits }`
- Produces: `initiateWithdraw(vaultId, amount): { digest }`

- [ ] **Step 1: Add new API methods**

```typescript
// ui/lib/api-client.ts — add to the ApiClient class

export class ApiClient {
  // ... existing methods ...

  async loginWithGoogle(idToken: string): Promise<{ token: string; user: { id: string; email: string; zkloginAddress: string } }> {
    const res = await fetch(`${this.baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error('Google login failed');
    const data = await res.json();
    localStorage.setItem('token', data.token);
    this.token = data.token;
    return data;
  }

  async createVault(params: {
    blobId: string;
    amount: number;
    threshold: number;
    extension: number;
    maxEpochs?: number;
  }): Promise<{ vaultId: string; digest: string; status: string }> {
    return this.post('/vaults', params);
  }

  async exportKey(): Promise<{
    ephemeralKey: string;
    zkloginProof: string;
    jwtRandomness: string;
    maxEpoch: number;
    zkloginAddress: string;
    expiresAt: string;
    warning: string;
  }> {
    return this.get('/keys/export');
  }

  async getWalletInfo(): Promise<{
    address: string;
    balance: string;
    recentDeposits: Array<{ amount: string; timestamp: string; digest: string }>;
  }> {
    return this.get('/wallets/info');
  }

  async initiateWithdraw(vaultId: string, amount: number): Promise<{ digest: string }> {
    return this.post(`/vaults/${vaultId}/withdraw`, { amount });
  }

  async linkOAuth(idToken: string, provider: string): Promise<{ message: string; zkloginAddress: string }> {
    return this.post('/auth/link', { idToken, provider });
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/lib/api-client.ts
git commit -m "feat(ui): add zkLogin, vault creation, key export and wallet API methods"
```

---

### Task 2: Rewrite wallet-button to show deposit address

**Files:**
- Rewrite: `ui/components/dashboard/wallet-button.tsx`
- Modify: `ui/components/dashboard/connect-wallet-prompt.tsx`

- [ ] **Step 1: Rewrite wallet-button.tsx**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, ExternalLink, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';

export function WalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWalletInfo()
      .then(info => {
        setAddress(info.address);
        setBalance(info.balance);
      })
      .catch(() => setAddress(null))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!address) {
    return (
      <Card>
        <CardContent className="p-4 text-center">
          <Wallet className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No deposit address yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Sign in with Google to get one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Deposit Address</h3>
          <span className="text-xs text-muted-foreground">
            Balance: <strong>{Number(balance).toLocaleString()} WAL</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 bg-muted rounded-md p-2">
          <code className="text-xs flex-1 truncate font-mono">{address}</code>
          <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy address">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" asChild title="View on Suiscan">
            <a href={`https://testnet.suiscan.xyz/account/${address}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Send WAL to this address from any wallet or exchange.
          Once the deposit is confirmed, you can create a vault.
        </p>

        <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400 rounded-md p-2">
          Walwatch can create vaults and trigger renewals on your behalf.
          Withdrawals are capped per your plan tier.
          <a href="/dashboard/settings?tab=security" className="underline ml-1">Learn more</a>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Update connect-wallet-prompt for power users**

```tsx
// ui/components/dashboard/connect-wallet-prompt.tsx

'use client';

import { useCurrentAccount, useConnectWallet, useWallets } from '@mysten/dapp-kit';

export function ConnectWalletPrompt({ compact = false }: { compact?: boolean }) {
  const account = useCurrentAccount();
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();

  if (account) {
    return (
      <div className="text-sm text-muted-foreground">
        Connected: <span className="font-mono">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
        <span className="text-xs ml-2">(power user — full self-custody)</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        For power users who want full self-custody:
      </p>
      <div className="flex flex-wrap gap-2">
        {wallets.map(wallet => (
          <button
            key={wallet.name}
            onClick={() => connect({ wallet })}
            className="text-xs px-3 py-1.5 border rounded-md hover:bg-muted"
          >
            Connect {wallet.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/components/dashboard/wallet-button.tsx ui/components/dashboard/connect-wallet-prompt.tsx
git commit -m "feat(ui): rewrite wallet-button to show deposit address + balance"
```

---

### Task 3: Update vault creation page for real tx flow

**Files:**
- Modify: `ui/app/dashboard/new/page.tsx`
- Create: `ui/components/dashboard/vault-create-form.tsx`

- [ ] **Step 1: Create vault create form component**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export function VaultCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    blobId: '',
    amount: '',
    threshold: '5',
    extension: '10',
    maxEpochs: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ vaultId: string; digest: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.createVault({
        blobId: form.blobId,
        amount: Number(form.amount),
        threshold: Number(form.threshold),
        extension: Number(form.extension),
        maxEpochs: form.maxEpochs ? Number(form.maxEpochs) : undefined,
      });

      setResult(res);

      // Wait 2 seconds for the user to see the result, then navigate
      setTimeout(() => {
        router.push(`/dashboard/vaults/${res.vaultId}`);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vault creation failed');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          <CardTitle>Vault Created!</CardTitle>
          <CardDescription>
            Transaction confirmed on Sui testnet.
          </CardDescription>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Vault ID: <code className="text-xs">{result.vaultId}</code></p>
            <p>Digest: <code className="text-xs">{result.digest}</code></p>
            <p>Status: <span className="text-green-500">{result.status}</span></p>
          </div>
          <Button variant="outline" asChild>
            <a href={`https://testnet.suiscan.xyz/object/${result.vaultId}`} target="_blank" rel="noopener noreferrer">
              View on Suiscan
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">Redirecting to vault details...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Auto-Renewal Vault</CardTitle>
        <CardDescription>
          Fund a vault with WAL to automatically renew your blob storage.
          All transactions are signed for you — no wallet needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Same form fields as existing page, but with real submission */}
          <div>
            <Label htmlFor="blobId">Blob ID</Label>
            <Input id="blobId" value={form.blobId} onChange={e => setForm(f => ({ ...f, blobId: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="amount">Initial WAL Deposit</Label>
            <Input id="amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="threshold">Renew Threshold (epochs)</Label>
              <Input id="threshold" type="number" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="extension">Extension (epochs)</Label>
              <Input id="extension" type="number" value={form.extension} onChange={e => setForm(f => ({ ...f, extension: e.target.value }))} required />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md p-3">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating vault...</> : 'Create Vault'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Update the page to use the new form**

```tsx
// ui/app/dashboard/new/page.tsx — replace content:
import { VaultCreateForm } from '@/components/dashboard/vault-create-form';

export default function NewVaultPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <VaultCreateForm />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/app/dashboard/new/page.tsx ui/components/dashboard/vault-create-form.tsx
git commit -m "feat(ui): vault creation page with real tx confirmation"
```

---

### Task 4: Update vault detail page for deposit + withdraw

**Files:**
- Modify: `ui/app/dashboard/vaults/[id]/page.tsx`

- [ ] **Step 1: Add deposit and withdraw UI**

```tsx
'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function VaultDetailPage({ params }: { params: { id: string } }) {
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [depositDigest, setDepositDigest] = useState<string | null>(null);
  const [withdrawDigest, setWithdrawDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeposit = async () => {
    setDepositing(true);
    setError(null);
    try {
      // API call to deposit — the API builds, signs, and submits the tx
      const result = await api.depositToVault(params.id, Number(depositAmount));
      setDepositDigest(result.digest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deposit failed');
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setError(null);
    try {
      const result = await api.initiateWithdraw(params.id, Number(withdrawAmount));
      setWithdrawDigest(result.digest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Existing vault info display — keep as-is */}

      <Card>
        <CardHeader>
          <CardTitle>Deposit WAL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="number"
            placeholder="Amount in WAL"
            value={depositAmount}
            onChange={e => setDepositAmount(e.target.value)}
          />
          <Button onClick={handleDeposit} disabled={depositing || !depositAmount}>
            {depositing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</> : 'Deposit'}
          </Button>
          {depositDigest && (
            <p className="text-sm text-green-500 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Deposited. Digest: {depositDigest.slice(0, 10)}...
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Withdraw WAL</CardTitle>
          <p className="text-sm text-muted-foreground">
            Requires recent sign-in (session &lt; 15 min). Subject to plan limits.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="number"
            placeholder="Amount in WAL"
            value={withdrawAmount}
            onChange={e => setWithdrawAmount(e.target.value)}
          />
          <Button onClick={handleWithdraw} disabled={withdrawing || !withdrawAmount} variant="secondary">
            {withdrawing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Initiating...</> : 'Withdraw'}
          </Button>
          {withdrawDigest && (
            <p className="text-sm text-yellow-600 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Withdrawal initiated. Delay applies. Digest: {withdrawDigest.slice(0, 10)}...
            </p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/app/dashboard/vaults/[id]/page.tsx
git commit -m "feat(ui): add deposit and withdraw UI to vault detail page"
```

---

### Task 5: Add OAuth login buttons to auth pages

**Files:**
- Modify: `ui/app/login/page.tsx`
- Modify: `ui/app/register/page.tsx`

- [ ] **Step 1: Create OAuth button component**

```tsx
// Create at ui/components/auth/oauth-buttons.tsx

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { GoogleLogo, GitHubLogo } from '@/components/icons'; // or use lucide-react + custom SVGs
import { Loader2 } from 'lucide-react';

export function OAuthButtons({ mode = 'login' }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading('google');
    try {
      // Use OAuth authorization code flow (NOT implicit flow — implicit returns
      // the token in the URL fragment #... which the server can't read, and
      // exposes the ID token in the browser history). Auth code flow returns
      // a single-use code in the query string ?code=..., which the server
      // exchanges for tokens server-side, keeping all secrets server-side.
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      const redirectUri = `${window.location.origin}/auth/callback/google`;
      const state = crypto.randomUUID(); // anti-CSRF
      // Store state in sessionStorage to verify on return
      sessionStorage.setItem('oauth_state', state);
      window.location.href =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&redirect_uri=${redirectUri}&` +
        `response_type=code&scope=openid%20email%20profile&` +
        `state=${state}`;
    } catch (err) {
      console.error('Google login failed', err);
    } finally {
      setLoading(null);
    }
  };

  const handleGitHubLogin = async () => {
    setLoading('github');
    try {
      const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
      const redirectUri = `${window.location.origin}/auth/callback/github`;
      const state = crypto.randomUUID();
      sessionStorage.setItem('oauth_state', state);
      window.location.href =
        `https://github.com/login/oauth/authorize?` +
        `client_id=${clientId}&redirect_uri=${redirectUri}&` +
        `scope=read:user%20user:email&state=${state}`;
    } catch (err) {
      console.error('GitHub login failed', err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading !== null}>
        {loading === 'google' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
      </Button>

      <Button variant="outline" className="w-full" onClick={handleGitHubLogin} disabled={loading !== null}>
        {loading === 'github' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {mode === 'login' ? 'Sign in with GitHub' : 'Sign up with GitHub'}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add OAuth buttons to login and register pages**

```tsx
// ui/app/login/page.tsx — add after existing email/password form:
import { OAuthButtons } from '@/components/auth/oauth-buttons';

export default function LoginPage() {
  return (
    <div>
      {/* ... existing email/password form ... */}
      <OAuthButtons mode="login" />
    </div>
  );
}
```

- [ ] **Step 3: Create callback handler page**

```tsx
// Create ui/app/auth/callback/google/page.tsx
// Uses authorization code flow — Google redirects with ?code=... in query params
// (not implicit flow, which puts the token in the URL fragment #id_token=...
// that useSearchParams can't read). The code is sent to the server-side API
// which exchanges it for tokens, creates/updates the user, and returns a JWT.

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Loader2, AlertCircle } from 'lucide-react';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');
  const state = searchParams.get('state');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Verify anti-CSRF state parameter
    const savedState = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');
    if (state && savedState && state !== savedState) {
      setError('Security check failed. Please try again.');
      return;
    }

    if (errorParam) {
      setError('Google sign-in was cancelled or failed.');
      return;
    }

    if (code) {
      api.loginWithGoogle(code)
        .then(() => router.push('/dashboard'))
        .catch(() => setError('Authentication failed. Please try again.'));
    }
  }, [code, errorParam, state, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-red-500">{error}</p>
        <button onClick={() => router.push('/login')} className="text-sm underline">
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="ml-2">Completing sign-in...</p>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/app/login/page.tsx ui/app/register/page.tsx ui/components/auth/ ui/app/auth/
git commit -m "feat(ui): add OAuth login buttons and callback handler"
```

---

### Task 6: Update settings page — OAuth linking + key export

**Files:**
- Modify: `ui/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Add OAuth linking section to settings**

```tsx
// In the settings page, add a "Security" section:

function SecuritySection() {
  const [exporting, setExporting] = useState(false);
  const [exportedKey, setExportedKey] = useState<{ key: string; warning: string } | null>(null);

  const handleExportKey = async () => {
    setExporting(true);
    try {
      const data = await api.exportKey();
      setExportedKey({ key: data.ephemeralKey, warning: data.warning });
    } catch (err) {
      // Show error
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>OAuth Accounts</CardTitle>
          <CardDescription>Link your Google or GitHub account for zkLogin</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span>Google</span>
            <Button variant="outline" size="sm" onClick={handleLinkGoogle}>
              {user.oauthProvider === 'google' ? 'Connected' : 'Link'}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span>GitHub</span>
            <Button variant="outline" size="sm" onClick={handleLinkGithub}>
              {user.oauthProvider === 'github' ? 'Connected' : 'Link'}
            </Button>
          </div>
          {user.zkloginAddress && (
            <p className="text-xs text-muted-foreground">
              zkLogin address: <code className="text-xs">{user.zkloginAddress}</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export Ephemeral Key</CardTitle>
          <CardDescription>
            Export your ephemeral key for self-custody recovery.
            Rate-limited to once every 7 days. Requires recent sign-in.
            Keep this key secure — it grants full signing authority.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="destructive" onClick={handleExportKey} disabled={exporting}>
            {exporting ? 'Decrypting...' : 'Export Key'}
          </Button>

          {exportedKey && (
            <div className="space-y-2">
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">⚠ {exportedKey.warning}</p>
              </div>
              <textarea
                className="w-full h-32 font-mono text-xs bg-muted rounded-md p-2"
                readOnly
                value={exportedKey.key}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(exportedKey.key)}>
                  Copy Key
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExportedKey(null)} className="text-muted-foreground">
                  Clear
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/app/dashboard/settings/page.tsx
git commit -m "feat(ui): add OAuth linking and key export to settings"
```

---

### Task 7: Update wallets page for deposit address model

**Files:**
- Modify: `ui/app/dashboard/wallets/page.tsx`

- [ ] **Step 1: Rewrite wallets page**

```tsx
'use client';

import { WalletButton } from '@/components/dashboard/wallet-button';
import { ConnectWalletPrompt } from '@/components/dashboard/connect-wallet-prompt';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function WalletsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-muted-foreground">Manage your WAL deposits and connected wallets.</p>
      </div>

      <WalletButton />

      <Card>
        <CardHeader>
          <CardTitle>Power User: External Wallet</CardTitle>
          <CardDescription>
            Connect your own Sui wallet for full self-custody.
            All on-chain operations will require your signature.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectWalletPrompt />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/app/dashboard/wallets/page.tsx
git commit -m "feat(ui): update wallets page for deposit address model"
```

---

### Task 8: Update billing page for Stripe

**Files:**
- Modify: `ui/app/dashboard/billing/page.tsx`

- [ ] **Step 1: Add Stripe pricing UI**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Check } from 'lucide-react';

// WITHDRAW LIMIT LABELS MUST MATCH rate-limiter.ts's planLimits table (the single source of truth).
// These are per-TX limits, displayed as "per tx" for accuracy. The design doc §7.2 is authoritative.
const plans = [
  { name: 'Free', price: '$0', features: ['1 project', '5 blobs', 'Community support', '100 WAL per tx withdraw cap (500 WAL/day)'] },
  { name: 'Pro', price: '$29/mo', features: ['5 projects', '50 blobs', 'Email support', 'API access', '1,000 WAL per tx withdraw cap (5,000 WAL/day)'] },
  { name: 'Team', price: '$99/mo', features: ['20 projects', 'Unlimited blobs', 'Priority support', 'SSO', '5,000 WAL per tx withdraw cap (25,000 WAL/day)'] },
];

export default function BillingPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async (planName: string) => {
    setSelected(planName);
    setLoading(true);
    try {
      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planName.toLowerCase() }),
      });
      const { url } = await res.json();
      window.location.href = url; // Redirect to Stripe Checkout
    } catch (err) {
      console.error('Checkout failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Choose a plan that fits your team.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map(plan => (
          <Card key={plan.name} className={selected === plan.name ? 'border-primary' : ''}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription className="text-2xl font-bold">{plan.price}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="w-full" onClick={() => handleSubscribe(plan.name)} disabled={loading}>
                {loading ? 'Redirecting...' : plan.name === 'Free' ? 'Current Plan' : 'Subscribe'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/app/dashboard/billing/page.tsx
git commit -m "feat(ui): add Stripe pricing tier cards to billing page"
```
