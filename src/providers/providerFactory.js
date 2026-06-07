import config from '../config/index.js';
import logger from '../utils/logger.js';
import CustomApiProvider from './customApiProvider.js';
import ClaudeCliProvider from './claudeCliProvider.js';
import GatewayProvider from './gatewayProvider.js';

/**
 * Factory function to create the appropriate LLM provider based on configuration
 */
function createProvider() {
  const providerType = config.llm.provider;

  logger.info(`Initializing LLM provider: ${providerType}`);

  switch (providerType) {
    case 'custom':
      return new CustomApiProvider();

    case 'claude-cli':
      return new ClaudeCliProvider();

    case 'gateway':
      return new GatewayProvider();

    default:
      throw new Error(`Unknown LLM provider: ${providerType}`);
  }
}

// Create and export a singleton instance
const provider = createProvider();

export default provider;
