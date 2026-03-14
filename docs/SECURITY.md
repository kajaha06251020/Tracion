# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` branch | ✅ Yes |
| < v0.1.0 | ❌ No |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please use one of the following:
- **GitHub Private Security Advisory**: [github.com/<org>/traceforge/security/advisories/new](https://github.com/<org>/traceforge/security/advisories/new)
- **Email**: security@traceforge.dev

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

We will acknowledge receipt within **48 hours** and aim to release a patch within **14 days** of confirmation.

## Scope

**In scope:**
- API endpoints (authentication, authorization, data isolation)
- SDK packages (`@traceforge/sdk`, `traceforge`, `traceforge-mcp`)
- MCP server
- Docker Compose configuration exposing sensitive data

**Out of scope:**
- Denial of service attacks
- Social engineering
- Vulnerabilities in upstream dependencies not controlled by this project
- Issues requiring physical access to the host machine

## Disclosure Policy

We follow [Coordinated Vulnerability Disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html). After a fix is released, we will publish a security advisory crediting the reporter (unless they prefer anonymity).
