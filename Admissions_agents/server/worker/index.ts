import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });
dotenv.config();

import { runOnce } from './runner';
import { runJobTick, getJobStats } from './job-queue';
import { scheduleRecurringJobs } from './job-handlers';
import { closeAllContexts } from './browser-manager';
import { logger } from './logger';

const RPA_TASK_INTERVAL_MS = Number(process.env.RPA_TICK_INTERVAL_MS) || 30_000;
const JOB_TICK_INTERVAL_MS = Number(process.env.JOB_TICK_INTERVAL_MS) || 10_000;
const RECURRING_SCHEDULE_INTERVAL_MS = Number(process.env.RECURRING_SCHEDULE_INTERVAL_MS) || 60_000;
const STATS_INTERVAL_MS = 5 * 60_000;

let rpaRunning = false;
const rpaTaskTick = async (): Promise<void> => {
  if (rpaRunning) return;
  rpaRunning = true;
  try {
    await runOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('worker', 'rpa tick 异常', { error: message });
  } finally {
    rpaRunning = false;
  }
};

let jobRunning = false;
const jobTick = async (): Promise<void> => {
  if (jobRunning) return;
  jobRunning = true;
  try {
    await runJobTick();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('worker', 'job tick 异常', { error: message });
  } finally {
    jobRunning = false;
  }
};

const recurringTick = (): void => {
  try {
    scheduleRecurringJobs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('worker', 'recurring schedule 异常', { error: message });
  }
};

const statsTick = (): void => {
  try {
    const stats = getJobStats();
    logger.info('worker', '作业队列状态', stats);
  } catch {
    // ignore
  }
};

const startLoop = (): void => {
  logger.info('worker', 'RPA Worker 启动', {
    rpaTaskIntervalMs: RPA_TASK_INTERVAL_MS,
    jobTickIntervalMs: JOB_TICK_INTERVAL_MS,
    recurringScheduleMs: RECURRING_SCHEDULE_INTERVAL_MS,
    supportedPlatforms: ['xiaohongshu', 'douyin', 'kuaishou'],
  });

  void rpaTaskTick();
  void jobTick();
  recurringTick();

  setInterval(() => void rpaTaskTick(), RPA_TASK_INTERVAL_MS);
  setInterval(() => void jobTick(), JOB_TICK_INTERVAL_MS);
  setInterval(recurringTick, RECURRING_SCHEDULE_INTERVAL_MS);
  setInterval(statsTick, STATS_INTERVAL_MS);
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info('worker', `收到信号 ${signal}，关闭浏览器实例后退出`);
  await closeAllContexts().catch(() => undefined);
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('worker', 'uncaughtException', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error('worker', 'unhandledRejection', { error: message });
});

startLoop();
