# communicator

## What it is

An LLM API gateway. It speaks the OpenAI chat-completions API on the front and
translates requests/responses to and from Anthropic (the `openai_to_anthropic` /
`anthropic_to_openai` transformers), so OpenAI-shaped clients can talk to Claude.
Koa server, API-key auth, optional streaming. It can also start/stop a Yandex
Cloud vLLM VM on demand and refresh Claude OAuth credentials by shelling out over
SSH to the host's refresh script.

## Build / run

Local dev:

```bash
npm install
cp .env.example .env   # edit before first run
npm run dev            # nodemon, src/index.js
npm start              # plain node
```

`run.sh` does the same with automatic proxy detection (GNOME settings, then a
probe of port 10808). Tests: `npm test`.

Docker:

```bash
docker build -t communicator .
docker run -p 10000:10000 --env-file .env communicator
```

The image listens on 10000 (EXPOSE + healthcheck on `/api/health`); local dev
defaults to `PORT=3000`. Set `PORT` to match whatever you publish.

## Configuration

All config is env vars. `.env.example` is the source of truth - copy it to `.env`
and edit. The ones that matter:

- `PORT`, `HOST` - bind address.
- `API_KEYS` - comma-separated keys clients must present.
- `LLM_PROVIDER`, `CUSTOM_API_URL`, `CUSTOM_API_KEY`, `CUSTOM_API_MODEL` -
  the upstream this gateway forwards to.
- `REFRESH_SSH_*` - host/user/key for the OAuth-refresh SSH side channel.
- `YC_VM_*` - Yandex Cloud VM management (instance id, service-account key,
  idle timeout). Off unless `YC_VM_ENABLED=true`.

Rate limiting and CORS are also env-driven; see the example file.

## Dependencies

Node >= 18, Koa 3, `openai` SDK, `joi` for config validation, `winston` logging.
The Docker image installs `openssh-client` because `claude_credentials.js` runs
`ssh root@host` to trigger the host's `refresh-token-now.sh` rather than
reimplementing OAuth refresh. No vendored SDK here.
