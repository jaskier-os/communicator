import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import logger from '../utils/logger.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CREDENTIALS_PATH = path.join(CLAUDE_DIR, '.credentials.json');
const REFRESH_LOCK_PATH = path.join(CLAUDE_DIR, '.credentials.refresh.lock');

// Reject tokens expiring within 5 minutes to avoid mid-request expiry.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// SSH side channel for triggering the host-side OAuth refresh. The host's
// authorized_keys pins this key to /root/refresh-token-now.sh via
// forced-command, so even if the key leaks the worst-case action is "force
// the upstream Claude CLI to refresh its own OAuth credentials". This is
// the same flow the /root/refresh-token.sh cron uses; we just call it on
// demand instead of waiting for the next 2-hour tick.
const SSH_HOST = process.env.REFRESH_SSH_HOST || '';
const SSH_PORT = process.env.REFRESH_SSH_PORT || '22';
const SSH_USER = process.env.REFRESH_SSH_USER || 'root';
const SSH_KEY = process.env.REFRESH_SSH_KEY || '';
const SSH_KNOWN_HOSTS = process.env.REFRESH_SSH_KNOWN_HOSTS || '';
const SSH_TIMEOUT_MS = 60_000;

// How long to wait for another process holding the lock before bailing.
// SSH refresh itself takes ~10-12s; 30s is a comfortable cushion that
// also bounds how long callers wait if the prior holder was SIGKILL'd.
const LOCK_WAIT_MS = 30 * 1000;
// Polling interval while waiting for another refresher.
const LOCK_POLL_INTERVAL_MS = 250;
// Negative-cache window after a refresh failure -- prevents hammering the
// host when SSH is broken (network outage, key invalidated, host down).
// Callers in the window get a fast-fail with the cached error instead of
// each spawning their own ssh that will also fail.
const REFRESH_FAILURE_BACKOFF_MS = 30 * 1000;

class ClaudeCredentials {
  static cachedToken = null;
  /** In-flight refresh promise to coalesce concurrent callers in this process. */
  static _refreshPromise = null;
  /** Last refresh failure (epoch ms + error). While within the negative-cache
   *  window every getValidToken() call short-circuits to throw the cached
   *  error -- no point spawning another ssh subprocess that will also fail. */
  static _refreshFailedAt = 0;
  static _refreshFailureMessage = '';

  static async load() {
    try {
      const content = await fs.promises.readFile(CREDENTIALS_PATH, 'utf-8');
      const data = JSON.parse(content);
      return data.claudeAiOauth;
    } catch (error) {
      logger.error('Failed to load Claude credentials:', { error: error.message });
      return null;
    }
  }

  static isExpired(credentials) {
    if (!credentials?.expiresAt) return true;
    return (Date.now() + EXPIRY_BUFFER_MS) >= credentials.expiresAt;
  }

