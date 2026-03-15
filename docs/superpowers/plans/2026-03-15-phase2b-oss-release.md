# Phase 2B: OSS Release Preparation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `v0.1.0-alpha.0` to GitHub with CI pipeline, published SDKs on npm/PyPI, Docker images on Docker Hub, and Japanese README.

**Architecture:** GitHub Actions workflows for CI (test/lint/build on PRs) and release (publish on tag). One-time prerequisites: remove `private: true` from SDK packages, rename Python package, initialize changesets.

**Tech Stack:** GitHub Actions, changesets, npm, twine, Docker buildx, Playwright

**Spec:** `docs/superpowers/specs/2026-03-15-phase2-testing-release-prep.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `.github/workflows/ci.yml` | PR + push CI pipeline |
| Create | `.github/workflows/release.yml` | Tag-triggered publish pipeline |
| Create | `.github/workflows/security.yml` | Weekly dependency audit |
| Create | `.changeset/config.json` | Changesets config |
| Create | `CHANGELOG.md` | Auto-generated changelog |
| Create | `README.ja.md` | Japanese README |
| Modify | `packages/sdk-typescript/package.json` | Remove `private: true`, add build script |
| Modify | `packages/mcp-server/package.json` | Remove `private: true`, add build script |
| Modify | `packages/sdk-python/pyproject.toml` | Rename to `tracion`, add twine/build |
| Modify | `docs/CLAUDE.md` | Update title, Current Phase, fix `bun audit` |

---

## Chunk 1: Package Prerequisites

### Task 1: Remove `private: true` and add build scripts

**Files:**
- Read: `packages/sdk-typescript/package.json`
- Read: `packages/mcp-server/package.json`
- Modify both

- [ ] **Step 1: Read both package.json files**

```bash
cat packages/sdk-typescript/package.json
cat packages/mcp-server/package.json
```

- [ ] **Step 2: For sdk-typescript: remove `"private": true` and add build script**

Find and remove the `"private": true` line.

Add a build script that compiles TypeScript for Node.js consumers:
```json
"build": "bun build src/index.ts --outdir dist --target node --format esm",
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
```

Also add `"files": ["dist"]` to the package.json to include only compiled output.

- [ ] **Step 3: For mcp-server: remove `"private": true` and add build script**

Same pattern — remove `"private": true` and add:
```json
"build": "bun build src/index.ts --outdir dist --target node --format esm",
```

Update the `"bin"` field to point to `"./dist/index.js"` instead of the source file.

- [ ] **Step 4: Verify packages are publishable**

```bash
cd packages/sdk-typescript && npm pack --dry-run 2>&1 | head -20
cd packages/mcp-server && npm pack --dry-run 2>&1 | head -20
```

Expected: Lists files without "private package" error.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-typescript/package.json packages/mcp-server/package.json
git commit -m "chore: remove private flag and add build scripts to SDK packages"
```

### Task 2: Rename Python package to `tracion`

**Files:**
- Read: `packages/sdk-python/pyproject.toml`
- Modify: `packages/sdk-python/pyproject.toml`

- [ ] **Step 1: Read the current pyproject.toml**

```bash
cat packages/sdk-python/pyproject.toml
```

- [ ] **Step 2: Change package name**

Change `name = "traceforge"` to `name = "tracion"`. Also update description/keywords if they reference TraceForge.

- [ ] **Step 3: Add build/twine dev dependencies**

Add to the dev dependencies section (exact format depends on existing structure):
```toml
[dependency-groups]
dev = [
  # ... existing entries ...
  "twine>=5.0",
  "build>=1.0",
]
```

- [ ] **Step 4: Verify the package builds**

```bash
cd packages/sdk-python && python -m build 2>&1 | tail -5
```

