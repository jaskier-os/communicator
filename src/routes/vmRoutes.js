import Router from '@koa/router';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import vmManager from '../services/vmManager.js';
import yandexCloudService from '../services/yandexCloudService.js';

const router = new Router();

/**
 * GET /status
 * Get current VM status
 */
router.get('/status', async (ctx) => {
  try {
    // Check if VM management is enabled
    if (!config.yandexCloud.enabled) {
      ctx.status = 503;
      ctx.body = {
        error: {
          message: 'VM management is not enabled',
        },
      };
      return;
    }

    // Get VM instance details from Yandex Cloud
    const instance = await yandexCloudService.getInstance(vmManager.instanceId);

    // Check if vLLM is healthy
    const isVLLMHealthy = await vmManager.isVLLMHealthy();
    const isReady = instance.status === 'RUNNING' && isVLLMHealthy;

    ctx.body = {
      vm: {
        id: instance.id,
        name: instance.name,
        status: instance.status,
        folderId: instance.folderId,
        zoneId: instance.zoneId,
        createdAt: instance.createdAt,
      },
      vllm: {
        healthy: isVLLMHealthy,
        healthUrl: vmManager.vllmHealthUrl,
      },
      ready: isReady,
      activeRequests: vmManager.activeRequests,
      lastRequestTime: vmManager.lastRequestTime,
      isStarting: vmManager.isStarting,
      isStopping: vmManager.isStopping,
    };

    logger.info('VM status requested', {
      status: instance.status,
      ready: isReady,
    });
  } catch (error) {
    logger.error('Failed to get VM status:', error);
    ctx.status = 500;
    ctx.body = {
      error: {
        message: 'Failed to get VM status',
        details: error.message,
      },
    };
  }
});

/**
 * POST /start
 * Start the VM
 */
router.post('/start', async (ctx) => {
  try {
    // Check if VM management is enabled
    if (!config.yandexCloud.enabled) {
      ctx.status = 503;
      ctx.body = {
        error: {
          message: 'VM management is not enabled',
        },
      };
      return;
    }

    logger.info('VM start requested via API');

    // Check if already starting
    if (vmManager.isStarting) {
      ctx.body = {
        message: 'VM is already starting',
        status: 'starting',
      };
      return;
    }

    // Check current status
    const instance = await yandexCloudService.getInstance(vmManager.instanceId);

    if (instance.status === 'RUNNING') {
      // Check if vLLM is healthy
      const isVLLMHealthy = await vmManager.isVLLMHealthy();

      ctx.body = {
        message: 'VM is already running',
        status: 'running',
        vllmHealthy: isVLLMHealthy,
      };
      return;
    }

    // Start the VM (this will also wait for vLLM to be healthy)
    await vmManager.startVM();

    ctx.body = {
      message: 'VM started successfully',
      status: 'running',
      instanceId: vmManager.instanceId,
    };

    logger.info('VM started successfully via API');
  } catch (error) {
    logger.error('Failed to start VM:', error);
    ctx.status = 500;
    ctx.body = {
      error: {
        message: 'Failed to start VM',
        details: error.message,
      },
    };
  }
});

/**
 * POST /stop
 * Stop the VM
 */
router.post('/stop', async (ctx) => {
  try {
    // Check if VM management is enabled
    if (!config.yandexCloud.enabled) {
      ctx.status = 503;
      ctx.body = {
        error: {
          message: 'VM management is not enabled',
        },
      };
      return;
    }

    // Get optional query parameters
    const waitForRequests = ctx.request.query.waitForRequests !== 'false'; // default true

    logger.info('VM stop requested via API', { waitForRequests });

    // Check current status
    const instance = await yandexCloudService.getInstance(vmManager.instanceId);

    if (instance.status === 'STOPPED') {
      ctx.body = {
        message: 'VM is already stopped',
        status: 'stopped',
      };
      return;
    }

    // Stop the VM
    await vmManager.stopVM(waitForRequests);

    ctx.body = {
      message: 'VM stopped successfully',
      status: 'stopped',
      instanceId: vmManager.instanceId,
    };

    logger.info('VM stopped successfully via API');
  } catch (error) {
    logger.error('Failed to stop VM:', error);
    ctx.status = 500;
    ctx.body = {
      error: {
        message: 'Failed to stop VM',
        details: error.message,
      },
    };
  }
});

export default router;
