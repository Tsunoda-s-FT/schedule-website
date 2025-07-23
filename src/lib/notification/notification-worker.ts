
import { prisma } from '@/lib/prisma';
import { Notification, NotificationStatus } from '@prisma/client';
import { sendLineMulticast } from '@/lib/line-multi-channel';
import { getChannelCredentials } from '@/lib/line-multi-channel';

const MAX_ATTEMPTS = 3;

// Configurable worker settings
interface WorkerConfig {
  batchSize: number;
  maxConcurrency: number;
  maxExecutionTimeMs: number;
  delayBetweenBatchesMs: number;
}

// Default configuration - can be overridden via environment variables
const DEFAULT_CONFIG: WorkerConfig = {
  batchSize: parseInt(process.env.NOTIFICATION_WORKER_BATCH_SIZE || '10'),
  maxConcurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '3'),
  maxExecutionTimeMs: parseInt(process.env.NOTIFICATION_WORKER_MAX_TIME || '300000'), // 5 minutes
  delayBetweenBatchesMs: parseInt(process.env.NOTIFICATION_WORKER_DELAY || '1000'), // 1 second
};

interface WorkerResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  executionTimeMs: number;
  batches: number;
}

/**
 * Processes a single notification. This function is designed to be robust.
 * It marks the notification as PROCESSING and increments attempts first.
 * Then, it tries to send the notification. If it succeeds, it marks it as SENT.
 * If it fails at any point, it marks it as FAILED and re-throws the error.
 *
 * @param notification - The notification to process.
 */
