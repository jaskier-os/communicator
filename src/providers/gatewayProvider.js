import https from 'https';
import http from 'http';
import { randomUUID } from 'crypto';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import BaseProvider from './baseProvider.js';
import logger from '../utils/logger.js';
import {
  transformOpenAIToAnthropicRequest,
  transformAnthropicToOpenAIResponse,
  createAnthropicToOpenAIStreamTransformer
} from '../transformers/index.js';
import { ClaudeCredentials } from '../lib/claude_credentials.js';
import appConfig from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Claude Code version reported to the upstream API (User-Agent / OAuth headers).
const CLAUDE_VERSION = '2.1.168';

async function getClaudeVersion() {
  return CLAUDE_VERSION;
}

function getProxyAgent(targetUrl) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return null;

  // Don't proxy local requests
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim());
  const hostname = new URL(targetUrl).hostname;
  if (noProxy.some(np => hostname === np || hostname.endsWith(`.${np}`))) return null;

  return new HttpsProxyAgent(proxyUrl);
}

class GatewayProvider extends BaseProvider {
  constructor() {
    super();
    this.modelsConfig = this.loadModelsConfig();
    this.claudeVersion = null;
    this.sessionId = randomUUID();
  }

  loadModelsConfig() {
    const configPath = path.join(__dirname, '../../models.config.json');
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to load models config:', error);
      return { models: {}, aliases: {} };
    }
  }

  resolveModel(modelName) {
    // Check aliases first
    const resolved = this.modelsConfig.aliases?.[modelName] || modelName;
    const config = this.modelsConfig.models[resolved];

    if (!config) {
      throw new Error(`Unknown model: ${modelName}. Available models: ${Object.keys(this.modelsConfig.models).join(', ')}`);
    }

    return { modelName: resolved, config };
  }

  async getAuthHeader(config, useApiKeyMode = false) {
    // api mode overrides an oauth model's auth with the direct API key.
    if (useApiKeyMode) {
      const apiKey = appConfig.llm.anthropicApiKey || '';
      if (!apiKey) {
        throw new Error('api_mode=api requires ANTHROPIC_API_KEY to be set');
      }
      return { 'X-Api-Key': apiKey };
    }

    switch (config.authType) {
      case 'oauth':
        const token = await ClaudeCredentials.getValidToken();
        return { 'Authorization': `Bearer ${token}` };

      case 'bearer':
        const apiKey = process.env[config.authEnvVar];
        if (!apiKey) throw new Error(`Missing env var: ${config.authEnvVar}`);
        return { 'Authorization': `Bearer ${apiKey}` };

      case 'x-api-key':
        const xApiKey = process.env[config.authEnvVar];
        if (!xApiKey) throw new Error(`Missing env var: ${config.authEnvVar}`);
        return { 'X-Api-Key': xApiKey };

      case 'none':
      default:
        return {};
    }
  }

  getOAuthHeaders(claudeVersion, stream = false) {
    // Headers matching what Claude Code / Anthropic SDK sends
    return {
      'X-Stainless-Retry-Count': '0',
      'X-Stainless-Timeout': '600',
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': '1.0.0',
      'X-Stainless-OS': process.platform === 'win32' ? 'Windows' : 'Linux',
      'X-Stainless-Arch': process.arch,
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': process.version,
      ...(stream ? { 'x-stainless-helper-method': 'stream' } : {}),
      'x-app': 'cli',
      'User-Agent': `claude-cli/${claudeVersion} (external, cli)`
    };
  }

  async ensureClaudeVersion() {
    if (!this.claudeVersion) {
      this.claudeVersion = await getClaudeVersion();
    }
    return this.claudeVersion;
  }

  async sendChatCompletion({
    messages,
    model,
    maxTokens,
    temperature,
    stream = false,
    tools = null,
    tool_choice = null,
    signal = null,
    effort,
    apiMode = 'oauth',
  }) {
    const { modelName, config } = this.resolveModel(model);

    // An OAuth-configured model can be routed two ways:
    //   - oauth (default): Claude subscription -- Bearer OAuth token, claude-cli
    //     spoofing headers, forced "Claude Code" identity, oauth betas.
    //   - api: direct Anthropic API key (billed per-token) -- x-api-key auth,
    //     no spoofing, real system prompt, no oauth betas.
    // api_mode only affects oauth-authType models; others ignore it.
    const useApiKeyMode = apiMode === 'api' && config.authType === 'oauth';

    // Build the request in the client's input format first
    let request = {
      messages,
      model: modelName,
      max_tokens: maxTokens || config.defaults?.max_tokens || 4096,
      temperature,
      stream,
      tools,
      tool_choice,
      effort
    };

    // Transform request if client format differs from API's original format
    // inputFormat = what client sends, originalFormat = what API expects
    const needsRequestTransform = config.inputFormat !== config.originalFormat;

    if (needsRequestTransform && config.inputFormat === 'openai' && config.originalFormat === 'anthropic') {
      // In api mode we keep the caller's system message intact so the real
      // prompt reaches inference; the transformer normally demotes system to
      // user turns, so re-attach it as a top-level system block here.
      const originalSystem = useApiKeyMode
        ? messages.filter(m => m.role === 'system').map(m =>
            typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          ).filter(Boolean).join('\n\n')
        : null;

      // In api mode, drop system turns before transforming so they are NOT
      // demoted into user messages (they are re-attached as a system block
      // below). Non-system turns are untouched.
      if (useApiKeyMode) {
        request.messages = messages.filter(m => m.role !== 'system');
      }

      request = transformOpenAIToAnthropicRequest(request);

      if (useApiKeyMode) {
        if (originalSystem) {
          request.system = [{ type: 'text', text: originalSystem }];
        } else {
          delete request.system;
        }
      } else if (config.authType === 'oauth') {
        // The Claude Code identity block is the ONLY system message allowed to
        // reach inference for the subscription (oauth) path. Any other system
        // content is demoted to user turns by the transformer; this hard-set
        // drops anything else from system.
        request.system = [
          { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }
        ];
      } else {
        delete request.system;
      }

      // Always include tools array for Anthropic format
      if (!request.tools) {
        request.tools = [];
      }
    }

    // Get auth headers
    const authHeaders = await this.getAuthHeader(config, useApiKeyMode);
    const claudeVersion = await this.ensureClaudeVersion();

    // Per-model betas. In api mode, strip oauth-only betas (they are rejected
    // by the direct API); keep the rest (effort, context-management, caching).
    const modelHeaders = { ...(config.headers || {}) };
    if (useApiKeyMode && typeof modelHeaders['anthropic-beta'] === 'string') {
      const kept = modelHeaders['anthropic-beta']
        .split(',')
        .map(s => s.trim())
        .filter(b => b && !b.startsWith('oauth-') && !b.startsWith('claude-code-'));
      if (kept.length) {
        modelHeaders['anthropic-beta'] = kept.join(',');
      } else {
        delete modelHeaders['anthropic-beta'];
      }
    }

    // Build full headers. In api mode we send NO claude-cli spoofing headers --
    // just the direct-API auth + version + surviving betas.
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(useApiKeyMode ? {} : {
        'X-Claude-Code-Session-Id': this.sessionId,
        'x-client-request-id': randomUUID(),
      }),
      ...authHeaders,
      ...modelHeaders,
      ...(!useApiKeyMode && config.authType === 'oauth'
        ? this.getOAuthHeaders(claudeVersion, stream)
        : {})
    };

    logger.info('Gateway request', {
      model: modelName,
      endpoint: config.endpoint,
      inputFormat: config.inputFormat,
      outputFormat: config.outputFormat,
      originalFormat: config.originalFormat,
      needsRequestTransform,
      needsResponseTransform: config.outputFormat !== config.originalFormat,
      stream,
      apiMode: useApiKeyMode ? 'api' : 'oauth',
      messageCount: messages?.length || 0
    });

    if (stream) {
      return this.makeStreamingRequest(config, request, headers, signal);
    } else {
      return await this.makeRequest(config, request, headers, signal);
    }
  }

  async makeRequest(config, body, headers, signal) {
    return new Promise((resolve, reject) => {
      const url = new URL(config.endpoint);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const data = JSON.stringify(body);

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const proxyAgent = isHttps ? getProxyAgent(config.endpoint) : null;
      if (proxyAgent) {
        options.agent = proxyAgent;
        logger.info('Gateway using proxy for request');
      }

      logger.debug('Gateway HTTP request', {
        method: 'POST',
        url: `${url.protocol}//${url.hostname}${options.path}`,
        bodySize: Buffer.byteLength(data)
      });

      const req = httpModule.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const responseData = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode !== 200) {
            logger.error('Gateway API error', {
              status: res.statusCode,
              response: responseData.slice(0, 500),
              requestBody: JSON.stringify(body, null, 2)
            });
            const err = new Error(`API error: ${res.statusCode} ${responseData.slice(0, 200)}`);
            err.status = res.statusCode;
            reject(err);
            return;
          }

          try {
            let response = JSON.parse(responseData);

            logger.info('Gateway raw API response', {
              id: response.id,
              model: response.model,
              stop_reason: response.stop_reason,
              usage: response.usage,
              type: response.type
            });

            // Transform response if client expects different format than API returns
            // originalFormat = what API returns, outputFormat = what client expects
            const needsResponseTransform = config.outputFormat !== config.originalFormat;

            if (needsResponseTransform && config.originalFormat === 'anthropic' && config.outputFormat === 'openai') {
              response = transformAnthropicToOpenAIResponse(response);
            }

            resolve(response);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      if (signal) {
        if (signal.aborted) {
          req.destroy(new Error('client_disconnect'));
          const err = new Error('Request was cancelled');
          err.status = 499;
          err.cancelled = true;
          reject(err);
          return;
        }
        signal.addEventListener('abort', () => {
          req.destroy(new Error('client_disconnect'));
          const err = new Error('Request was cancelled');
          err.status = 499;
          err.cancelled = true;
          reject(err);
        });
      }

      req.on('error', (err) => {
        logger.error('Gateway request error', { error: err.message });
        reject(err);
      });

      req.write(data);
      req.end();
    });
  }

  makeStreamingRequest(config, body, headers, signal) {
    const passThrough = new PassThrough();

    const url = new URL(config.endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const data = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const proxyAgent = isHttps ? getProxyAgent(config.endpoint) : null;
    if (proxyAgent) {
      options.agent = proxyAgent;
      logger.info('Gateway using proxy for streaming request');
    }

    logger.debug('Gateway streaming request', {
      method: 'POST',
      url: `${url.protocol}//${url.hostname}${options.path}`,
      bodySize: Buffer.byteLength(data)
    });

    const req = httpModule.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          logger.error('Gateway streaming API error', {
            status: res.statusCode,
            response: errorData.slice(0, 500),
            requestBody: JSON.stringify(body, null, 2)
          });
          passThrough.destroy(new Error(`API error: ${res.statusCode} ${errorData.slice(0, 200)}`));
        });
        return;
      }

      // Transform stream if client expects different format than API returns
      // originalFormat = what API returns, outputFormat = what client expects
      const needsResponseTransform = config.outputFormat !== config.originalFormat;

      if (needsResponseTransform && config.originalFormat === 'anthropic' && config.outputFormat === 'openai') {
        const transformer = createAnthropicToOpenAIStreamTransformer();
        res.pipe(transformer).pipe(passThrough);
      } else {
        res.pipe(passThrough);
      }
    });

    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('client_disconnect'));
        passThrough.destroy(new Error('Request was cancelled'));
      } else {
        signal.addEventListener('abort', () => {
          req.destroy(new Error('client_disconnect'));
          passThrough.destroy(new Error('Request was cancelled'));
        });
      }
    }

    req.on('error', (err) => {
      logger.error('Gateway streaming request error', { error: err.message });
      passThrough.destroy(err);
    });

    req.write(data);
    req.end();

    return passThrough;
  }

  async sendPrompt({
    prompt,
    model,
    maxTokens,
    temperature,
    stream = false,
    signal = null,
    additionalParams = {}
  }) {
    // Convert simple prompt to chat format
    const messages = [
      { role: 'user', content: prompt }
    ];

    return this.sendChatCompletion({
      messages,
      model,
      maxTokens,
      temperature,
      stream,
      signal,
      ...additionalParams
    });
  }

  async healthCheck() {
    return {
      status: 'healthy',
      provider: 'gateway',
      models: Object.keys(this.modelsConfig.models),
      aliases: Object.keys(this.modelsConfig.aliases || {})
    };
  }

  async getAvailableModels() {
    return {
      data: Object.entries(this.modelsConfig.models).map(([id, config]) => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: config.inputFormat === 'anthropic' ? 'anthropic' : 'custom'
      }))
    };
  }
}

export default GatewayProvider;
