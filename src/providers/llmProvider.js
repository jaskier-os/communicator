import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { PassThrough } from 'stream';

class LLMProvider {
  constructor() {
    this.config = config.llm;
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (request) => {
        logger.debug('LLM API Request:', {
          method: request.method,
          url: request.url,
          headers: request.headers,
        });
        return request;
      },
      (error) => {
        logger.error('LLM API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('LLM API Response:', {
          status: response.status,
          statusText: response.statusText,
        });
        return response;
      },
      (error) => {
        logger.error('LLM API Response Error:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Send a prompt to the LLM API
   * @param {Object} params - Request parameters
   * @param {string} params.prompt - The prompt to send
   * @param {string} params.model - Model to use (optional, uses config default)
   * @param {number} params.maxTokens - Maximum tokens to generate
   * @param {number} params.temperature - Temperature for generation
   * @param {boolean} params.stream - Whether to stream the response
   * @param {AbortSignal} params.signal - AbortSignal for cancellation
   * @param {Object} params.additionalParams - Any additional parameters for the API
   * @returns {Promise<Object>} The API response
   */
  async sendPrompt({
    prompt,
    model = this.config.model,
    maxTokens = 1000,
    temperature = 0.7,
    stream = false,
    signal = null,
    additionalParams = {},
  }) {
    try {
      const requestBody = {
        prompt,
        model,
        max_tokens: maxTokens,
        temperature,
        stream,
        ...additionalParams,
      };

      // Add API key if configured
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const requestConfig = {
        headers,
        responseType: stream ? 'stream' : 'json',
        timeout: stream ? 0 : this.config.timeoutMs, // No timeout for streaming
      };

      // Add abort signal if provided
      if (signal) {
        requestConfig.signal = signal;
      }

      const response = await this.client.post('/completions', requestBody, requestConfig);

      // For streaming, pipe the response stream
      if (stream) {
        const passThrough = new PassThrough();
        response.data.pipe(passThrough);

        // Handle stream errors
        response.data.on('error', (error) => {
          logger.error('vLLM stream error:', error);
          passThrough.destroy(error);
        });

        return passThrough;
      }

      return this.formatResponse(response.data);
    } catch (error) {
      // Handle abort/cancellation
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        const err = new Error('Request was cancelled');
        err.status = 499; // Client Closed Request
        err.cancelled = true;
        throw err;
      }
      throw this.handleError(error);
    }
  }

  /**
   * Send a chat completion request to the LLM API
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
   * @returns {Promise<Object>} The API response
   */
  async sendChatCompletion({
    messages,
    model = this.config.model,
    maxTokens = 1000,
    temperature = 0.7,
    stream = false,
    tools = null,
    tool_choice = null,
    signal = null,
    additionalParams = {},
  }) {
    try {
      const requestBody = {
        messages,
        model,
        max_tokens: maxTokens,
        temperature,
        stream,
        ...additionalParams,
      };

      // Add tools if provided
      if (tools) {
        requestBody.tools = tools;
      }

      // Add tool_choice if provided
      if (tool_choice) {
        requestBody.tool_choice = tool_choice;
      }

      // Add API key if configured
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const requestConfig = {
        headers,
        responseType: stream ? 'stream' : 'json',
        timeout: stream ? 0 : this.config.timeoutMs, // No timeout for streaming
      };

      // Add abort signal if provided
      if (signal) {
        requestConfig.signal = signal;
      }

      const response = await this.client.post('/v1/chat/completions', requestBody, requestConfig);

      // For streaming, pipe the response stream
      if (stream) {
        const passThrough = new PassThrough();
        response.data.pipe(passThrough);

        // Handle stream errors
        response.data.on('error', (error) => {
          logger.error('vLLM stream error:', error);
          passThrough.destroy(error);
        });

        return passThrough;
      }

      return this.formatResponse(response.data);
    } catch (error) {
      // Handle abort/cancellation
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        const err = new Error('Request was cancelled');
        err.status = 499; // Client Closed Request
        err.cancelled = true;
        throw err;
      }
      throw this.handleError(error);
    }
  }

  /**
   * Format the API response to a consistent structure
   * @param {Object} data - Raw API response
   * @returns {Object} Formatted response
   */
formatResponse(data) {    if (data.choices && Array.isArray(data.choices)) {      return data;    }    if (data.response || data.text || data.content) {      const content = data.response || data.text || data.content;      return {        choices: [{          message: {            role: 'assistant',            content: content          }        }],        model: data.model || this.config.model,        usage: data.usage || {}      };    }    return {      choices: [{        message: {          role: 'assistant',          content: JSON.stringify(data)        }      }],      model: this.config.model,      usage: {}    };  }

  /**
   * Handle API errors
   * @param {Error} error - The error object
   * @returns {Error} Formatted error
   */
  handleError(error) {
    if (error.response) {
      // API returned an error response
      const err = new Error(
        error.response.data?.error?.message ||
        error.response.data?.message ||
        `LLM API error: ${error.response.status}`
      );
      err.status = error.response.status;
      err.data = error.response.data;
      return err;
    } else if (error.request) {
      // Request was made but no response received
      const err = new Error('No response from LLM API');
      err.status = 503;
      return err;
    } else {
      // Something else happened
      const err = new Error(error.message);
      err.status = 500;
      return err;
    }
  }

  /**
   * Health check for the LLM API
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', {
        timeout: 5000,
      });

      return {
        status: 'healthy',
        apiUrl: this.config.url,
        response: response.data,
      };
    } catch (error) {
      // Some APIs might not have a health endpoint
      // Try a simple connection test
      try {
        await this.client.get('/', { timeout: 5000 });
        return {
          status: 'connected',
          apiUrl: this.config.url,
        };
      } catch {
        return {
          status: 'unhealthy',
          apiUrl: this.config.url,
          error: error.message,
        };
      }
    }
  }

  /**
   * Get available models from the LLM API
   * @returns {Promise<Object>} Available models
   */
  async getAvailableModels() {
    try {
      // Add API key if configured
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      // vLLM uses OpenAI-compatible /v1/models endpoint
      const response = await this.client.get('/v1/models', {
        headers,
        timeout: 5000,
      });

      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
}

export default new LLMProvider();