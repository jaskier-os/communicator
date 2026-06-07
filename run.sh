#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Proxy detection: env vars -> GNOME gsettings -> port 10808 probe
if [ -z "$HTTP_PROXY" ] && [ -z "$HTTPS_PROXY" ] && [ -z "$PROXY_URL" ]; then
    # Try GNOME system proxy
    if command -v gsettings >/dev/null 2>&1; then
        PROXY_MODE=$(gsettings get org.gnome.system.proxy mode 2>/dev/null | tr -d "'")
        if [ "$PROXY_MODE" = "manual" ]; then
            PROXY_HOST=$(gsettings get org.gnome.system.proxy.http host 2>/dev/null | tr -d "'")
            PROXY_PORT=$(gsettings get org.gnome.system.proxy.http port 2>/dev/null)
            if [ -n "$PROXY_HOST" ] && [ "$PROXY_PORT" -gt 0 ] 2>/dev/null; then
                export HTTP_PROXY="http://${PROXY_HOST}:${PROXY_PORT}/"
                export HTTPS_PROXY="http://${PROXY_HOST}:${PROXY_PORT}/"
                export ALL_PROXY="socks://${PROXY_HOST}:${PROXY_PORT}/"
                export NO_PROXY=localhost,127.0.0.0/8,::1
                echo "[communicator] Proxy from GNOME settings: ${HTTP_PROXY}"
            fi
        fi
    fi

    # Fallback: probe v2RayN default port
    if [ -z "$HTTP_PROXY" ] && nc -z 127.0.0.1 10808 2>/dev/null; then
        export HTTP_PROXY=http://127.0.0.1:10808/
        export HTTPS_PROXY=http://127.0.0.1:10808/
        export ALL_PROXY=socks://127.0.0.1:10808/
        export NO_PROXY=localhost,127.0.0.0/8,::1
        echo "[communicator] Proxy detected (port 10808)"
    fi
fi

echo "[communicator] Installing dependencies..."
npm install --silent

echo "[communicator] Starting on port 10000..."
exec node src/index.js
