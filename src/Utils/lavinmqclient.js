import amqp from 'amqplib';
import { logger } from './logger.js'; // Import logger for better error tracking

let rabbitChannel;
let connection;

async function connectRabbit() {
  const maxRetries = 5;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempting to connect to RabbitMQ (attempt ${attempt}/${maxRetries})...`);
      connection = await amqp.connect(process.env.CLOUDAMQP_URL || 'amqp://localhost');
      rabbitChannel = await connection.createChannel();
      await rabbitChannel.assertQueue('libreoffice-queue', { durable: true });
      await rabbitChannel.assertQueue('poppler-queue', { durable: true });
      logger.info('RabbitMQ connected and channels created');
      return; // Success, exit the retry loop
    } catch (err) {
      logger.error(`RabbitMQ connection failed (attempt ${attempt}/${maxRetries}):`, err.message);
      if (attempt === maxRetries) {
        logger.error('Max retries reached. RabbitMQ connection failed.');
        throw new Error('Failed to connect to RabbitMQ after maximum retries');
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Initialize connection and handle errors
let connectionPromise = connectRabbit().catch(err => {
  logger.error('Initial RabbitMQ connection failed:', err);
  throw err; // Let the server fail to start if RabbitMQ is critical
});

// Function to ensure channel is ready
async function getRabbitChannel() {
  if (!rabbitChannel) {
    await connectionPromise; // Wait for the connection to be established
  }
  if (!rabbitChannel) {
    throw new Error('RabbitMQ channel is not initialized');
  }
  return rabbitChannel;
}

// Close connection gracefully on shutdown
async function closeRabbitConnection() {
  try {
    if (rabbitChannel) {
      await rabbitChannel.close();
      logger.info('RabbitMQ channel closed');
    }
    if (connection) {
      await connection.close();
      logger.info('RabbitMQ connection closed');
    }
  } catch (err) {
    logger.error('Error closing RabbitMQ connection:', err);
  }
}

export { getRabbitChannel, closeRabbitConnection };