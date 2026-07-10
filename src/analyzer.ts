/**
 * Brain V1 — analyzer with V2-compatible interface.
 *
 * V1 ships a pure-heuristic implementation (no LLM call). V2 will plug a new
 * strategy behind the same `BrainAnalyzer` interface; the rest of the module
 * does not change.
 *
 * Heuristic Analyzer (V1):
 *   - Reads the most recent user / assistant message pair.
 *   - Derives a slug from the user message when no targetSlug is given.
 *   - Trims long assistant content.
 *   - Returns `null` when there is not enough signal.
 */

import type {
  AnalyzeArgs,
  BrainAnalyzer,
  BrainNote,
  ProposedNote,
} from './types'

const MAX_SUMMARY_CHARS = 200
const MAX_ASSISTANT_CHARS = 1500
const SLUG_MAX_LEN = 50
const SLUG_WORD_LIMIT = 8

/**
 * Derive a slug from a user message.
 * - Lowercase.
 * - Drop punctuation other than dashes.
 * - Take up to 8 words, then up to 50 characters.
 * - Trim leading/trailing dashes.
 * - Fallback to "note".
 */
export function deriveSlugFromMessage(msg: string): string {
  const cleaned = msg
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SLUG_WORD_LIMIT)
    .join('-')
  const trimmed = cleaned.slice(0, SLUG_MAX_LEN).replace(/^-+|-+$/g, '')
  return trimmed || 'note'
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '\n…(tronqué)'
}

function extractLastNonEmpty(list: string[]): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]
    if (v && v.trim().length > 0) return v
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Heuristic analyzer (V1)                                           */
/* ------------------------------------------------------------------ */

/**
 * Default V1 analyzer. Pure heuristic — no LLM call.
 */
export const heuristicAnalyzer: BrainAnalyzer = {
  async propose(args: AnalyzeArgs): Promise<ProposedNote | null> {
    const userLast = extractLastNonEmpty(args.recentUserMessages)
    const assistantLast = extractLastNonEmpty(args.recentAssistantMessages)

    if (!userLast || userLast.trim().length < 5) return null
    if (!assistantLast || assistantLast.trim().length < 5) return null

    const summary = truncate(userLast, MAX_SUMMARY_CHARS)
    const slugCandidate = args.targetSlug ?? deriveSlugFromMessage(userLast)

    const content = [
      `## Intention utilisateur`,
      '',
      userLast.trim(),
      '',
      `## Résultat (assistant)`,
      '',
      truncate(assistantLast, MAX_ASSISTANT_CHARS),
      '',
    ].join('\n')

    const slug = slugCandidate || 'note'

    return {
      slug,
      summary,
      content,
      isNew: true,
    }
  },

  async proposeUpdate(
    args: AnalyzeArgs,
    existing: BrainNote,
  ): Promise<ProposedNote | null> {
    const proposal = await this.propose({
      ...args,
      targetSlug: existing.slug,
    })
    if (!proposal) return null
    return { ...proposal, isNew: false }
  },
}

/* ------------------------------------------------------------------ */
/*  LLM analyzer (V2 stub — kept here so the interface is bound)      */
/* ------------------------------------------------------------------ */

/**
 * Stub for the future LLM analyzer. The shape matches `BrainAnalyzer` so
 * V2 can drop it in by importing this file and replacing `heuristicAnalyzer`
 * references. Until V2 lands, calling it throws — preventing accidental
 * reliance on an unimplemented strategy.
 */
export const llmAnalyzerFuture: BrainAnalyzer = {
  async propose(): Promise<ProposedNote | null> {
    throw new Error(
      'llmAnalyzerFuture: not yet implemented. Use heuristicAnalyzer in V1.',
    )
  },
  async proposeUpdate(): Promise<ProposedNote | null> {
    throw new Error(
      'llmAnalyzerFuture: not yet implemented. Use heuristicAnalyzer in V1.',
    )
  },
}

/**
 * Export the active analyzer so the rest of the module reads a single source
 * of truth. V2 will flip this from `heuristicAnalyzer` to an LLM-backed
 * implementation without any other change.
 */
export const defaultAnalyzer: BrainAnalyzer = heuristicAnalyzer
