import app from './app.js';
import config from './config/index.js';
import logger from './utils/logger.js';
import yandexCloudService from './services/yandexCloudService.js';
import vmManager from './services/vmManager.js';
const PORT = config.server.port;
const HOST = config.server.host;

// Initialize Yandex Cloud VM management if enabled
const initializeVMManagement = async () => {
  if (config.yandexCloud.enabled) {
    try {
      logger.info('Initializing Yandex Cloud VM management...');

      // Initialize Yandex Cloud service
      await yandexCloudService.initialize(config.yandexCloud.serviceAccountKeyPath);

      // Initialize VM manager
      await vmManager.initialize(
        config.yandexCloud.vmInstanceId,
        config.yandexCloud.vllmHealthUrl
      );

      logger.info('Yandex Cloud VM management initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Yandex Cloud VM management:', error);
      throw error;
    }
  }
};

// Start server
const server = app.listen(PORT, HOST, async () => {
  logger.info(`LLM Communicator server started`, {
    host: HOST,
    port: PORT,
    environment: config.server.nodeEnv,
    llmApiUrl: config.llm.url,
    vmManagementEnabled: config.yandexCloud.enabled,
  });

  logger.info(`Server running at http://${HOST}:${PORT}`);
  logger.info(`API documentation available at http://${HOST}:${PORT}/api`);

  // Initialize VM management after server starts
  try {
    await initializeVMManagement();
  } catch (error) {
    logger.error('VM management initialization failed, server will continue without it');
  }
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop VM first if enabled
  if (config.yandexCloud.enabled) {
    try {
      logger.info('Stopping VM before shutdown...');
      await vmManager.shutdown();
      logger.info('VM stopped successfully');
    } catch (error) {
      logger.error('Failed to stop VM during shutdown:', error);
    }
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 15 seconds (increased from 10 to allow VM stop)
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 15000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export default server;