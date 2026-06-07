import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import yandexCloudService from './yandexCloudService.js';

/**
 * VM Manager
 * Manages VM lifecycle, idle timeout, and request queuing
 */
class VMManager {
  constructor() {
    this.instanceId = null;
    this.vllmHealthUrl = null;
    this.lastRequestTime = null;
    this.idleTimeoutMs = config.yandexCloud.idleTimeoutMs;
    this.idleTimer = null;
    this.requestQueue = [];
    this.isStarting = false;
    this.isInitialized = false;
    this.activeRequests = 0;
    this.isStopping = false;
  }

  /**
   * Initialize the VM manager
   * @param {string} instanceId - Yandex Cloud VM instance ID
   * @param {string} vllmHealthUrl - vLLM health check URL
   */
  async initialize(instanceId, vllmHealthUrl) {
    this.instanceId = instanceId;
    this.vllmHealthUrl = vllmHealthUrl;
    this.isInitialized = true;
    logger.info('VM Manager initialized', {
      instanceId,
      vllmHealthUrl,
      idleTimeoutMs: this.idleTimeoutMs,
    });
  }

  /**
   * Track a new request and reset idle timer
   */
  trackRequest() {
    this.lastRequestTime = Date.now();
    this.resetIdleTimer();
  }

  /**
   * Reset the idle timer
   */
  resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(async () => {
      await this.handleIdleTimeout();
    }, this.idleTimeoutMs);
  }

  /**
   * Handle idle timeout - stop the VM
   */
  async handleIdleTimeout() {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;

    if (timeSinceLastRequest >= this.idleTimeoutMs) {
      logger.info('Idle timeout reached, stopping VM', {
        instanceId: this.instanceId,
        timeSinceLastRequest,
      });

      try {
        await this.stopVM();
      } catch (error) {
        logger.error('Failed to stop VM on idle timeout:', error);
      }
    }
  }

  /**
   * Stop the idle timer
   */
  stopIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Check if VM is ready (running and vLLM is healthy)
   * @returns {Promise<boolean>} True if VM is ready
   */
  async isVMReady() {
    try {
      // First check if VM is running
      const isRunning = await yandexCloudService.isInstanceRunning(this.instanceId);
      if (!isRunning) {
        return false;
      }

      // Then check if vLLM is healthy
      return await this.isVLLMHealthy();
    } catch (error) {
      logger.error('Error checking VM readiness:', error);
      return false;
    }
  }

  /**
   * Check if vLLM service is healthy
   * @returns {Promise<boolean>} True if healthy
   */
  async isVLLMHealthy() {
    try {
      const response = await axios.get(this.vllmHealthUrl, {
        timeout: 5000,
        validateStatus: (status) => status === 200,
      });

      return response.status === 200;
    } catch (error) {
      logger.debug('vLLM health check failed:', error.message);
      return false;
    }
  }

  /**
   * Start the VM and wait for it to be ready
   * @returns {Promise<void>}
   */
  async startVM() {
    if (this.isStarting) {
      logger.debug('VM is already starting, skipping duplicate start request');
      return;
    }

    this.isStarting = true;

    try {
      logger.info('Starting VM', { instanceId: this.instanceId });

      // Check current status
      const instance = await yandexCloudService.getInstance(this.instanceId);

      if (instance.status === 'RUNNING') {
        logger.info('VM is already running');
      } else if (instance.status === 'STOPPED') {
        // Start the VM
        await yandexCloudService.startInstance(this.instanceId);

        // Wait for VM to be running
        const isRunning = await yandexCloudService.waitForInstanceRunning(
          this.instanceId,
          300000, // 5 minutes max
          2000    // 2 second polling interval
        );

        if (!isRunning) {
          throw new Error('VM failed to start within timeout');
        }
      } else {
        logger.info('VM is in transitional state, waiting...', { status: instance.status });

        // Wait for VM to be running
        const isRunning = await yandexCloudService.waitForInstanceRunning(
          this.instanceId,
          300000,
          2000
        );

        if (!isRunning) {
          throw new Error('VM failed to reach running state');
        }
      }

      // Wait for vLLM to be healthy
      logger.info('Waiting for vLLM to be healthy...');
      const maxWaitMs = 480000; // 8 minutes
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        if (await this.isVLLMHealthy()) {
          logger.info('vLLM is healthy');
          this.trackRequest(); // Start tracking after VM is ready
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      throw new Error('vLLM failed to become healthy within timeout');
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Wait for active requests to complete
   * @param {number} maxWaitMs - Maximum time to wait
   * @returns {Promise<boolean>} True if all requests completed
   */
  async waitForActiveRequests(maxWaitMs) {
    const startTime = Date.now();
    const pollInterval = 500; // Check every 500ms

    while (this.activeRequests > 0 && Date.now() - startTime < maxWaitMs) {
      logger.info('Waiting for active requests to complete', {
        activeRequests: this.activeRequests,
        remainingMs: maxWaitMs - (Date.now() - startTime),
      });
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (this.activeRequests > 0) {
      logger.warn('Timeout waiting for active requests to complete', {
        activeRequests: this.activeRequests,
      });
      return false;
    }

    logger.info('All active requests completed');
    return true;
  }

  /**
   * Stop the VM gracefully
   * @param {boolean} waitForRequests - Whether to wait for active requests to complete
   * @returns {Promise<void>}
   */
  async stopVM(waitForRequests = true) {
    try {
      logger.info('Stopping VM', {
        instanceId: this.instanceId,
        activeRequests: this.activeRequests,
        waitForRequests,
      });

      // Signal that we're stopping to prevent new requests
      this.isStopping = true;

      // Wait for active requests to complete if requested
      if (waitForRequests && this.activeRequests > 0) {
        const gracePeriod = config.yandexCloud.shutdownGracePeriodMs;
        logger.info('Waiting for active requests to complete before stopping VM', {
          gracePeriodMs: gracePeriod,
        });
        await this.waitForActiveRequests(gracePeriod);
      }

      const instance = await yandexCloudService.getInstance(this.instanceId);

      if (instance.status === 'STOPPED') {
        logger.info('VM is already stopped');
        this.isStopping = false;
        return;
      }

      if (instance.status === 'RUNNING') {
        await yandexCloudService.stopInstance(this.instanceId);
        logger.info('VM stop initiated');
      } else {
        logger.info('VM is in transitional state, not stopping', { status: instance.status });
      }

      this.stopIdleTimer();
      this.isStopping = false;
    } catch (error) {
      logger.error('Failed to stop VM:', error);
      this.isStopping = false;
      throw error;
    }
  }

  /**
   * Ensure VM is ready, starting if necessary
   * Returns a promise that resolves when VM is ready
   * @returns {Promise<void>}
   */
  async ensureVMReady() {
    // Check if already ready
    if (await this.isVMReady()) {
      this.trackRequest();
      return;
    }

    // Start VM if not ready
    await this.startVM();
  }

  /**
   * Queue a request to be executed when VM is ready
   * @param {Function} requestHandler - Function to execute when VM is ready
   * @returns {Promise<any>} Result of the request handler
   */
  async queueRequest(requestHandler) {
    // Reject new requests if we're stopping
    if (this.isStopping) {
      throw new Error('VM is shutting down, not accepting new requests');
    }

    this.activeRequests++;
    logger.debug('Request started', { activeRequests: this.activeRequests });

    try {
      // Ensure VM is ready
      await this.ensureVMReady();

      // Execute the request
      const result = await requestHandler();
      return result;
    } finally {
      this.activeRequests--;
      logger.debug('Request completed', { activeRequests: this.activeRequests });
    }
  }

  /**
   * Graceful shutdown - stop VM before exit (if configured)
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('VM Manager shutdown initiated');
    this.stopIdleTimer();

    if (config.yandexCloud.stopOnShutdown) {
      try {
        await this.stopVM();
        logger.info('VM Manager shutdown complete');
      } catch (error) {
        logger.error('Error during VM Manager shutdown:', error);
        throw error;
      }
    } else {
      logger.info('VM Manager shutdown complete (VM left running)');
    }
  }
}

export default new VMManager();
