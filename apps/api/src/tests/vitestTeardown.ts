/** PRO-173: the one vitest teardown error that is ignored (see vitest.config.ts). */
export function isLateConsoleLogOnTeardown(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  return e?.name === 'EnvironmentTeardownError' && /Closing rpc while "onUserConsoleLog" was pending/.test(e?.message ?? '')
}
