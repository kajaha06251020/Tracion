# Contributing to Traceforge

Thank you for contributing! This guide gets you from zero to first PR in under 15 minutes.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- Node.js ≥ 20 (for tooling only)
- Python ≥ 3.11 (SDK contributions only)

## Local Setup

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/traceforge && cd traceforge

# 2. Install dependencies
bun install

# 3. Copy environment template
cp .env.example .env

# 4. Start infrastructure
docker compose -f docker-compose.dev.yml up -d

# 5. Run migrations
cd apps/api && bun run db:migrate

# 6. Start dev servers
bun run dev   # starts api + web concurrently
```

Open http://localhost:3000 — you're ready.

## Making Changes

1. Create a branch: `git checkout -b feat/your-feature`
2. Write a failing test first (TDD preferred)
3. Implement the minimum code to pass the test
4. Run `bun run test && bun run typecheck && bun run lint`
5. Commit using Conventional Commits: `git commit -m "feat: add X"`
6. Open a PR against `develop`

## PR Guidelines

- Keep PRs focused — one feature or fix per PR
- All CI checks must pass before review
- Add or update tests for every change
- Update `.env.example` if you add env vars
- Update `CLAUDE.md` if you change architecture
- Link related issues with `Closes #123`

## Commit Message Format

```
<type>(<scope>): <short summary>

Types: feat | fix | docs | chore | test | refactor | perf
Scope: api | web | sdk | mcp | infra (optional)

Examples:
  feat(api): add OTel span ingest endpoint
  fix(web): resolve graph layout overflow on mobile
  docs: update quick start command
```

## Reporting Issues

Use GitHub Issues with the appropriate template:

- **Bug Report** — unexpected behavior with steps to reproduce
- **Feature Request** — describe the use case, not just the solution
- **Question** — for everything else

## First-Time Contributors

Look for issues tagged `good first issue`. These are intentionally small and well-scoped.

## Code of Conduct

Be kind. We follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
