#!/usr/bin/env node

/**
 * Example Client for LLM Communicator
 *
 * Demonstrates how to connect to the LLM Communicator API from a client host
 * with API key authentication.
 *
 * Usage:
 *   node scripts/example-client.js
 *
 * Environment variables:
 *   API_URL - The LLM Communicator API URL (default: http://localhost:3000)
 *   API_KEY - Your API key for authentication (required)
 */

import https from 'https';
import http from 'http';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
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
 * Make a request to the LLM Communicator API
 */
async function makeRequest(endpoint, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = httpModule.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Test health endpoint (no auth required)
 */
async function testHealth() {
  console.log('Testing health endpoint...');
  try {
    const result = await makeRequest('/api/health', 'GET');
    console.log('✓ Health check:', result);
  } catch (error) {
    console.error('✗ Health check failed:', error.message);
  }
}

/**
 * Test simple prompt endpoint (auth required)
 */
async function testSimplePrompt() {
  console.log('\nTesting simple prompt endpoint...');
  try {
    const result = await makeRequest('/api/prompts', 'POST', {
      prompt: 'What is the capital of France?',
      maxTokens: 100,
      temperature: 0.7
    });
    console.log('✓ Simple prompt:', result);
  } catch (error) {
    console.error('✗ Simple prompt failed:', error.message);
  }
}

/**
 * Test chat completion endpoint (auth required)
 */
async function testChatCompletion() {
  console.log('\nTesting chat completion endpoint...');
  try {
    const result = await makeRequest('/api/prompts/chat', 'POST', {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' }
      ],
      maxTokens: 100,
      temperature: 0.7
    });
    console.log('✓ Chat completion:', result);
  } catch (error) {
    console.error('✗ Chat completion failed:', error.message);
  }
}

/**
 * Test without API key (should fail)
 */
async function testNoAuth() {
  console.log('\nTesting without authentication (should fail)...');
  try {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/api/prompts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header
      }
    };

    const bodyStr = JSON.stringify({
      prompt: 'Test',
      maxTokens: 10
    });

    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('✓ No auth test (expected failure):', {
          status: res.statusCode,
          data: JSON.parse(data)
        });
      });
    });

    req.on('error', (error) => {
      console.error('✗ Request error:', error.message);
    });

    req.write(bodyStr);
    req.end();
  } catch (error) {
    console.error('✗ No auth test failed:', error.message);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('LLM Communicator API Client Example');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  console.log('='.repeat(60));

  await testHealth();
  await testSimplePrompt();
  await testChatCompletion();
  await testNoAuth();

  console.log('\n' + '='.repeat(60));
  console.log('Tests completed!');
  console.log('='.repeat(60));
}

// Run main function
main().catch(console.error);
