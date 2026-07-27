# WalWatch Build Plan

## Phase 0: Critical Fixes (Smart Contracts)
- [ ] Fix FeeConfig access control — set_treasury, set_protocol_fee_bps, set_keeper_fee add assert(admin)
- [ ] Fix estimate_renewal_cost — query Walrus System object for real storage pricing
- [ ] Implement Move unit tests for all contract functions

## Phase 1: Backend Expansion (API) ✅ DONE
- [x] Auth (register/login/logout/me + JWT + API key auth)
- [x] Organizations (CRUD + members + RBAC)
- [x] Projects (CRUD + env labels)
- [x] Blob Registrations (CRUD + search/filter/pagination/bulk/export)
- [x] Policies (CRUD + assign/unassign to blobs)
- [x] Wallets (multi-wallet, balance tracking)
- [x] Alerts (notification channels + alert rules)
- [x] Analytics (overview, storage, renewals stubs)
- [x] Audit Logs (paginated, filterable)
- [x] Billing (subscriptions, invoices, usage)
- [x] API Keys (create/list/revoke + SHA-256 key-based auth)

## Phase 2: UI — Real Integration (CURRENT)
- [ ] Professional responsive landing page (hero, features, how-it-works, pricing, CTA)
- [ ] Wallet connection — @mysten/dapp-kit + Sui wallet adapter
- [ ] Real data fetching — Replace mock vault-data.ts with actual API calls
- [ ] Projects page — CRUD, blob grouping, environment labels
- [ ] Blob Explorer — Table with search, filters, bulk operations, tags, metadata
- [ ] Policy engine UI — Create/edit rules, preview matched blobs
- [ ] Wallet management — Add/label wallets, set spending limits, transaction history
- [ ] Notification settings — Configure channels and triggers per project
- [ ] Analytics dashboard — Charts (storage, renewals, costs, forecasts)
- [ ] Auth pages — Login, API key management, team management
- [ ] Billing portal — Plan selection, usage history, invoices
- [ ] Audit log viewer — Searchable event timeline
- [ ] Full responsive design across all pages
- [ ] Tests for UI components

## Phase 3: SDK & CLI
- [ ] TypeScript SDK — walwatch.upload(), walwatch.track(), walwatch.manage()
- [ ] Python / Go / Rust SDKs (later, based on TS SDK)
- [ ] CLI — walwatch login/init/upload/renew/track/import/export/apply/projects/blobs/wallets/status
- [ ] IaC (YAML) — walwatch apply to declare projects, wallets, policies, alerts, API keys

## Phase 4: Infrastructure & Operations
- [ ] Keeper redundancy — Multi-instance keeper with leader election
- [ ] Public metrics page — Status dashboard with uptime/latency/renewal stats
- [ ] Background job monitoring — Queue visibility, retry tracking
- [ ] CI/CD pipelines — GitHub Actions for contracts, API, UI, keeper
- [ ] Terraform Provider + Prometheus/Grafana integration

## Phase 5: Smart Contract Audit + Launch ✅ DONE
- [x] Professional audit — non-negotiable before mainnet
- [x] Testnet dry run — Real users, real Walrus blobs
- [x] Public disclosure — Source, addresses, architecture docs
- [x] Mainnet deploy
