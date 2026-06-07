FROM node:20-alpine

WORKDIR /app

# OpenSSH client for the OAuth-refresh side channel. claude_credentials.js
# shells out to `ssh root@host` to trigger the host's
# /root/refresh-token-now.sh (which runs the same `claude -p "test"` the
# host cron uses). This delegates the full OAuth refresh to the upstream
# Claude CLI on the host -- no parallel OAuth implementation to maintain.
RUN apk add --no-cache openssh-client

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY models.config.json .

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "src/index.js"]
