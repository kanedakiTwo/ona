/**
 * PRO-173: the vitest config ignores only the «late console log while the
 * worker closes» teardown error, nothing else.
 */
import { describe, expect, it } from 'vitest'
import { isLateConsoleLogOnTeardown } from './vitestTeardown.js'

const err = (name: string, message: string) => Object.assign(new Error(message), { name })

describe('isLateConsoleLogOnTeardown', () => {
  it('matches the late onUserConsoleLog teardown error', () => {
    expect(isLateConsoleLogOnTeardown(err('EnvironmentTeardownError', '[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending'))).toBe(true)
  })
  it('does not match other teardown errors or real errors', () => {
    expect(isLateConsoleLogOnTeardown(err('EnvironmentTeardownError', '[vitest-worker]: Closing rpc while "fetch" was pending'))).toBe(false)
    expect(isLateConsoleLogOnTeardown(err('TypeError', 'Closing rpc while "onUserConsoleLog" was pending'))).toBe(false)
    expect(isLateConsoleLogOnTeardown(null)).toBe(false)
  })
})
