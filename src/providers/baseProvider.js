/**
 * Base class for LLM providers
 * All providers must implement these methods
 */
class BaseProvider {
  /**
   * Send a chat completion request to the LLM
   * @param {Object} params - Request parameters
   * @param {Array} params.messages - Array of message objects
   * @param {string} params.model - Model to use (optional)
   * @param {number} params.maxTokens - Maximum tokens to generate
   * @param {number} params.temperature - Temperature for generation
   * @param {boolean} params.stream - Whether to stream the response
   * @param {Array} params.tools - Tool definitions for function calling
   * @param {string|Object} params.tool_choice - Tool choice strategy
   * @param {AbortSignal} params.signal - AbortSignal for cancellation
   * @param {Object} params.additionalParams - Any additional parameters
   * @returns {Promise<Object>|Stream} The API response or stream
   */
  async sendChatCompletion(params) {
    throw new Error('sendChatCompletion must be implemented by provider');
  }

  /**
   * Send a simple prompt to the LLM
   * @param {Object} params - Request parameters
   * @param {string} params.prompt - The prompt to send
   * @param {string} params.model - Model to use (optional, uses config default)
   * @param {number} params.maxTokens - Maximum tokens to generate
   * @param {number} params.temperature - Temperature for generation
   * @param {boolean} params.stream - Whether to stream the response
   * @param {AbortSignal} params.signal - AbortSignal for cancellation
   * @param {Object} params.additionalParams - Any additional parameters for the API
   * @returns {Promise<Object>|Stream} The API response or stream
   */
  async sendPrompt(params) {
    throw new Error('sendPrompt must be implemented by provider');
  }

  /**
   * Health check for the LLM provider
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    throw new Error('healthCheck must be implemented by provider');
  }

  /**
   * Get available models from the LLM provider
   * @returns {Promise<Object>} Available models
   */
  async getAvailableModels() {
    throw new Error('getAvailableModels must be implemented by provider');
  }

  /**
   * Format the API response to a consistent structure
   * @param {Object} data - Raw API response
   * @returns {Object} Formatted response
   */
  formatResponse(data) {
    if (data.choices && Array.isArray(data.choices)) {
      return data;
    }
    if (data.response || data.text || data.content) {
      const content = data.response || data.text || data.content;
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: content
          }
        }],
        model: data.model || 'unknown',
        usage: data.usage || {}
      };
    }
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(data)
        }
      }],
      model: 'unknown',
      usage: {}
    };
  }
}

export default BaseProvider;
