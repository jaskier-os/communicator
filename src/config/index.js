import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  // Server
  PORT: Joi.number().default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),

  // Authentication
  API_KEYS: Joi.string().required(),

  // CORS
  CORS_ORIGINS: Joi.string().default('*'),

  // Rate Limiting
  RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),

  // LLM Provider Selection
  LLM_PROVIDER: Joi.string().valid('custom', 'claude-cli', 'gateway').default('custom'),

  // Custom LLM API (required when LLM_PROVIDER is 'custom')
  CUSTOM_API_URL: Joi.string().when('LLM_PROVIDER', {
    is: 'custom',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  CUSTOM_API_KEY: Joi.string().when('LLM_PROVIDER', {
    is: 'custom',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  CUSTOM_API_MODEL: Joi.string().default('default-model'),
  CUSTOM_API_HEADERS: Joi.string().default('{}'),

  // Claude CLI (optional, defaults to 'claude')
  CLAUDE_CLI_COMMAND: Joi.string().default('claude'),

  // Request Timeout
  REQUEST_TIMEOUT_MS: Joi.number().default(30000),

  // Streaming
  ENABLE_STREAMING: Joi.boolean().default(false),

  // Yandex Cloud VM Management
  YC_VM_ENABLED: Joi.boolean().default(false),
  YC_VM_INSTANCE_ID: Joi.string().when('YC_VM_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  YC_SERVICE_ACCOUNT_KEY_PATH: Joi.string().when('YC_VM_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  YC_VLLM_HEALTH_URL: Joi.string().when('YC_VM_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  YC_VM_STOP_ON_SHUTDOWN: Joi.boolean().default(true),
  YC_VM_IDLE_TIMEOUT_MS: Joi.number().default(300000), // 5 minutes
  YC_VM_SHUTDOWN_GRACE_PERIOD_MS: Joi.number().default(30000), // 30 seconds
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export default {
  server: {
    port: envVars.PORT,
    host: envVars.HOST,
    nodeEnv: envVars.NODE_ENV,
  },
  logging: {
    level: envVars.LOG_LEVEL,
  },
  auth: {
    apiKeys: envVars.API_KEYS.split(',').map(key => key.trim()),
  },
  cors: {
    origins: envVars.CORS_ORIGINS.split(',').map(origin => origin.trim()),
  },
  rateLimit: {
    enabled: envVars.RATE_LIMIT_ENABLED,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
  },
  llm: {
    provider: envVars.LLM_PROVIDER,
    url: envVars.CUSTOM_API_URL,
    apiKey: envVars.CUSTOM_API_KEY,
    model: envVars.CUSTOM_API_MODEL,
    headers: JSON.parse(envVars.CUSTOM_API_HEADERS),
    timeoutMs: envVars.REQUEST_TIMEOUT_MS,
    streaming: envVars.ENABLE_STREAMING,
    claudeCliCommand: envVars.CLAUDE_CLI_COMMAND,
  },
  yandexCloud: {
    enabled: envVars.YC_VM_ENABLED,
    vmInstanceId: envVars.YC_VM_INSTANCE_ID,
    serviceAccountKeyPath: envVars.YC_SERVICE_ACCOUNT_KEY_PATH,
    vllmHealthUrl: envVars.YC_VLLM_HEALTH_URL,
    stopOnShutdown: envVars.YC_VM_STOP_ON_SHUTDOWN,
    idleTimeoutMs: envVars.YC_VM_IDLE_TIMEOUT_MS,
    shutdownGracePeriodMs: envVars.YC_VM_SHUTDOWN_GRACE_PERIOD_MS,
  },
};