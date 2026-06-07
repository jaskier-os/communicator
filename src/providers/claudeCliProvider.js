import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import BaseProvider from './baseProvider.js';

class ClaudeCliProvider extends BaseProvider {
  constructor() {
    super();
    this.claudeCommand = config.llm.claudeCliCommand;
  }

  /**
   * Convert OpenAI-style messages to a single prompt for Claude CLI
   */
  messagesToPrompt(messages) {
    return messages
      .map(msg => {
        const role = msg.role === 'assistant' ? 'Assistant' : 'User';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * Spawn Claude CLI process and get response
   */
  async executeClaudeCli(prompt, { stream = false, signal = null } = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isAborted = false;

      // Spawn Claude CLI process
      const child = spawn(this.claudeCommand, [], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      logger.debug('Claude CLI process spawned', { pid: child.pid });

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          isAborted = true;
          logger.info('Aborting Claude CLI process', { pid: child.pid });
          child.kill('SIGTERM');

          const err = new Error('Request was cancelled');
          err.status = 499;
          err.cancelled = true;
          reject(err);
        });
      }

      // Create stream for streaming responses
      const passThrough = stream ? new PassThrough() : null;

      // Collect stdout
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        if (stream && passThrough) {
          // Format as SSE for streaming
          const sseData = this.formatStreamChunk(chunk);
          passThrough.write(sseData);
        }
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        if (isAborted) {
          return; // Already rejected
        }

        if (code === 0) {
          logger.debug('Claude CLI process completed', { pid: child.pid });

          if (stream && passThrough) {
            passThrough.write('data: [DONE]\n\n');
            passThrough.end();
            resolve(passThrough);
          } else {
            // Return formatted response
            const response = this.formatResponse({
              content: stdout.trim(),
              model: 'claude-cli',
            });
            resolve(response);
          }
        } else {
          logger.error('Claude CLI process failed', {
            pid: child.pid,
            code,
            stderr: stderr.trim()
          });

          const err = new Error(stderr.trim() || `Claude CLI exited with code ${code}`);
          err.status = 500;
          reject(err);
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        logger.error('Claude CLI process error', { error: error.message });

        const err = new Error(`Failed to spawn Claude CLI: ${error.message}`);
        err.status = 500;
        reject(err);
      });

      // Write prompt to stdin
      try {
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (error) {
        logger.error('Error writing to Claude CLI stdin', { error: error.message });
        child.kill('SIGTERM');

        const err = new Error(`Failed to send prompt to Claude CLI: ${error.message}`);
        err.status = 500;
        reject(err);
      }
    });
  }

  /**
   * Format a chunk for SSE streaming (OpenAI-compatible format)
   */
  formatStreamChunk(text) {
    const chunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'claude-cli',
      choices: [{
        index: 0,
        delta: {
          content: text
        },
        finish_reason: null
      }]
    };

    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  /**
   * Send a prompt to Claude CLI
   */
  async sendPrompt({
    prompt,
    model = 'claude-cli',
    maxTokens = 4000,
    temperature = 0.7,
    stream = false,
    signal = null,
    additionalParams = {},
  }) {
    try {
      logger.info('Sending prompt to Claude CLI', {
        promptLength: prompt.length,
        stream
      });

      return await this.executeClaudeCli(prompt, { stream, signal });
    } catch (error) {
      if (error.cancelled) {
        throw error;
      }
      throw this.handleError(error);
    }
  }

  /**
   * Send a chat completion request to Claude CLI
   */
  async sendChatCompletion({
    messages,
    model = 'claude-cli',
    maxTokens = 4000,
    temperature = 0.7,
    stream = false,
    tools = null,
    tool_choice = null,
    signal = null,
    additionalParams = {},
  }) {
    try {
      logger.info('Sending chat completion to Claude CLI', {
        messageCount: messages.length,
        stream
      });

      // Convert messages to a single prompt
      const prompt = this.messagesToPrompt(messages);

      // Add tool information to prompt if provided
      let fullPrompt = prompt;
      if (tools && tools.length > 0) {
        const toolsJson = JSON.stringify(tools, null, 2);
        fullPrompt = `${prompt}\n\nAvailable tools:\n${toolsJson}`;
      }

      return await this.executeClaudeCli(fullPrompt, { stream, signal });
    } catch (error) {
      if (error.cancelled) {
        throw error;
      }
      throw this.handleError(error);
    }
  }

  /**
   * Handle errors
   */
  handleError(error) {
    if (error.status) {
      return error;
    }

    const err = new Error(error.message || 'Claude CLI error');
    err.status = 500;
    return err;
  }

  /**
   * Health check for Claude CLI
   */
  async healthCheck() {
    try {
      // Try to run Claude CLI with --version or --help to verify it's available
      return new Promise((resolve, reject) => {
        const child = spawn(this.claudeCommand, ['--version'], {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          output += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0 || output.length > 0) {
            resolve({
              status: 'healthy',
              provider: 'claude-cli',
              version: output.trim() || 'available',
            });
          } else {
            resolve({
              status: 'unhealthy',
              provider: 'claude-cli',
              error: 'Claude CLI not responding',
            });
          }
        });

        child.on('error', (error) => {
          resolve({
            status: 'unhealthy',
            provider: 'claude-cli',
            error: `Claude CLI not found: ${error.message}`,
          });
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          child.kill('SIGTERM');
          resolve({
            status: 'unhealthy',
            provider: 'claude-cli',
            error: 'Health check timeout',
          });
        }, 5000);
      });
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: 'claude-cli',
        error: error.message,
      };
    }
  }

  /**
   * Get available models (Claude CLI doesn't have a models endpoint)
   */
  async getAvailableModels() {
    return {
      data: [
        {
          id: 'claude-cli',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'anthropic',
        }
      ]
    };
  }
}

export default ClaudeCliProvider;
