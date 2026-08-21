# Security Policy

## Project Overview

This project is a **federated chat network** made up of:

- **Federation Node** — a central registry that routes messages between Community Nodes and tracks node name ownership via UUID.
- **Community Nodes** — independently-operated nodes where users register, log in, and exchange direct/group messages.

---

## Supported Versions

This project is currently in **MVP / early development**. Only the latest version on `main` receives security attention.

| Version | Supported |
|---------|-----------|
| Latest (`main`) | ✅ Yes |
| Older commits | ❌ No |

---

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue**.

Instead, report it privately by emailing the maintainer or opening a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability).

Please include:
- A description of the vulnerability and its impact
- Steps to reproduce
- Any suggested mitigations (optional but appreciated)

You can expect an acknowledgement within **72 hours** and a resolution timeline within **14 days** for critical issues.

---

## Security Architecture

### Authentication (Community Node)
- Passwords are hashed before storage via the `database.js` layer — no plaintext passwords are stored.
- Sessions use a **self-signed HMAC-SHA256 token** stored in an `HttpOnly`, `SameSite=Strict` cookie (`nl_session`).
- The `TOKEN_SECRET` is auto-generated on first run and persisted to `config.json`. **Guard this file carefully.**
- Tokens expire after **7 days**.

### Node Identity (Federation Node)
- Each Community Node registers with a **UUID** tied to its `nodeName`.
- Once a name is claimed, only the original UUID can reconnect under it — preventing node name hijacking.

### Admin Authorisation
- Admin-only API routes are gated by an `adminAuth` middleware that checks the `x-username` header.
- ⚠️ **Known limitation**: The `x-username` header is currently **not verified against the session cookie** on admin routes. This means any client that can set this header could spoof admin identity. See [Known Issues](#known-issues) below.

---

## Known Issues & Limitations

> These are accepted MVP trade-offs, not unplanned bugs. They should be addressed before any production deployment.

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| 1 | Admin middleware trusts `x-username` header without verifying the session cookie | 🔴 High | Should cross-check `req.cookies[TOKEN_COOKIE]` |
| 2 | Federation Node has no authentication — any client can connect and register as a node | 🔴 High | A shared secret or mTLS between nodes is needed for production |
| 3 | Socket.IO CORS is set to `origin: '*'` on both nodes | 🟠 Medium | Should be restricted to known node origins |
| 4 | No rate limiting on `/api/login`, `/api/signup`, or message sending | 🟠 Medium | Brute-force and spam vectors |
| 5 | `config.json` contains the `tokenSecret` in plaintext | 🟡 Low | Should use env vars or a secrets manager |
| 6 | No HTTPS enforced — all traffic is plain HTTP | 🔴 High | Use a reverse proxy (e.g. Caddy, nginx) with TLS in any real deployment |
| 7 | Avatar filenames are derived from `x-username` header (unverified) | 🟠 Medium | Could allow overwriting another user's avatar |
| 8 | `/api/registry` and `/api/status` are publicly accessible on the Federation Node | 🟡 Low | Exposes node topology; consider restricting to registered nodes |

---

## Hardening Checklist (Before Production)

- [ ] Put both nodes behind HTTPS (TLS) — use Caddy or nginx as a reverse proxy
- [ ] Restrict Socket.IO CORS to known node URLs
- [ ] Add a shared secret or token-based auth for node-to-node Federation connections
- [ ] Fix admin middleware to validate the session cookie, not just the `x-username` header
- [ ] Add rate limiting (e.g. `express-rate-limit`) to auth and messaging endpoints
- [ ] Move `tokenSecret` out of `config.json` into an environment variable
- [ ] Validate avatar uploads server-side (file type, extension, MIME type)
- [ ] Consider setting `secure: true` on session cookies once HTTPS is enabled

---

## Sensitive Files

The following files **must never be committed** to version control:

| File | Contains |
|------|----------|
| `config.json` | `tokenSecret`, `uuid`, node config |
| `*.sqlite` / `*.db` | User data, message history |
| `.env` | Any environment-specific secrets |

These are covered by `.gitignore`, but always double-check before pushing.
