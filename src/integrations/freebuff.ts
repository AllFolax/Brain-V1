/**
 * Brain V1 — Freebuff adapter.
 *
 * Binds the framework-agnostic `runBrainCommand` from brain-v1 core to
 * Freebuff's command-registry DSL. Produces a structurally-compatible
 * `FreebuffCommand` that the user appends to their `ALL_COMMANDS` array.
 *
 * Usage in a Freebuff clone (3 lines):
 *
 *   import { createFreebuffBrainCommand } from '@ruben/brain/freebuff'
 *
 *   const brainCommand = createFreebuffBrainCommand({
 *     cwd: getProjectRoot,                                // or () => getProjectRoot()
 *     chatMessages: () => useChatStore.getState().messages,
 *     getSystemMessage,                                   // already imported elsewhere
 *     clearInput,                                         // already defined elsewhere
 *   })
 *
 *   const ALL_COMMANDS = [
 *     // existing commands ...
 *     brainCommand,
 *   ]
 *
 * That's it. Restart Freebuff and `/brain` works.
 */

import { runBrainCommand, isValidSlug } from '../index'
import type {
  FreebuffCommand,
  FreebuffRouterParams,
  FreebuffChatMessage,
} from './freebuff.types'

// Re-export core utilities for ergonomics — Freebuff harnesses / unit tests
// sometimes want to pre-validate a slug before dispatching. We deliberately
// do NOT re-export every Brain type — those live behind `@ruben/brain/types`
// for users who want the full surface. Keeping the Freebuff subpath minimal
// reduces drift risk and clarifies the public boundary.
// Note: `FreebuffChatMessage` is referenced internally by `FreebuffBrainDeps`
// (to type `chatMessages`) but is intentionally NOT re-exported — it is an
// implementation detail; Freebuff users pass their own ChatMessage getter
// without needing to type it.
export { isValidSlug }
export type { FreebuffCommand, FreebuffRouterParams } from './freebuff.types'

/**
 * Runtime dependencies that Freebuff must inject. These are private to
 * Freebuff's runtime (Zustand stores, React refs, helpers) and cannot be
 * imported by brain-v1 — they are user-supplied at adapter construction.
 */
export interface FreebuffBrainDeps {
  /**
   * Working directory for the `brain/` folder on disk.
   * Can be a string (resolved eagerly) or a function (resolved lazily on
   * every invocation). The function form is recommended in cases where the
   * project root is a process-state singleton — it avoids evaluating it
   * at module-load time.
   */
  cwd: string | (() => string)

  /**
   * Live getter for the current chat history. Freebuff's Zustand store
   * already exposes one — pass `() => useChatStore.getState().messages`.
   * The returned array must be a mutable `Array<FreebuffChatMessage>`
   * (brain writes via an updater function and the new list is reassigned).
   */
  chatMessages: () => Array<FreebuffChatMessage>

  /**
   * Host factory that wraps a text into a system-message shape Freebuff
   * understands. Brain calls this to emit its responses (help text, list
   * output, save previews, errors).
   */
  getSystemMessage: (text: string) => { variant: string; content: string }

  /**
   * Freebuff's standard input-clear helper (`clearInput = (params) =>
   * params.setInputValue({...})`). Brain calls this AFTER each invocation
   * so the user sees the same input-reset UX as for any other slash
   * command.
   */
  clearInput: (params: FreebuffRouterParams) => void
}

/**
 * Build a Freebuff-shaped command ready to be appended to `ALL_COMMANDS`.
 *
 * Behaviour guarantees (verified by `__tests__/integrations/freebuff.test.ts`):
 * - Records `inputValue.trim()` to shell history via Freebuff's
 *   `saveToHistory` exactly once per invocation.
 * - Calls the injected `clearInput` helper exactly once per invocation,
 *   AFTER `runBrainCommand` resolves.
 * - Pushes system messages via the host's `setMessages` updater form.
 *   Brain never invokes `saveToHistory` or `setInputValue` directly —
 *   those are wrapped here as the adapter's contract.
 */
export function createFreebuffBrainCommand(
  deps: FreebuffBrainDeps,
): FreebuffCommand {
  return {
    name: 'brain',
    aliases: ['b'],
    acceptsArgs: true,
    handler: async (
      params: FreebuffRouterParams,
      args: string,
    ): Promise<void> => {
      // Lazy cwd: function form is resolved here, not at module load.
      const cwd =
        typeof deps.cwd === 'function' ? deps.cwd() : deps.cwd

      await runBrainCommand(
        // Cast through `unknown` is honest — Freebuff's `setMessages`
        // accepts both an array and an updater; brain always passes the
        // updater form with BrainChat messages, which is structurally
        // compatible at runtime even though TS doesn't see it.
        {
          setMessages: params.setMessages as unknown as Parameters<
            typeof runBrainCommand
          >[0]['setMessages'],
        },
        args,
        {
          cwd,
          chatMessages: deps.chatMessages,
          getSystemMessage: deps.getSystemMessage,
        },
      )

      // Wrapper-side contract: AFTER brain finishes, the input box resets
      // and the raw input lands in shell history — same UX as any /command.
      params.saveToHistory(params.inputValue.trim())
      deps.clearInput(params)
    },
  }
}
