// Entry point GitHub runs (bundled to dist/index.mjs).
import { log } from './inputs.js';
import { runAction } from './run.js';

runAction()
  .then((result) => {
    if (result.failure) {
      log.error(result.failure);
      process.exitCode = 1;
    }
  })
  .catch((e: unknown) => {
    log.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
