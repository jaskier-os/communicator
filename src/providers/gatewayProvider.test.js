import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load models config directly for assertions
const modelsConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../models.config.json'), 'utf-8')
);

// Expected beta headers per model type
const OPUS_SONNET_BETAS = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24';
const HAIKU_BETAS = 'oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24';

// Import GatewayProvider - it has side effects (loadModelsConfig, getClaudeVersion)
// but we override the methods that do HTTP
const { default: GatewayProvider } = await import('./gatewayProvider.js');

/**
 * Create a testable provider that skips real HTTP and credential fetching.
 * Captures the headers object passed to makeRequest/makeStreamingRequest.
 */
function createTestProvider() {
  const provider = new GatewayProvider();
  let capturedHeaders = null;
  let capturedBody = null;

  // Override auth to avoid real credential fetch. Mirror the real branch:
  // api mode returns the x-api-key header regardless of the model authType.
  provider.getAuthHeader = async (config, useApiKeyMode = false) => {
    if (useApiKeyMode) return { 'X-Api-Key': 'test-api-key' };
    if (config.authType === 'oauth') return { 'Authorization': 'Bearer test-oauth-token' };
    return {};
  };

  // Override version fetch to avoid exec('claude --version')
  provider.ensureClaudeVersion = async () => {
    provider.claudeVersion = '2.1.2';
    return '2.1.2';
  };

  // Capture headers + body instead of making real HTTP requests
  provider.makeRequest = async (_config, body, headers) => {
    capturedHeaders = headers;
    capturedBody = body;
    return { id: 'test', type: 'message', content: [], model: 'test', usage: {} };
  };

  provider.makeStreamingRequest = (_config, body, headers) => {
    capturedHeaders = headers;
    capturedBody = body;
    return new PassThrough();
  };

  return {
    provider,
    getHeaders: () => {
      const h = capturedHeaders;
      capturedHeaders = null;
      return h;
    },
    getBody: () => {
      const b = capturedBody;
      capturedBody = null;
      return b;
    }
  };
}

// ---- Tests ----

describe('models.config.json beta headers', () => {
  it('Opus has complete beta list with claude-code-20250219', () => {
    const betas = modelsConfig.models['claude-opus-4-6'].headers['anthropic-beta'];
    assert.equal(betas, OPUS_SONNET_BETAS);
  });

  it('Sonnet has complete beta list with claude-code-20250219', () => {
    const betas = modelsConfig.models['claude-sonnet-4-6'].headers['anthropic-beta'];
    assert.equal(betas, OPUS_SONNET_BETAS);
  });

  it('Haiku has beta list WITHOUT claude-code-20250219', () => {
    const betas = modelsConfig.models['claude-haiku-4-5-20251001'].headers['anthropic-beta'];
    assert.equal(betas, HAIKU_BETAS);
  });

  it('no model config contains anthropic-version (handled by gatewayProvider)', () => {
    for (const [name, config] of Object.entries(modelsConfig.models)) {
      assert.equal(
        config.headers?.['anthropic-version'], undefined,
        `${name} should not have anthropic-version in headers`
      );
    }
  });
});

describe('GatewayProvider.constructor', () => {
  it('generates a session ID in UUID format', () => {
    const provider = new GatewayProvider();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    assert.match(provider.sessionId, uuidRegex);
  });

  it('session ID is stable on the same instance', () => {
    const provider = new GatewayProvider();
    assert.equal(provider.sessionId, provider.sessionId);
  });

  it('different instances get different session IDs', () => {
    const a = new GatewayProvider();
    const b = new GatewayProvider();
    assert.notEqual(a.sessionId, b.sessionId);
  });
});

describe('GatewayProvider.getOAuthHeaders', () => {
  let provider;

  before(() => {
    provider = new GatewayProvider();
  });

  it('includes all X-Stainless-* headers', () => {
    const h = provider.getOAuthHeaders('2.1.2');
    assert.equal(h['X-Stainless-Retry-Count'], '0');
    assert.equal(h['X-Stainless-Timeout'], '600');
    assert.equal(h['X-Stainless-Lang'], 'js');
    assert.equal(h['X-Stainless-Runtime'], 'node');
    assert.ok(h['X-Stainless-Runtime-Version'], 'missing Runtime-Version');
    assert.ok(h['X-Stainless-OS'], 'missing OS');
    assert.ok(h['X-Stainless-Arch'], 'missing Arch');
    assert.ok(h['X-Stainless-Package-Version'], 'missing Package-Version');
  });

  it('sets User-Agent as claude-cli/{version} (external, cli)', () => {
    const h = provider.getOAuthHeaders('3.0.0');
    assert.equal(h['User-Agent'], 'claude-cli/3.0.0 (external, cli)');
  });

  it('sets x-app to cli', () => {
    const h = provider.getOAuthHeaders('2.1.2');
    assert.equal(h['x-app'], 'cli');
  });

  it('does NOT include anthropic-dangerous-direct-browser-access', () => {
    const h = provider.getOAuthHeaders('2.1.2');
    assert.equal(h['anthropic-dangerous-direct-browser-access'], undefined);
  });

  it('omits x-stainless-helper-method when stream=false', () => {
    const h = provider.getOAuthHeaders('2.1.2', false);
    assert.equal(h['x-stainless-helper-method'], undefined);
  });

  it('omits x-stainless-helper-method by default (stream defaults to false)', () => {
    const h = provider.getOAuthHeaders('2.1.2');
    assert.equal(h['x-stainless-helper-method'], undefined);
  });

  it('includes x-stainless-helper-method: stream when stream=true', () => {
    const h = provider.getOAuthHeaders('2.1.2', true);
    assert.equal(h['x-stainless-helper-method'], 'stream');
  });
});

