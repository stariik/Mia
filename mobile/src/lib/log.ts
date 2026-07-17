/**
 * Dev-only diagnostic logger. Babel's transform-remove-console keeps
 * console.warn/error in release bundles, so chatty diagnostics must go
 * through this gate or they ship. Rule of thumb:
 *   dlog(...)        — traces, expected failures, anything per-turn.
 *   console.error()  — real, rare failures worth seeing in release
 *                      (Sentry picks these up once a DSN is set).
 */
export const dlog = (...args: unknown[]) => {
  if (__DEV__) console.warn(...args);
};
