#!/usr/bin/env node

/**
 * Example Streaming Client for LLM Communicator
 *
 * Demonstrates how to consume streaming responses and cancel requests.
 *
 * Usage:
 *   node scripts/example-streaming-client.js
 *
 * Environment variables:
 *   API_URL - The LLM Communicator API URL (default: http://localhost:8000)
 *   API_KEY - Your API key for authentication (required)
 */

import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:8000';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('API_KEY environment variable is required');
  process.exit(1);
}

// Parse URL
const url = new URL(API_URL);
const isHttps = url.protocol === 'https:';
const httpModule = isHttps ? https : http;

/**
 * Stream chat completion with cancellation support
 */
async function streamChatCompletion(messages, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      maxTokens = 500,
      temperature = 0.7,
      onChunk = null,
      cancelAfterMs = null,
    } = options;

    const requestBody = JSON.stringify({
      messages,
      maxTokens,
      temperature,
      stream: true,
    });

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/api/prompts/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = httpModule.request(requestOptions, (res) => {
      console.log(`✓ Response status: ${res.statusCode}`);
      console.log(`✓ Content-Type: ${res.headers['content-type']}`);
      console.log('');

      let buffer = '';
      let fullResponse = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        // Process Server-Sent Events (SSE)
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              console.log('\n✓ Stream completed');
              resolve(fullResponse);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';

              if (content) {
                fullResponse += content;
                process.stdout.write(content);

                if (onChunk) {
                  onChunk(content, parsed);
                }
              }
            } catch (e) {
              // Not JSON, might be plain text streaming
              process.stdout.write(data);
              fullResponse += data;

              if (onChunk) {
                onChunk(data);
              }
            }
          }
        }
      });

      res.on('end', () => {
        console.log('\n✓ Stream ended');
        resolve(fullResponse);
      });

      res.on('error', (error) => {
        console.error('✗ Stream error:', error.message);
        reject(error);
      });
    });

    req.on('error', (error) => {
      console.error('✗ Request error:', error.message);
      reject(error);
    });

    // Auto-cancel after specified time (for demonstration)
    let cancelTimer = null;
    if (cancelAfterMs) {
      cancelTimer = setTimeout(() => {
        console.log(`\n⚠ Cancelling request after ${cancelAfterMs}ms...`);
        req.destroy();
        reject(new Error('Request cancelled by user'));
      }, cancelAfterMs);
    }

    req.write(requestBody);
    req.end();

    // Return abort function
    return {
      abort: () => {
        if (cancelTimer) clearTimeout(cancelTimer);
        req.destroy();
        reject(new Error('Request cancelled'));
      },
    };
  });
}

/**
 * Test streaming with full completion
 */
async function testFullStreaming() {
  console.log('='.repeat(60));
  console.log('Test 1: Full Streaming Response');
  console.log('='.repeat(60));
  console.log('');

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Write a haiku about programming.' },
  ];

  try {
    console.log('📤 Sending streaming chat request...\n');
    const response = await streamChatCompletion(messages);
    console.log('\n✓ Full response received');
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

/**
 * Test streaming with cancellation
 */
async function testCancelledStreaming() {
  console.log('\n' + '='.repeat(60));
  console.log('Test 2: Streaming with Cancellation');
  console.log('='.repeat(60));
  console.log('');

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Write a long story about a programmer who discovers time travel.' },
  ];

  try {
    console.log('📤 Sending streaming chat request (will cancel after 2 seconds)...\n');
    await streamChatCompletion(messages, {
      maxTokens: 2000,
      cancelAfterMs: 2000, // Cancel after 2 seconds
    });
  } catch (error) {
    if (error.message.includes('cancelled')) {
      console.log('\n✓ Request successfully cancelled');
    } else {
      console.error('✗ Error:', error.message);
    }
  }
}

/**
 * Test manual cancellation with AbortController pattern
 */
async function testManualCancellation() {
  console.log('\n' + '='.repeat(60));
  console.log('Test 3: Manual Cancellation (User Initiated)');
  console.log('='.repeat(60));
  console.log('');

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum physics in detail.' },
  ];

  const requestBody = JSON.stringify({
    messages,
    maxTokens: 2000,
    temperature: 0.7,
    stream: true,
  });

  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: '/api/prompts/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  console.log('📤 Sending streaming request...');
  console.log('⏱  Will cancel after receiving ~100 characters\n');

  const req = httpModule.request(requestOptions, (res) => {
    let charCount = 0;

    res.on('data', (chunk) => {
      process.stdout.write(chunk.toString());
      charCount += chunk.length;

      // Cancel after receiving ~100 characters
      if (charCount > 100) {
        console.log('\n\n⚠ Cancelling request...');
        req.destroy();
      }
    });

    res.on('end', () => {
      console.log('\n✓ Stream ended naturally');
    });

    res.on('error', (error) => {
      if (error.code === 'ECONNRESET') {
        console.log('✓ Connection reset (request cancelled successfully)');
      } else {
        console.error('✗ Error:', error.message);
      }
    });
  });

  req.on('error', (error) => {
    if (error.code === 'ECONNRESET') {
      console.log('✓ Request cancelled successfully');
    } else {
      console.error('✗ Request error:', error.message);
    }
  });

  req.write(requestBody);
  req.end();

  // Wait a bit for the test to complete
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('LLM Communicator Streaming Client Examples');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  console.log('='.repeat(60));
  console.log('');

  await testFullStreaming();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await testCancelledStreaming();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await testManualCancellation();

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
}

// Run main function
main().catch(console.error);