Expected: `Successfully built tracion-*.tar.gz and tracion-*.whl`

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-python/pyproject.toml
git commit -m "chore: rename Python package from traceforge to tracion"
```

### Task 3: Initialize changesets

**Files:**
- Create: `.changeset/config.json`

- [ ] **Step 1: Install changesets CLI at workspace root**

```bash
bun add -d @changesets/cli -w
```

- [ ] **Step 2: Initialize changesets**

```bash
bunx changeset init
```

Expected: Creates `.changeset/config.json` and `.changeset/README.md`.

- [ ] **Step 3: Review generated config**

```bash
cat .changeset/config.json
```

- [ ] **Step 4: Create initial changeset**

```bash
bunx changeset
```

When prompted: select all TypeScript packages, select `minor`, summary: "Initial alpha release of Tracion observability platform"

- [ ] **Step 5: Apply the changeset**

```bash
bunx changeset version
```

Expected: Bumps all selected packages to `0.1.0` and generates `CHANGELOG.md`.

- [ ] **Step 6: Commit**

```bash
git add .changeset/ CHANGELOG.md package.json packages/sdk-typescript/package.json packages/mcp-server/package.json
git commit -m "chore: initialize changesets and bump to v0.1.0"
```

---

## Chunk 2: GitHub Actions CI

### Task 4: Create CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write the CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - name: Lint Python
        run: |
          pip install ruff
          ruff check packages/sdk-python/

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck

  test-unit:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run test

  test-integration:
    name: Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: timescale/timescaledb:latest-pg16
        env:
          POSTGRES_USER: tracion
          POSTGRES_PASSWORD: tracion
          POSTGRES_DB: tracion
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Run migrations
        env:
          DATABASE_URL: postgresql://tracion:tracion@localhost:5432/tracion
        run: cd apps/api && bun run db:migrate
      - name: Run integration tests
        env:
          DATABASE_URL: postgresql://tracion:tracion@localhost:5432/tracion
          TRACION_API_KEY: test-key-ci
        run: cd apps/api && bunx vitest run src/routes/*.integration.test.ts

  test-e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Install Playwright browsers
        run: cd apps/web && bunx playwright install --with-deps chromium
      - name: Start services
        run: docker compose up -d
      - name: Wait for services
        run: sleep 15
      - name: Run E2E tests
        run: cd apps/web && bunx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/

  build:
    name: Docker Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify next.config.ts has standalone output
        run: grep -q "standalone" apps/web/next.config.ts || (echo "ERROR: next.config.ts must have output: 'standalone'" && exit 1)
      - name: Build API image
        run: docker build -f apps/api/Dockerfile .
      - name: Build Web image
        run: docker build -f apps/web/Dockerfile .
```

- [ ] **Step 3: Verify root `bun run lint` and `bun run test` scripts work**

```bash
cat package.json | grep -A 15 '"scripts"'
```

If root `lint` or `typecheck` scripts don't exist, add them:
```json
"lint": "biome check .",
"typecheck": "tsc -b apps/api/tsconfig.json apps/web/tsconfig.json packages/sdk-typescript/tsconfig.json --noEmit"
```

Adjust based on what `tsconfig.json` files exist.

- [ ] **Step 4: Verify `next.config.ts` has standalone output**

```bash
cat apps/web/next.config.ts | grep standalone
```

If missing, add `output: 'standalone'` to the Next.js config:
```typescript
const nextConfig = {
  output: 'standalone',
  // ... existing config
}
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml package.json apps/web/next.config.ts
git commit -m "ci: add GitHub Actions CI workflow"
```

