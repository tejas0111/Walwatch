# Walwatch — Mainnet Deployment Checklist

## Pre-Deployment
### Smart Contracts
- [ ] Professional audit completed with no critical findings
- [ ] All audit findings addressed and verified
- [ ] FeeConfig treasury address set to legitimate multisig
- [ ] storage_price_per_epoch set to accurate mainnet value
- [ ] Protocol fee bps finalized
- [ ] Keeper fee finalized
- [ ] AdminCap transferred to multisig or DAO
- [ ] Move unit tests pass (15/15)
- [ ] Mainnet package published
- [ ] Package ID, System Object ID recorded

### Backend (API)
- [ ] All 115 API tests pass
- [ ] Database migrations applied
- [ ] JWT secret rotated from defaults
- [ ] Rate limiting configured
- [ ] CORS configured for production domain
- [ ] HTTPS enabled
- [ ] Database backups configured
- [ ] Monitoring and alerting active

### Keeper
- [ ] Docker image built and pushed
- [ ] Keeper private key funded with SUI + WAL
- [ ] Database connection configured
- [ ] 2+ keeper instances running with leader election
- [ ] Metrics endpoint healthy
- [ ] Notification channels configured

### UI
- [ ] Next.js build passes (16/16 pages)
- [ ] API client configured with production URL
- [ ] Wallet connection working
- [ ] Analytics configured (if applicable)

### Infrastructure
- [ ] ECS cluster healthy (2 keeper tasks running)
- [ ] RDS PostgreSQL accessible and backed up
- [ ] Prometheus/Grafana dashboards configured
- [ ] CloudWatch alarms active
- [ ] CI/CD pipelines green

## Deployment
- [ ] DNS records updated
- [ ] SSL certificates provisioned
- [ ] API deployment triggered
- [ ] UI deployment triggered
- [ ] Keeper instances started
- [ ] Smoke tests pass on production

## Post-Deployment
- [ ] Monitor for 24 hours
- [ ] Verify first keeper cycle
- [ ] Check all alert channels deliver
- [ ] Review logs for errors
- [ ] Announce launch on social channels
