/**
 * Freebuff type re-declarations for Brain V1 integration.
 *
 * Why this file exists
 * --------------------
 * `@codebuff/cli` is published with `"private": true` and is not on npm.
 * Brain V1 cannot import its types directly. Instead, we declare the minimal
 * subset of Freebuff's `CommandDefinition` and `RouterParams` that the `/brain`
 * adapter actually touches.
 *
 * The re-declarations match Freebuff's types *structurally* (TypeScript's
 * structural type system is shape-based, not nominal). If Freebuff changes
 * these interfaces, this file may need a one-line update, and the structural
 * compatibility test in `__tests__/integrations/freebuff.test.ts` will catch
 * regressions BEFORE any user's Freebuff build fails.
 *
 * Scope of re-declaration
 * -----------------------
 * Only 5 fields are duplicated. Everything else (`ChatMessage`, agent mode
 * types, React refs, etc.) is intentionally NOT touched — we only model the
 * surface that brain's wrapper handler actually invokes.
 */

export interface FreebuffCommand {
  /** Stable identifier. Freebuff matches the user input case-insensitively. */
  name: string
  /** Short aliases the user can type instead of `name`. */
  aliases: string[]
  /**
   * Whether the command accepts arguments. Set by Freebuff's
   * `defineCommandWithArgs` factory; true for brain because `args` carries
   * the sub-command + payload (e.g. "save auth Note content").
   */
  acceptsArgs: boolean
  /**
   * The async handler. Brain's shape: `(params, args) => Promise<void>`.
   * Side-effects on Freebuff state (shell history, input clear) happen
   * here OR in the brain wrapper above this handler — never inside the
   * brain core itself.
   */
  handler: (
    params: FreebuffRouterParams,
    args: string,
  ) => Promise<void> | void
}

/**
 * Subset of Freebuff's `RouterParams` that the brain adapter uses. Brain
 * does not touch the rest (logout, sendMessage, agentMode, etc.).
 */
export interface FreebuffRouterParams {
  /**
   * setMessages — used by brain to push system messages into Freebuff's
   * chat store. The signature accepts either a direct array OR an updater
   * function — brain always passes the updater form. We model both shapes
   * with `unknown` for the array branch (Freebuff may have additional
   * fields beyond what brain produces; this stays as the bottom type the
   * structural compat test relies on).
   */
  setMessages: (
    value:
      | unknown
      | ((
          prev: ReadonlyArray<FreebuffChatMessage>,
        ) => ReadonlyArray<FreebuffChatMessage>),
  ) => void

  /** saveToHistory — record the raw input into Freebuff's shell history. */
  saveToHistory: (message: string) => void

  /**
   * setInputValue — clear the input box. Brain never reads from this; it
   * writes only the empty-canvas shape, so we model a permissive enough
   * signature to be assignable from Freebuff's actual `(value | updater)`.
   */
  setInputValue: (value: unknown) => void

  /** inputValue — the raw user input string at the moment brain was invoked. */
  inputValue: string
}

/**
 * Minimum chat-message shape that brain needs. Brain's `BrainChatMessage`
 * is `{variant, content?}` — this mirrors it so brain-produced messages
 * are assignable to whatever Freebuff's real ChatMessage shape may be.
 */
export interface FreebuffChatMessage {
  variant: string
  content?: string
}