const processNotification = async (notification: Notification): Promise<void> => {
  // Immediately mark as processing and increment attempt count.
  // This prevents other workers from picking up the same job.
  await prisma.notification.update({
    where: { notificationId: notification.notificationId },
    data: {
      status: NotificationStatus.PROCESSING,
      processingAttempts: { increment: 1 },
    },
  });

  try {
    // Get the recipient's LINE ID based on recipientType and recipientId
    let lineId: string | null = null;
    
    if (notification.recipientType === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({
        where: { teacherId: notification.recipientId! },
        select: { lineId: true, lineNotificationsEnabled: true }
      });
      if (teacher?.lineNotificationsEnabled) {
        lineId = teacher.lineId;
      }
    } else if (notification.recipientType === 'STUDENT') {
      const student = await prisma.student.findUnique({
        where: { studentId: notification.recipientId! },
        select: { lineId: true, lineNotificationsEnabled: true }
      });
      if (student?.lineNotificationsEnabled) {
        lineId = student.lineId;
      }
    }

    if (!lineId) {
      throw new Error(`No LINE ID found or notifications disabled for ${notification.recipientType} ${notification.recipientId}`);
    }

    // Get channel credentials for this branch
    const credentials = await getChannelCredentials(notification.branchId || undefined);
    
    if (credentials) {
      // Send via multi-channel
      await sendLineMulticast([lineId], notification.message!, credentials);
    } else {
      // Fallback to basic LINE function if no credentials found
      const { sendLineMulticast: fallbackMulticast } = await import('@/lib/line');
      await fallbackMulticast([lineId], notification.message!, notification.branchId || undefined);
    }

    // Mark as sent on success
    await prisma.notification.update({
      where: { notificationId: notification.notificationId },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        logs: { success: true, message: 'Message sent successfully via LINE' },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Enhanced error logging with notification context
    console.error(`❌ Failed to process notification:`, {
      notificationId: notification.notificationId,
      recipientType: notification.recipientType,
      recipientId: notification.recipientId,
      notificationType: notification.notificationType,
      branchId: notification.branchId,
      attempt: notification.processingAttempts + 1, // +1 since we incremented it earlier
      scheduledAt: notification.scheduledAt,
      targetDate: notification.targetDate,
      errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    
    // Mark as failed on any error
    await prisma.notification.update({
      where: { notificationId: notification.notificationId },
      data: {
        status: NotificationStatus.FAILED,
        logs: { 
          success: false, 
          message: errorMessage,
          context: {
            recipientType: notification.recipientType,
            recipientId: notification.recipientId,
            notificationType: notification.notificationType,
            attempt: notification.processingAttempts + 1,
            timestamp: new Date().toISOString()
          }
        },
      },
    });
    
    // Re-throw to signal failure to the batch processor
    throw error;
  }
};

/**
 * Process multiple notifications concurrently. It uses Promise.allSettled
 * to ensure that one failed notification does not stop others in the batch.
 */
async function processBatchConcurrently(
  notifications: Notification[],
  maxConcurrency: number
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;
  
  // Process in chunks to control concurrency
  for (let i = 0; i < notifications.length; i += maxConcurrency) {
    const batch = notifications.slice(i, i + maxConcurrency);
    
    const results = await Promise.allSettled(
      batch.map(notification => processNotification(notification))
    );
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful++;
      } else {
        failed++;
        const notification = batch[index];
        // Enhanced error logging with notification context
        console.error(`❌ Notification batch failure:`, {
          notificationId: notification.notificationId,
          recipientType: notification.recipientType,
          recipientId: notification.recipientId,
          notificationType: notification.notificationType,
          branchId: notification.branchId,
          attempt: notification.processingAttempts,
          scheduledAt: notification.scheduledAt,
          targetDate: notification.targetDate,
          error: result.reason
        });
      }
    });
  }
  
  return { successful, failed };
}

/**
 * Enhanced notification worker with configurable settings and performance improvements.
 */
export const runNotificationWorker = async (config: Partial<WorkerConfig> = {}): Promise<WorkerResult> => {
  const startTime = Date.now();
  const workerConfig = { ...DEFAULT_CONFIG, ...config };
  
  let totalProcessed = 0;
  let totalSuccessful = 0;
  let totalFailed = 0;
  let batches = 0;
  
  try {
    console.log(`Starting notification worker with config:`, workerConfig);
    
    while (Date.now() - startTime < workerConfig.maxExecutionTimeMs) {
      // Fetch next batch of pending notifications
      const pendingNotifications = await prisma.notification.findMany({
        where: {
          status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
          processingAttempts: { lt: MAX_ATTEMPTS },
          scheduledAt: { lte: new Date() },
        },
        take: workerConfig.batchSize,
        orderBy: [
          { processingAttempts: 'asc' }, // Process new notifications first
          { scheduledAt: 'asc' }, // Then by scheduled time
        ],
      });
      
      // If no notifications to process, break
      if (pendingNotifications.length === 0) {
        console.log('No pending notifications found. Worker completed.');
        break;
      }
      
      console.log(`Processing batch ${batches + 1} with ${pendingNotifications.length} notifications`);
      
      // Process batch with controlled concurrency
      const batchResult = await processBatchConcurrently(
        pendingNotifications,
        workerConfig.maxConcurrency
      );
      
      totalProcessed += pendingNotifications.length;
      totalSuccessful += batchResult.successful;
      totalFailed += batchResult.failed;
      batches++;
      
      console.log(`Batch ${batches} completed: ${batchResult.successful} successful, ${batchResult.failed} failed`);
      
      // Delay between batches to avoid overwhelming the system
      if (pendingNotifications.length === workerConfig.batchSize) {
        await new Promise(resolve => setTimeout(resolve, workerConfig.delayBetweenBatchesMs));
      }
    }
    
    const executionTimeMs = Date.now() - startTime;
    const result: WorkerResult = {
      totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      executionTimeMs,
      batches
    };
    
    console.log(`Notification worker completed:`, result);
    return result;
    
  } catch (error) {
    // Enhanced error logging for worker-level failures
    console.error('❌ Notification worker encountered a critical error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      batches,
      executionTimeMs: Date.now() - startTime,
      config: workerConfig
    });
    
    const executionTimeMs = Date.now() - startTime;
    
    return {
      totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      executionTimeMs,
      batches
    };
  }
};

/**
 * Legacy function for backward compatibility
 * @deprecated Use runNotificationWorker() instead
 */
export const runSimpleNotificationWorker = async (): Promise<void> => {
  await runNotificationWorker({ batchSize: 10, maxConcurrency: 1 });
};