  /**
   * Returns a valid access token. If the on-disk token is expired, asks the
   * host (via SSH + forced-command) to run the same `claude -p "test"` the
   * cron job uses; the upstream CLI then refreshes the token and writes
   * it into /root/.claude/.credentials.json which is bind-mounted into
   * this pod. The host cron stays as a backstop for the long-idle case.
   */
  static async getValidToken() {
    if (this.cachedToken && !this.isExpired(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }
    const creds = await this.load();
    if (!creds) {
      throw new Error('Claude Code credentials not found. Run: claude login');
    }
    if (!this.isExpired(creds)) {
      this.cachedToken = creds;
      return creds.accessToken;
    }
    // Negative-cache: if SSH refresh failed recently, fast-fail so we
    // don't pile up dozens of concurrent ssh subprocesses while the host
    // is down.
    if (this._refreshFailedAt && Date.now() - this._refreshFailedAt < REFRESH_FAILURE_BACKOFF_MS) {
      throw new Error(`OAuth refresh in cooldown after recent failure: ${this._refreshFailureMessage}`);
    }
    try {
      const refreshed = await this._refreshLocked();
      this._refreshFailedAt = 0;
      this._refreshFailureMessage = '';
      return refreshed.accessToken;
    } catch (err) {
      this._refreshFailedAt = Date.now();
      this._refreshFailureMessage = err?.message || String(err);
      throw err;
    }
  }

  /**
   * Coalesce concurrent refresh attempts in this process and across
   * processes. In-process: a single shared Promise. Cross-process: a lock
   * file claimed with O_EXCL.
   */
  static async _refreshLocked() {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = (async () => {
      try {
        return await this._refreshWithFileLock();
      } finally {
        this._refreshPromise = null;
      }
    })();
    return this._refreshPromise;
  }

  static async _refreshWithFileLock() {
    let lockFd = null;
    let acquired = false;
    const start = Date.now();
    while (Date.now() - start < LOCK_WAIT_MS) {
      try {
        lockFd = fs.openSync(REFRESH_LOCK_PATH, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeSync(lockFd, `${process.pid}\n`);
        acquired = true;
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const reloaded = await this.load();
        if (reloaded && !this.isExpired(reloaded)) {
          this.cachedToken = reloaded;
          return reloaded;
        }
        try {
          const lockStat = fs.statSync(REFRESH_LOCK_PATH);
          if (Date.now() - lockStat.mtimeMs > LOCK_WAIT_MS) {
            fs.unlinkSync(REFRESH_LOCK_PATH);
          }
        } catch { /* lock vanished -- fine, retry */ }
        await new Promise(r => setTimeout(r, LOCK_POLL_INTERVAL_MS));
      }
    }
    if (!acquired) {
      throw new Error('Timed out waiting for OAuth refresh lock');
    }
    try {
      const reloaded = await this.load();
      if (reloaded && !this.isExpired(reloaded)) {
        this.cachedToken = reloaded;
        return reloaded;
      }
      await this._sshRefresh();
      const fresh = await this.load();
      if (!fresh) {
        throw new Error('Credentials disappeared after SSH refresh');
      }
      if (this.isExpired(fresh)) {
        const expiredAgo = Math.round((Date.now() - fresh.expiresAt) / 60000);
        throw new Error(`Credentials still expired after SSH refresh (${expiredAgo} min ago)`);
      }
      this.cachedToken = fresh;
      logger.info('OAuth access token refreshed via host SSH', {
        expiresAt: new Date(fresh.expiresAt).toISOString(),
      });
      return fresh;
    } finally {
      try { if (lockFd != null) fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(REFRESH_LOCK_PATH); } catch {}
    }
  }

  /**
   * Exec `ssh root@host` -- authorized_keys pins this to a server-side
   * forced-command (`/root/refresh-token-now.sh`), so we don't pass any
   * remote command from this side. Returns when ssh exits 0; throws
   * otherwise (with stderr).
   */
  static _sshRefresh() {
    if (!SSH_HOST) {
      throw new Error('REFRESH_SSH_HOST not configured');
    }
    if (!SSH_KEY) {
      throw new Error('REFRESH_SSH_KEY not configured');
    }
    return new Promise((resolve, reject) => {
      const args = [
        '-i', SSH_KEY,
        '-p', String(SSH_PORT),
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'IdentityAgent=none',
        '-o', `UserKnownHostsFile=${SSH_KNOWN_HOSTS || '/dev/null'}`,
        '-o', SSH_KNOWN_HOSTS ? 'StrictHostKeyChecking=yes' : 'StrictHostKeyChecking=no',
        `${SSH_USER}@${SSH_HOST}`,
        // No remote command -- forced-command handles it.
      ];
      const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stdout.on('data', () => { /* discard remote output */ });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 8192) stderr = stderr.slice(-4096); });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`SSH refresh timed out after ${SSH_TIMEOUT_MS}ms; stderr: ${stderr.slice(-500)}`));
      }, SSH_TIMEOUT_MS);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`SSH spawn failed: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SSH exited ${code}; stderr: ${stderr.slice(-500)}`));
        }
      });
    });
  }

  /**
   * Returns credential status for health checks.
   */
  static async getStatus() {
    const creds = await this.load();
    if (!creds) {
      return { credentialsExist: false, tokenExpired: true, expiresAt: null, minutesUntilExpiry: 0 };
    }
    const expired = this.isExpired(creds);
    const minutesUntilExpiry = Math.round((creds.expiresAt - Date.now()) / 60000);
    return {
      credentialsExist: true,
      tokenExpired: expired,
      expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
      minutesUntilExpiry: expired ? 0 : minutesUntilExpiry,
    };
  }
}

export { ClaudeCredentials };
