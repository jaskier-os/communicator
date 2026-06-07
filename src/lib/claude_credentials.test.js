import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCredentials } from './claude_credentials.js';

describe('ClaudeCredentials.isExpired', () => {
  it('returns true for past expiry', () => {
    assert.ok(ClaudeCredentials.isExpired({ expiresAt: Date.now() - 1000 }));
  });

  it('returns true within 5-minute buffer', () => {
    assert.ok(ClaudeCredentials.isExpired({ expiresAt: Date.now() + 60000 }));
  });

  it('returns false for future expiry beyond buffer', () => {
    assert.ok(!ClaudeCredentials.isExpired({ expiresAt: Date.now() + 600000 }));
  });

  it('returns true for null/missing expiresAt', () => {
    assert.ok(ClaudeCredentials.isExpired({}));
    assert.ok(ClaudeCredentials.isExpired(null));
  });
});

describe('ClaudeCredentials.load', () => {
  it('loads credentials from disk without error', async () => {
    const creds = await ClaudeCredentials.load();
    // May be null if no credentials file -- that's OK for this test
    if (creds) {
      assert.ok(creds.accessToken, 'Missing accessToken');
      assert.ok(creds.refreshToken, 'Missing refreshToken');
      assert.ok(creds.expiresAt, 'Missing expiresAt');
    }
  });
});

describe('ClaudeCredentials.getValidToken', () => {
  it('returns cached token when not expired', async () => {
    const fakeToken = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    };
    ClaudeCredentials.cachedToken = fakeToken;
    const token = await ClaudeCredentials.getValidToken();
    assert.equal(token, 'test-access-token');
    ClaudeCredentials.cachedToken = null;
  });
});