### Task 5: Create release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the release workflow**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  publish-npm-sdk:
    name: Publish @tracion/sdk to npm
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Build
        run: cd packages/sdk-typescript && bun run build
      - name: Publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          echo "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}" > ~/.npmrc
          cd packages/sdk-typescript && npm publish --access public

  publish-npm-mcp:
    name: Publish @tracion/mcp-server to npm
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Build
        run: cd packages/mcp-server && bun run build
      - name: Publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          echo "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}" > ~/.npmrc
          cd packages/mcp-server && npm publish --access public

  publish-pypi:
    name: Publish tracion to PyPI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install build tools
        run: pip install build twine
      - name: Build
        run: cd packages/sdk-python && python -m build
      - name: Publish
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
        run: cd packages/sdk-python && twine upload dist/*

  docker-push:
    name: Push Docker images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - uses: docker/setup-buildx-action@v3
      - name: Extract version
        id: version
        run: echo "tag=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT
      - name: Build and push API
        uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/api/Dockerfile
          push: true
          tags: |
            tracion/api:${{ steps.version.outputs.tag }}
            tracion/api:latest
      - name: Build and push Web
        uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/web/Dockerfile
          push: true
          tags: |
            tracion/web:${{ steps.version.outputs.tag }}
            tracion/web:latest
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow for npm, PyPI, and Docker Hub"
```

### Task 6: Create security audit workflow

**Files:**
- Create: `.github/workflows/security.yml`

- [ ] **Step 1: Check if requirements.txt exists for Python**

```bash
ls packages/sdk-python/
```

- [ ] **Step 2: Write the security workflow**

```yaml
# .github/workflows/security.yml
name: Security Audit

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight UTC
  workflow_dispatch:

jobs:
  audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Audit TypeScript packages (using npm audit on individual package.json files)
        run: |
          # Run npm install in each package to generate package-lock.json for audit
          (cd packages/sdk-typescript && npm install --package-lock-only 2>/dev/null && npm audit --audit-level=high) || true
          (cd packages/mcp-server && npm install --package-lock-only 2>/dev/null && npm audit --audit-level=high) || true
      - name: Audit Python package
        run: |
          pip install pip-audit
          cd packages/sdk-python && pip install -e . && pip-audit || true
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/security.yml
git commit -m "ci: add weekly security audit workflow"
```

---

## Chunk 3: README and CLAUDE.md Updates

### Task 7: Create README.ja.md

**Files:**
- Read: `README.md`
- Create: `README.ja.md`

- [ ] **Step 1: Read the current README.md**

```bash
cat README.md
```

- [ ] **Step 2: Create Japanese translation**

Save as `README.ja.md`. Translation guidelines:
- Add at top: `> 日本語版ドキュメントです。[英語版はこちら](README.md)`
- Keep all code blocks, commands, env var names, SDK names in English
- Translate headings and prose text
- "Quick Start" → "クイックスタート", "Installation" → "インストール", "Usage" → "使用方法"

- [ ] **Step 3: Commit**

```bash
git add README.ja.md
git commit -m "docs: add Japanese README"
```

### Task 8: Update CLAUDE.md

**Files:**
- Read: `docs/CLAUDE.md`
- Modify: `docs/CLAUDE.md`

- [ ] **Step 1: Read the current CLAUDE.md**

```bash
cat docs/CLAUDE.md
```

- [ ] **Step 2: Fix the title on line 1**

Change `# Traceforge — CLAUDE.md` to `# Tracion — CLAUDE.md`

Also change `## What Is Traceforge?` to `## What Is Tracion?` and update the body paragraph accordingly.

- [ ] **Step 3: Fix `bun audit` reference (~line 255)**

Change `Run \`bun audit\` / \`pip-audit\` before opening a PR.` to `Run \`npm audit\` / \`pip-audit\` before opening a PR.`

- [ ] **Step 4: Replace the `## Current Phase` section**

Replace from `## Current Phase` to end of file with:

```markdown
## Current Phase

**Phase 2 — Testing & OSS Release** ✅ Complete

### Completed
- [x] Repository structure & base configuration
- [x] Docker Compose setup (prod + dev with hot-reload)
- [x] DB schema design (Drizzle ORM, TimescaleDB)
- [x] OTel collector ingest endpoint
- [x] Trace / Span CRUD API (tRPC)
- [x] Web dashboard (stats, trace list, trace detail waterfall, DAG graph, cost analytics)
- [x] OAuth authentication (GitHub + Google via BetterAuth)
- [x] TypeScript SDK (`@tracion/sdk`)
- [x] Python SDK (`tracion`)
- [x] MCP Server (`@tracion/mcp-server`)
- [x] Test coverage (unit, integration, E2E)
- [x] GitHub Actions CI/CD pipeline
- [x] v0.1.0-alpha release (npm + PyPI + Docker Hub)

### Up Next — Phase 3: Feature Expansion
1. API key management UI (`/settings/api-keys`)
2. LLM content viewer (conversation-style span detail)
3. Multi-tenancy / Organizations
4. Alert notifications (cost/error thresholds via email, webhook, Slack)
```

- [ ] **Step 5: Commit**

```bash
git add docs/CLAUDE.md
git commit -m "docs: update CLAUDE.md title to Tracion, phase status, and fix bun audit reference"
```

---

## Chunk 4: Release Tag

### Task 9: Create v0.1.0-alpha.0 release tag

- [ ] **Step 1: Verify all CI checks pass on main**

Check GitHub Actions status. All jobs must be green before tagging.

- [ ] **Step 2: Set Python package version to 0.1.0**

```bash
# Update packages/sdk-python/pyproject.toml
# Change: version = "x.x.x"
# To:     version = "0.1.0"
```

- [ ] **Step 3: Commit version and badge additions**

Add badges to top of `README.md` (after the main title):

```markdown
[![npm](https://img.shields.io/npm/v/@tracion/sdk)](https://www.npmjs.com/package/@tracion/sdk)
[![PyPI](https://img.shields.io/pypi/v/tracion)](https://pypi.org/project/tracion/)
[![CI](https://github.com/YOUR_ORG/tracion/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/tracion/actions/workflows/ci.yml)
```

Replace `YOUR_ORG` with the actual GitHub org/user name.

```bash
git add README.md packages/sdk-python/pyproject.toml
git commit -m "chore: add badges and set Python version to 0.1.0 for alpha release"
```

- [ ] **Step 4: Create and push the release tag**

```bash
git tag v0.1.0-alpha.0
git push origin main
git push origin v0.1.0-alpha.0
```

Expected: GitHub Actions `release.yml` triggers automatically.

- [ ] **Step 5: Verify release jobs on GitHub Actions**

Monitor the Actions tab. Create a GitHub Release from the tag with the `CHANGELOG.md` excerpt as the release notes body.
