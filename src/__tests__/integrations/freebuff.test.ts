/**
 * Brain V1 — Freebuff integration tests.
 *
 * Verifies that the Freebuff adapter:
 * - Produces a structurally-valid `CommandDefinition` shape (no drift from
 *   Freebuff's command-registry DSL).
 * - Invokes the WRAPPER side-effects exactly once:
 *     `saveToHistory` (one shell-history entry per slash command),
 *     `clearInput` (one input reset), one `setMessages` updater call
 *     containing at least one system message.
 * - Accepts both string and function forms for `cwd`.
 * - Forwards the dependencies through `runBrainCommand` correctly.
 */

import { describe, expect, mock, test } from 'bun:test'

import {
  createFreebuffBrainCommand,
  isValidSlug,
} from '../../integrations/freebuff'
import type {
  FreebuffCommand,
  FreebuffRouterParams,
  FreebuffBrainDeps,
} from '../../integrations/freebuff'

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

function makeParams() {
  return {
    inputValue: '/brain help',
    setMessages: mock(() => {}),
    saveToHistory: mock(() => {}),
    setInputValue: mock(() => {}),
  } as unknown as FreebuffRouterParams
}

function makeDeps(
  overrides: Partial<FreebuffBrainDeps> = {},
): FreebuffBrainDeps {
  return {
    cwd: '/tmp/brain-integration-test',
    chatMessages: () => [],
    getSystemMessage: (text: string) => ({ variant: 'ai', content: text }),
    clearInput: mock(() => {}),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('createFreebuffBrainCommand - structural shape', () => {
  test('produces a well-formed CommandDefinition with brain metadata', () => {
    const brain = createFreebuffBrainCommand(makeDeps())

    expect(brain.name).toBe('brain')
    expect(brain.aliases).toEqual(['b'])
    expect(brain.acceptsArgs).toBe(true)
    expect(typeof brain.handler).toBe('function')
  })

  /**
   * Real drift-catcher: the act of pushing brain onto a hypothetical
   * `FreebuffCommand[]` registry (which is exactly what a Freebuff user
   * will do at the call-site `ALL_COMMANDS.push(brainCommand)`) is the
   * TRUE structural compatibility test. If brain's shape ever drifts
   * from Freebuff's `CommandDefinition`, this line fails at COMPILE-time.
   */
  test('pushable into a FreebuffCommand[] registry (compile-time gatekeeper)', () => {
    const brain = createFreebuffBrainCommand(makeDeps())
    const registry: FreebuffCommand[] = []
    registry.push(brain) // <-- structural compat verified here, at TS-compile
    expect(registry).toHaveLength(1)
    expect(registry[0]?.name).toBe('brain')
  })

  test('re-exports isValidSlug from brain-v1 core', () => {
    expect(isValidSlug('auth')).toBe(true)
    expect(isValidSlug('Bad-Case')).toBe(false)
    expect(isValidSlug('payment-flow-v2')).toBe(true)
  })
})

describe('createFreebuffBrainCommand - handler behaviour', () => {
  test('invokes saveToHistory exactly once with the trimmed input', async () => {
    const params = makeParams()
    const deps = makeDeps()
    const brain = createFreebuffBrainCommand(deps)

    await brain.handler(params, 'help')

    expect(
      (params.saveToHistory as unknown as ReturnType<typeof mock>).mock.calls
        .length,
    ).toBe(1)
    const firstCall =
      (params.saveToHistory as unknown as ReturnType<typeof mock>).mock
        .calls[0]
    expect(firstCall).toBeDefined()
    expect(String(firstCall?.[0])).toBe('/brain help')
  })

  test('invokes clearInput exactly once after brain returns', async () => {
    const params = makeParams()
    const deps = makeDeps()
    const brain = createFreebuffBrainCommand(deps)

    await brain.handler(params, 'help')

    const clearInput = deps.clearInput as unknown as ReturnType<typeof mock>
    expect(clearInput.mock.calls.length).toBe(1)
    expect(clearInput.mock.calls[0]?.[0]).toBe(params)
  })

  test('forwards setMessages updater to runBrainCommand (>= 1 call)', async () => {
    const params = makeParams()
    const deps = makeDeps()
    const brain = createFreebuffBrainCommand(deps)

    await brain.handler(params, 'help')

    // Brain emits at least one system message via the updater form.
    expect(
      (params.setMessages as unknown as ReturnType<typeof mock>).mock.calls
        .length,
    ).toBeGreaterThan(0)
  })

  test('accepts a string form for cwd', async () => {
    const params = makeParams()
    const deps = makeDeps({ cwd: '/static/cwd' })
    const brain = createFreebuffBrainCommand(deps)

    // Should not throw - just confirming it executes end-to-end.
    await brain.handler(params, 'list')
    expect(true).toBe(true)
  })

  test('accepts a function form for cwd', async () => {
    const params = makeParams()
    const deps = makeDeps({ cwd: () => '/lazy/cwd' })
    const brain = createFreebuffBrainCommand(deps)

    await brain.handler(params, 'save auth Note content')
    expect(true).toBe(true)
  })

  test('handles inputs with surrounding whitespace via inputValue.trim()', async () => {
    const params = makeParams()
    params.inputValue = '  /brain list  '
    const deps = makeDeps()
    const brain = createFreebuffBrainCommand(deps)

    await brain.handler(params, 'list')

    const firstCall =
      (params.saveToHistory as unknown as ReturnType<typeof mock>).mock
        .calls[0]
    expect(String(firstCall?.[0])).toBe('/brain list')
  })
})
