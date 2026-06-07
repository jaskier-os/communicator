import axios from 'axios';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import logger from '../utils/logger.js';

/**
 * Yandex Cloud VM Management Service
 * Handles IAM token generation and VM operations (start, stop, get status)
 */
class YandexCloudService {
  constructor() {
    this.iamToken = null;
    this.iamTokenExpiresAt = null;
    this.serviceAccountKey = null;
  }

  /**
   * Initialize the service with service account key
   * @param {string} keyFilePath - Path to the service account key JSON file
   */
  async initialize(keyFilePath) {
    try {
      const keyContent = await fs.readFile(keyFilePath, 'utf-8');
      this.serviceAccountKey = JSON.parse(keyContent);
      logger.info('Yandex Cloud service initialized');
    } catch (error) {
      logger.error('Failed to initialize Yandex Cloud service:', error);
      throw error;
    }
  }

  /**
   * Get a valid IAM token, refreshing if necessary
   * @returns {Promise<string>} IAM token
   */
  async getIAMToken() {
    const now = Date.now();

    // Check if we have a valid token
    if (this.iamToken && this.iamTokenExpiresAt && now < this.iamTokenExpiresAt) {
      return this.iamToken;
    }

    // Generate new token
    try {
      const jwtToken = this.generateJWT();

      const response = await axios.post(
        'https://iam.api.cloud.yandex.net/iam/v1/tokens',
        { jwt: jwtToken },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      this.iamToken = response.data.iamToken;
      // IAM tokens are valid for 12 hours, but we'll refresh after 11 hours to be safe
      this.iamTokenExpiresAt = now + (11 * 60 * 60 * 1000);

      logger.debug('IAM token refreshed');
      return this.iamToken;
    } catch (error) {
      logger.error('Failed to get IAM token:', error);
      throw new Error(`Failed to get IAM token: ${error.message}`);
    }
  }

  /**
   * Generate JWT for IAM token exchange
   * @returns {string} JWT token
   */
  generateJWT() {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      aud: 'https://iam.api.cloud.yandex.net/iam/v1/tokens',
      iss: this.serviceAccountKey.service_account_id,
      iat: now,
      exp: now + 3600, // JWT valid for 1 hour
    };

    return jwt.sign(payload, this.serviceAccountKey.private_key, {
      algorithm: 'PS256',
      keyid: this.serviceAccountKey.id,
    });
  }

  /**
   * Get VM instance status
   * @param {string} instanceId - VM instance ID
   * @returns {Promise<Object>} VM instance details
   */
  async getInstance(instanceId) {
    try {
      const token = await this.getIAMToken();

      const response = await axios.get(
        `https://compute.api.cloud.yandex.net/compute/v1/instances/${instanceId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      logger.debug('VM instance status:', {
        id: instanceId,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to get VM instance:', error);
      throw new Error(`Failed to get VM instance: ${error.message}`);
    }
  }

  /**
   * Start a VM instance
   * @param {string} instanceId - VM instance ID
   * @returns {Promise<Object>} Operation details
   */
  async startInstance(instanceId) {
    try {
      const token = await this.getIAMToken();

      const response = await axios.post(
        `https://compute.api.cloud.yandex.net/compute/v1/instances/${instanceId}:start`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      logger.info('VM instance start initiated:', {
        id: instanceId,
        operationId: response.data.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to start VM instance:', error);
      throw new Error(`Failed to start VM instance: ${error.message}`);
    }
  }

  /**
   * Stop a VM instance
   * @param {string} instanceId - VM instance ID
   * @returns {Promise<Object>} Operation details
   */
  async stopInstance(instanceId) {
    try {
      const token = await this.getIAMToken();

      const response = await axios.post(
        `https://compute.api.cloud.yandex.net/compute/v1/instances/${instanceId}:stop`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      logger.info('VM instance stop initiated:', {
        id: instanceId,
        operationId: response.data.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to stop VM instance:', error);
      throw new Error(`Failed to stop VM instance: ${error.message}`);
    }
  }

  /**
   * Check if VM is in RUNNING state
   * @param {string} instanceId - VM instance ID
   * @returns {Promise<boolean>} True if running
   */
  async isInstanceRunning(instanceId) {
    try {
      const instance = await this.getInstance(instanceId);
      return instance.status === 'RUNNING';
    } catch (error) {
      logger.error('Failed to check if instance is running:', error);
      return false;
    }
  }

  /**
   * Wait for instance to reach RUNNING state
   * @param {string} instanceId - VM instance ID
   * @param {number} maxWaitMs - Maximum time to wait in milliseconds
   * @param {number} pollIntervalMs - Polling interval in milliseconds
   * @returns {Promise<boolean>} True if instance is running
   */
  async waitForInstanceRunning(instanceId, maxWaitMs = 300000, pollIntervalMs = 2000) {
    const startTime = Date.now();
    let seenTransitioning = false;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const instance = await this.getInstance(instanceId);

        if (instance.status === 'RUNNING') {
          logger.info('VM instance is running:', { id: instanceId });
          return true;
        }

        // Track if we've seen any transitional state
        // Transitional states: PROVISIONING, STARTING, RESTARTING, CRASHED (auto-restart)
        if (['PROVISIONING', 'STARTING', 'RESTARTING', 'CRASHED'].includes(instance.status)) {
          seenTransitioning = true;
        }

        // ERROR is immediately fatal
        // STOPPED is only fatal if we've already seen it transitioning and it went back to STOPPED
        if (instance.status === 'ERROR' || (instance.status === 'STOPPED' && seenTransitioning)) {
          logger.error('VM instance is in non-recoverable state:', {
            id: instanceId,
            status: instance.status
          });
          return false;
        }

        logger.debug('Waiting for VM instance to start:', {
          id: instanceId,
          status: instance.status,
        });

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        logger.error('Error while waiting for instance:', error);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    logger.error('Timeout waiting for VM instance to start:', { id: instanceId });
    return false;
  }
}

export default new YandexCloudService();
