import { logger } from "./logger.js";

type StartupTask = {
  name: string;
  run: () => Promise<unknown> | unknown;
};

const deferredTasks: StartupTask[] = [];

/**
 * Import-time DDL is safe in production's dedicated runtime, but it competes
 * with the main migration chain on the development pooler. Register those
 * tasks here so development runs them serially after the critical chain.
 */
export function deferStartupTask(name: string, run: () => Promise<unknown> | unknown): void {
  if (process.env["APP_ENV"] === "development") {
    deferredTasks.push({ name, run });
    return;
  }

  Promise.resolve()
    .then(run)
    .catch((err) => logger.warn({ err, task: name }, "[startupTask] task failed (non-fatal)"));
}

export async function runDeferredStartupTasks(): Promise<void> {
  for (const task of deferredTasks.splice(0)) {
    try {
      await task.run();
      logger.info({ task: task.name }, "[startupTask] deferred task complete");
    } catch (err) {
      logger.warn({ err, task: task.name }, "[startupTask] deferred task failed (non-fatal)");
    }
  }
}