describe('sendChatCompletion: header assembly', () => {
  it('includes Content-Type application/json', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['Content-Type'], 'application/json');
  });

  it('does NOT include Accept header', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['Accept'], undefined);
  });

  it('includes anthropic-version 2023-06-01', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['anthropic-version'], '2023-06-01');
  });

  it('includes X-Claude-Code-Session-Id matching provider.sessionId', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['X-Claude-Code-Session-Id'], provider.sessionId);
  });

  it('includes x-client-request-id as UUID', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    assert.match(getHeaders()['x-client-request-id'], uuidRegex);
  });

  it('generates unique x-client-request-id per request', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const id1 = getHeaders()['x-client-request-id'];

    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const id2 = getHeaders()['x-client-request-id'];

    assert.notEqual(id1, id2);
  });

  it('includes Authorization Bearer for OAuth models', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['Authorization'], 'Bearer test-oauth-token');
  });

  it('includes x-app and User-Agent from OAuth headers', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const h = getHeaders();
    assert.equal(h['x-app'], 'cli');
    assert.equal(h['User-Agent'], 'claude-cli/2.1.2 (external, cli)');
  });
});

describe('sendChatCompletion: per-model beta headers', () => {
  it('Opus gets full beta list', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    assert.equal(getHeaders()['anthropic-beta'], OPUS_SONNET_BETAS);
  });

  it('Sonnet gets full beta list', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-sonnet-4-6',
    });
    assert.equal(getHeaders()['anthropic-beta'], OPUS_SONNET_BETAS);
  });

  it('Haiku gets beta list without claude-code', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-haiku-4-5-20251001',
    });
    assert.equal(getHeaders()['anthropic-beta'], HAIKU_BETAS);
  });

  it('model alias "opus" resolves to correct beta list', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'opus',
    });
    assert.equal(getHeaders()['anthropic-beta'], OPUS_SONNET_BETAS);
  });

  it('model alias "haiku" resolves to correct beta list', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'haiku',
    });
    assert.equal(getHeaders()['anthropic-beta'], HAIKU_BETAS);
  });

  it('Opus beta includes all 9 required flags', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const betas = getHeaders()['anthropic-beta'].split(',');
    const required = [
      'claude-code-20250219',
      'oauth-2025-04-20',
      'interleaved-thinking-2025-05-14',
      'redact-thinking-2026-02-12',
      'context-management-2025-06-27',
      'prompt-caching-scope-2026-01-05',
      'advanced-tool-use-2025-11-20',
      'effort-2025-11-24',
    ];
    for (const beta of required) {
      assert.ok(betas.includes(beta), `missing ${beta}`);
    }
    assert.equal(betas.length, 8, `expected 8 betas, got ${betas.length}`);
  });

  it('Haiku beta has exactly 7 flags (no claude-code)', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-haiku-4-5-20251001',
    });
    const betas = getHeaders()['anthropic-beta'].split(',');
    assert.ok(!betas.includes('claude-code-20250219'), 'haiku must not have claude-code');
    assert.equal(betas.length, 7, `expected 7 betas, got ${betas.length}`);
  });
});

describe('sendChatCompletion: api_mode routing', () => {
  it('oauth (default) uses Bearer auth and claude-cli spoof headers', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'system', content: 'You grade essays.' }, { role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const h = getHeaders();
    assert.equal(h['Authorization'], 'Bearer test-oauth-token');
    assert.equal(h['X-Api-Key'], undefined);
    assert.equal(h['x-app'], 'cli');
    assert.equal(h['User-Agent'], 'claude-cli/2.1.2 (external, cli)');
  });

  it('api mode uses X-Api-Key and drops claude-cli spoof headers', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
      apiMode: 'api',
    });
    const h = getHeaders();
    assert.equal(h['X-Api-Key'], 'test-api-key');
    assert.equal(h['Authorization'], undefined);
    assert.equal(h['x-app'], undefined);
    assert.equal(h['User-Agent'], undefined);
    assert.equal(h['X-Claude-Code-Session-Id'], undefined);
    assert.equal(h['x-client-request-id'], undefined);
  });

  it('api mode strips oauth-only betas but keeps effort/context betas', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
      apiMode: 'api',
    });
    const betas = (getHeaders()['anthropic-beta'] || '').split(',').filter(Boolean);
    assert.ok(!betas.includes('oauth-2025-04-20'), 'oauth beta must be stripped');
    assert.ok(!betas.includes('claude-code-20250219'), 'claude-code beta must be stripped');
    assert.ok(betas.includes('effort-2025-11-24'), 'effort beta must survive');
    assert.ok(betas.includes('context-management-2025-06-27'), 'context beta must survive');
  });

  it('api mode preserves the real system prompt (no Claude Code identity)', async () => {
    const { provider, getBody } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'system', content: 'You grade essays.' }, { role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
      apiMode: 'api',
    });
    const body = getBody();
    assert.equal(body.system[0].text, 'You grade essays.');
  });

  it('oauth mode forces the Claude Code identity system block', async () => {
    const { provider, getBody } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'system', content: 'You grade essays.' }, { role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
    });
    const body = getBody();
    assert.equal(body.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
  });
});

describe('sendChatCompletion: streaming vs non-streaming', () => {
  it('non-streaming request does not include x-stainless-helper-method', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
      stream: false,
    });
    assert.equal(getHeaders()['x-stainless-helper-method'], undefined);
  });

  it('streaming request includes x-stainless-helper-method: stream', async () => {
    const { provider, getHeaders } = createTestProvider();
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-opus-4-6',
      stream: true,
    });
    assert.equal(getHeaders()['x-stainless-helper-method'], 'stream');
  });
});
