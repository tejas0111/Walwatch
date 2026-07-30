# Contributing to WalWatch

## Development Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in values
3. `docker compose up -d postgres` to start database
4. Install dependencies per component:
   ```bash
   cd api && npm install
   cd ui && npm install
   cd keeper && npm install
   cd sdk && npm install
   cd cli && npm install
   ```
5. Run database migrations: `cd api && npx drizzle-kit push`
6. Start the API: `cd api && npm run dev`

## Project Structure

```
api/          - Hono REST API server
cli/          - Command-line tool
contracts/    - Move smart contracts
docs/         - Documentation
infra/        - Terraform infrastructure
keeper/       - Blockchain scanner/executor
sdk/          - TypeScript client SDK
ui/           - Next.js web application
```

## Code Style

- TypeScript strict mode
- ESM imports with .js extension
- Prettier + ESLint
- Follow existing patterns in each component

## Commit Message Convention

Use conventional commits: `type(scope): description`

- `feat(api): add refresh token rotation`
- `fix(keeper): handle insufficient balance gracefully`
- `docs(contracts): update audit findings`
- `chore(infra): bump Terraform provider version`

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`, `ci`, `build`

## Testing

```bash
# API tests (PostgreSQL Testcontainers)
cd api && npx vitest run

# Keeper tests
cd keeper && npx vitest run

# Contract tests
cd contracts && sui move test

# SDK tests
cd sdk && npx vitest run

# CLI tests
cd cli && npx vitest run

# TypeScript compilation check (all components)
cd api && npx tsc --noEmit
cd keeper && npx tsc --noEmit
cd sdk && npx tsc --noEmit
cd cli && npx tsc --noEmit
```

## Pull Request Process

1. Write tests for new functionality
2. Ensure all existing tests pass
   - `cd api && npx vitest run`
   - `cd keeper && npx vitest run`
   - `cd contracts && sui move test`
3. Run TypeScript compilation: `npx tsc --noEmit` in each affected component
4. Update documentation (README, JSDoc, deployment docs)
5. Request review from maintainers

### PR Review Checklist

- [ ] Tests pass for all affected components
- [ ] TypeScript compiles without errors
- [ ] New endpoints have JSDoc comments
- [ ] Database migrations are backwards-compatible
- [ ] Error messages are user-friendly (no stack traces leaked)
- [ ] Audit logging added for mutations
- [ ] Zod validation schemas cover edge cases
- [ ] No secrets or credentials committed
- [ ] Commit messages follow conventional commit format
