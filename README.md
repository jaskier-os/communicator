# Communicator

Communicator is a Node.js (Koa, ES modules) API gateway that routes chat and
prompt requests to one or more Large Language Model backends behind a single
authenticated, OpenAI-compatible HTTP interface. It can forward to an
OpenAI-compatible upstream (such as a self-hosted vLLM server or a managed
cloud LLM), to the local Claude Code CLI, or to a model-config-driven gateway.
It also offers optional Yandex Cloud GPU VM lifecycle management so an
expensive GPU instance can be started on demand and stopped when idle.

## Features

- Single authenticated entry point for multiple LLM backends.
- Pluggable providers: `custom` (OpenAI-compatible HTTP), `claude-cli`, `gateway`.
- Request/response format transformers between OpenAI and Anthropic schemas.
- API-key authentication, CORS, rate limiting, and security headers (helmet).
- Optional streaming responses with client-side cancellation.
- Optional Yandex Cloud VM start/stop on demand and idle shutdown.
- Optional OAuth token refresh side channel for gateway oauth models.

## Prerequisites

- Node.js >= 18 (ES modules).
- npm (a `package-lock.json` is committed for reproducible installs).
- Optional: an OpenSSH client, only if you use the OAuth refresh side channel
  (`REFRESH_SSH_*`).
- Optional: a reachable OpenAI-compatible LLM endpoint, the Claude Code CLI,
  or a Yandex Cloud account, depending on the provider you configure.

## Setup

1. Copy the example environment file and fill in values:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`. Every variable is documented inline in `.env.example`. The
   essentials:
   - `API_KEYS` -- comma-separated keys clients must present.
   - `LLM_PROVIDER` -- `custom`, `claude-cli`, or `gateway`.
   - For `custom`: `CUSTOM_API_URL`, `CUSTOM_API_KEY`, `CUSTOM_API_MODEL`.
   - `PORT` / `HOST` -- where the server listens.
   - Yandex Cloud and SSH-refresh variables are optional and disabled by
     default (`YC_VM_ENABLED=false`, empty `REFRESH_SSH_HOST`).

No real secrets ship in this repository. `.env` and credential files are
gitignored; never commit them.

## Build

This is a plain Node.js project with no build/compile step. Install
dependencies:

```bash
npm install
```

For a container image:

```bash
docker build -t communicator .
```

## Run

Development (auto-reload via nodemon):

```bash
npm run dev
```

Production:

```bash
npm start
```

Convenience launcher (installs deps, auto-detects an outbound proxy, starts):

```bash
./run.sh
```

Run with Docker (pass your `.env`):

```bash
docker run --rm -p 3000:3000 --env-file .env communicator
```

### Tests

```bash
npm test
```

### Smoke check

With the server running, hit the unauthenticated health endpoint:

```bash
curl http://localhost:3000/api/health
```

## API endpoints

All endpoints are under the `/api` prefix. All except health require an API
key via the `x-api-key` header or `Authorization: Bearer <key>`.

- `GET  /api/health` -- liveness check (no auth).
- `GET  /api/health/detailed` -- detailed status.
- `GET  /api/health/models` -- available models.
- `POST /api/prompts` -- simple prompt.
- `POST /api/prompts/chat` -- chat-style prompt.
- `POST /api/chat/completions` -- OpenAI-compatible chat completions.
- `GET  /api/vm/status`, `POST /api/vm/start`, `POST /api/vm/stop` -- Yandex
  Cloud VM control (only meaningful when `YC_VM_ENABLED=true`).
- `POST /api/credentials/push` -- push refreshed Claude credentials.

Example request:

```bash
curl -X POST http://localhost:3000/api/chat/completions \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model-name","messages":[{"role":"user","content":"Hello"}]}'
```

See `scripts/example-client.js` and `scripts/example-streaming-client.js` for
runnable examples (set `API_URL` and `API_KEY` in your environment).

## Outbound proxy, TLS, and VPN (all optional)

Communicator does not require any TLS certificate or VPN to run. By default it
connects to upstreams over plain HTTP/HTTPS using the host/port you configure.

- Outbound proxy: if your upstream LLM must be reached through a proxy, set the
  standard `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` variables. `run.sh` also
  auto-detects a GNOME system proxy or a local proxy on port 10808; this is a
  convenience only and never required.
- TLS to upstream: use an `https://` URL in `CUSTOM_API_URL` to talk to a TLS
  upstream. No client certificate is needed.
- VPN: there is no VPN coupling. Point the relevant `*_URL` / `*_HOST`
  variables at whatever host is reachable from your network.

## OAuth refresh side channel (optional)

Gateway models that use `authType: oauth` rely on a Claude OAuth token read
from `~/.claude/.credentials.json`. If that token is expired and the
`REFRESH_SSH_*` variables are set, Communicator triggers a host-side refresh
over SSH (the remote `authorized_keys` entry should pin a forced command). If
the `REFRESH_SSH_*` variables are unset, this feature is simply disabled and an
expired token fails the request -- the server still starts and serves all other
providers normally.

## Yandex Cloud VM management (optional)

When `YC_VM_ENABLED=true`, Communicator can start a GPU VM before forwarding
requests and stop it when idle. Provide:

- `YC_VM_INSTANCE_ID` -- the compute instance to manage.
- `YC_SERVICE_ACCOUNT_KEY_PATH` -- path to a Yandex Cloud service account key
  JSON file (gitignored; never commit it).
- `YC_VLLM_HEALTH_URL` -- health endpoint to poll for readiness.

See `YANDEX_CLOUD_SETUP.md` for obtaining the service account key and instance
ID. When `YC_VM_ENABLED=false` (the default) none of these are required.

## Model weights

Communicator is a gateway and ships no model weights. Models run on the
upstream you configure (your vLLM/Ollama server, a managed cloud LLM, or the
Claude API). There is nothing to download into this repository.

## Project structure

```
src/
  app.js              Koa app wiring (middleware, routes)
  index.js            Server bootstrap and lifecycle
  config/             Env-driven config (Joi-validated)
  middleware/         Auth, rate limiting, error handling, VM gating
  providers/          custom / claude-cli / gateway providers + factory
  transformers/       OpenAI <-> Anthropic format conversion
  routes/             HTTP route definitions
  services/           Yandex Cloud + VM manager
  lib/                Claude OAuth credential handling
  utils/              Logger
scripts/              Example clients and token refresh helper
models.config.json    Gateway model routing definitions
tools.json            Tool definitions surfaced to models
Dockerfile            Container build
```

## License

MIT
