/**
 * Brain V1 — lightweight persistent memory.
 *
 * Philosophy:
 * - Markdown-based, no JSON index, no graph, no automatic extraction in V1.
 * - Human validation: brain/ is never written without a clear preview shown to
 *   the user first.
 * - Module-level isolation: nothing here imports from any host UI/CLI directly;
 *   the duck-typed `BrainRouterParams` / `BrainCommandContext` keep the
 *   module independent of any consumer (CLI, TUI, chat framework, or agent
 *   orchestration layer).
 */

export interface BrainNote {
  /** Lowercase + digits + dashes, e.g. "auth", "database". */
  slug: string
  /** First line "Summary: ..." content, trimmed. */
  summary: string
  /** Absolute path to `brain/<slug>.md` on disk. */
  filePath: string
  /** Full file content (utf-8). */
  content: string
}

export interface ProposedNote {
  slug: string
  summary: string
  content: string
  /**
   * Hint about whether the file is new at PROPOSAL time. The on-disk write
   * (`writeBrainNote`) recomputes the authoritative status and returns it
   * via `SaveResult`, which `commit()` uses for the user-facing message.
   * Kept for analyzer introspection and future use; not consumed in V1.
   */
  isNew: boolean
}

export type SaveStatus = 'created' | 'updated'

export interface SaveResult {
  status: SaveStatus
  filePath: string
  /** Bytes written. */
  bytes: number
}

/* ------------------------------------------------------------------ */
/*  Analyzer interface — V2 compatibility anchor                       */
/* ------------------------------------------------------------------ */

/**
 * Inputs available to any analyzer. The session messages here are filtered to
 * the last N interactions to keep prompts in V2 small. Existing notes are
 * provided so an LLM-based analyzer can decide to update vs. create.
 */
export interface AnalyzeArgs {
  recentUserMessages: string[]
  recentAssistantMessages: string[]
  /** Slugs + summaries of notes already on disk (for LLM dedup). */
  existingNotes: Array<Pick<BrainNote, 'slug' | 'summary'>>
  /**
   * Target slug when the user explicitly typed `/brain save <slug>`. When
   * `undefined`, the analyzer should derive a new one from the content.
   */
  targetSlug?: string
}

/**
 * Strategy interface. V1 ships `heuristicAnalyzer`. V2 will add
 * `llmAnalyzer`. The module exposes both, lets the integrator swap.
 */
export interface BrainAnalyzer {
  propose(args: AnalyzeArgs): Promise<ProposedNote | null>
  proposeUpdate(
    args: AnalyzeArgs,
    existing: BrainNote,
  ): Promise<ProposedNote | null>
}

/* ------------------------------------------------------------------ */
/*  Command integration contract (duck-typed to avoid coupling)        */
/* ------------------------------------------------------------------ */

/**
 * Minimal chat message shape that brain consumes. Avoids a hard dependency
 * on any host's specific ChatMessage type — just the variant discriminator
 * and an optional string content.
 */
export interface BrainChatMessage {
  variant: string
  content?: string
}

/**
 * Subset of host RouterParams actually used by brain.
 *
 * Notes:
 * - `saveToHistory` is intentionally NOT here. The host command wrapper
 *   saves the original input string itself. Brain MUST NOT save to history
 *   (would create duplicate shell-history entries).
 * - Input clearing is also the wrapper's responsibility.
 * - `setMessages` is widened to accept either a direct array OR an updater
 *   function so the integration snippet can pass the host's function through
 *   without type coercion. Brain itself only ever passes the updater form.
 */
export interface BrainRouterParams {
  setMessages: (
    value:
      | BrainChatMessage[]
      | ((prev: BrainChatMessage[]) => BrainChatMessage[]),
  ) => void
}

/**
 * Runtime context passed to the command handler at call-time.
 */
export interface BrainCommandContext {
  cwd: string
  /** Live getter for the current chat history. */
  chatMessages: () => BrainChatMessage[]
  /** Caller-provided factory matching the host's getSystemMessage. */
  getSystemMessage: (content: string) => BrainChatMessage
}
