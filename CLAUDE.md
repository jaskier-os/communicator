# CLAUDE.md -- Communicator

This file provides guidance to Claude Code when working in this repository.

IMPORTANT: NEVER USE EMOJIS ANYWHERE IN LOGGING, CODE OR OTHER TEXT.

IMPORTANT: Treat this codebase as work in progress. Never do backwards-compatibility or legacy support unless explicitly asked. Remove code that becomes redundant.

## What this service is

Communicator is the LLM API gateway for the AI orchestration system. It exposes an
OpenAI-compatible HTTP endpoint and translates requests to Anthropic Claude (and other
backends) under the hood. Every LLM call in the system -- orchestrator intent
classification, agents, clients -- goes through here. It also handles streaming,
multimodal input (`image_url` -> Anthropic image blocks), and Yandex Cloud GPU VM
lifecycle management for self-hosted upstreams.

This service listens on **port 10000**.

For the whole-system architecture, the full port table, and how the other services fit
together, see the orchestrator repo (`jaskier-os/orchestrator`) CLAUDE.md / docs -- do not
duplicate that map here.

## Tech stack

- Node.js 18+, ES modules (import/export everywhere)
- Koa web framework
- axios, OpenAI SDK (streaming)
- Winston logging -- use the project logger (`src/utils/logger.js`), not console.log

## Run

```bash
npm run dev    # nodemon auto-reload
npm start      # node src/index.js
npm test       # node --test src/**/*.test.js
```

`run.sh` is the launch entrypoint used in production; it auto-detects a GNOME/system proxy
and exports HTTP(S)_PROXY so the upstream LLM API can be reached through a tunnel.

Copy `.env.example` to `.env` and fill values. Key knobs: `LLM_PROVIDER`
(`custom` | `claude-cli` | `gateway`), upstream `CUSTOM_API_*`, `API_KEYS` (auth),
OAuth-refresh SSH side channel (`REFRESH_SSH_*`), and Yandex Cloud VM (`YC_*`).

## Layout

- `src/index.js` -- server bootstrap
- `src/app.js` -- Koa app + middleware chain
- `src/routes/` -- `chatRoutes`, `promptRoutes`, `credentialRoutes`, `vmRoutes`, `healthRoutes`
- `src/providers/` -- `llmProvider`, `claudeCliProvider`, `customApiProvider`,
  `gatewayProvider`, `baseProvider`, `providerFactory`
- `src/transformers/` -- OpenAI <-> Anthropic format conversion + stream transformers
- `src/services/vmManager.js`, `src/services/yandexCloudService.js` -- VM lifecycle
- `src/lib/claude_credentials.js` -- Claude OAuth credential handling (`.test.js` alongside)
- `src/middleware/` -- `apiKeyAuth`, `rateLimiter`, `errorHandler`, `vmMiddleware` (VM auto-start)
- `src/config/index.js` -- Joi-validated config
- `models.config.json`, `tools.json` -- gateway model routing + tool definitions
- `YANDEX_CLOUD_SETUP.md` -- VM setup reference

## OAuth token refresh side channel

When `gateway` oauth-authenticated models are used, an expired Claude OAuth token is
refreshed by SSHing to a host running the upstream Claude CLI (`REFRESH_SSH_*`). If unset,
the side channel is disabled and an expired token simply fails -- do not silently invent a
fallback.

## Auth

All endpoints (except health) require an API key from `API_KEYS` via `x-api-key` header or
`Authorization: Bearer <key>`.

## Deploy

Server-side service: it auto-deploys on git push to `main`. CI (`.gitlab-ci.yml`) builds the
Dockerfile with `docker buildx --push` to the local registry, then bumps the image tag in
the `infrastructure/deploy` repo, which Flux reconciles onto the cluster.

- NEVER restart the running service yourself -- if a restart is needed, tell the user.
- NEVER build/push Docker images by hand; commit + push and let CI handle it.
- NEVER modify Kubernetes env/secrets/deployments directly (`kubectl set env/edit/patch`).
  All cluster changes go through the deploy manifests repo so Flux reconciles them.
