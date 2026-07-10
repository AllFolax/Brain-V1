/**
 * Brain V1 — main entry point, framework-agnostic.
 *
 * Public API — the integration snippet uses ONLY this:
 *   runBrainCommand(params, args, ctx)
 *
 * Subcommands of `/brain` (or any host you bind the dispatcher to):
 *   list                                      — show all slugs + summaries
 *   read <slug>                               — inject full note into chat
 *   save <slug> <content>                     — direct write (with preview)
 *   save <slug>                               — analyze session, propose for slot
 *   save                                      — analyze session, propose slug+content
 *
 * Loader / analyzer primitives remain importable via their respective
 * module paths (`./loader`, `./analyzer`) — they are intentionally NOT
 * re-exported here so that the public surface stays minimal.
 *
 * The handler depends on a duck-typed `BrainRouterParams` and
 * `BrainCommandContext` to stay isolated from any host's internal types.
 */

import {
  hasBrainDir,
  isValidSlug,
  listBrainNotes,
  readBrainNote,
  formatPreview,
  writeBrainNote,
} from './loader'
import { defaultAnalyzer, deriveSlugFromMessage } from './analyzer'
import type {
  BrainCommandContext,
  BrainRouterParams,
  ProposedNote,
  SaveResult,
} from './types'

// Single public export. Internal helpers stay behind this surface.
export { isValidSlug }

/* ------------------------------------------------------------------ */
/*  Slash command dispatcher                                          */
/* ------------------------------------------------------------------ */

/**
 * The single command entry-point bound to a host's slash command. It
 * dispatches based on the first token of `args`.
 *
 * Never throws into the host — every error path emits a friendly system
 * message and returns.
 */
export async function runBrainCommand(
  params: BrainRouterParams,
  args: string,
  ctx: BrainCommandContext,
): Promise<void> {
  const trimmed = args.trim()
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/)

  if (tokens.length === 0) {
    return replyHelp(params, ctx)
  }

  const sub = tokens[0]!.toLowerCase()

  switch (sub) {
    case 'help':
    case '-h':
    case '--help':
      return replyHelp(params, ctx)

    case 'list':
    case 'ls':
      return doList(params, ctx)

    case 'read':
    case 'show':
      return doRead(params, tokens.slice(1).join(' '), ctx)

    case 'save':
    case 'add':
    case 'write':
      return doSave(params, trimmed.slice(sub.length).trim(), ctx)

    default:
      return reply(
        params,
        ctx,
        `Sous-commande inconnue : ${sub}\nTape \`/brain help\` pour la liste.`,
      )
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-commands                                                       */
/* ------------------------------------------------------------------ */

function doList(params: BrainRouterParams, ctx: BrainCommandContext): void {
  if (!hasBrainDir(ctx.cwd)) {
    return reply(
      params,
      ctx,
      'Aucun dossier `brain/` dans ce projet. Crée-le et tes notes seront détectées.',
    )
  }

  const notes = listBrainNotes(ctx.cwd)
  if (notes.length === 0) {
    return reply(
      params,
      ctx,
      'Le dossier `brain/` existe mais est vide. Utilise `/brain save <slug> <contenu>` pour créer ta première note.',
    )
  }

  const lines = notes.map(
    (n) => `  • **${n.slug}**  —  Summary: ${n.summary}`,
  )
  return reply(
    params,
    ctx,
    `🧠 Notes disponibles (${notes.length}) :\n\n${lines.join('\n')}`,
  )
}

function doRead(
  params: BrainRouterParams,
  slugArg: string,
  ctx: BrainCommandContext,
): void {
  const slug = slugArg.trim()
  if (slug.length === 0) {
    return reply(
      params,
      ctx,
      'Spécifie un slug. Exemple : `/brain read auth`',
    )
  }
  if (!isValidSlug(slug)) {
    return reply(
      params,
      ctx,
      `Slug invalide : ${JSON.stringify(slug)} (lettres minuscules, chiffres, tirets uniquement).`,
    )
  }
  const note = readBrainNote(ctx.cwd, slug)
  if (!note) {
    return reply(
      params,
      ctx,
      `Note introuvable : \`brain/${slug}.md\`. Utilise \`/brain list\` pour voir ce qui existe.`,
    )
  }
  return reply(
    params,
    ctx,
    `📄 **brain/${slug}.md** injectée dans le contexte :\n\n${note.content.trim()}`,
  )
}

async function doSave(
  params: BrainRouterParams,
  rest: string,
  ctx: BrainCommandContext,
): Promise<void> {
  // Four cases for the first token of `rest`:
  //   /brain save <slug> <content>      — direct manual write
  //   /brain save <slug>                — analyze session, propose for slot
  //   /brain save                       — analyze session + derive slug
  //   /brain save <bad-slug> ...        — explicit error
  const tokens = rest.length === 0 ? [] : rest.split(/\s+/)
  const firstToken = tokens[0]

  if (firstToken && !isValidSlug(firstToken)) {
    return reply(
      params,
      ctx,
      `Slug invalide : ${JSON.stringify(firstToken)}.\n` +
        'Les slugs n’acceptent que lettres minuscules, chiffres, et tirets ' +
        '(ex : `auth`, `database`, `payment-method`).\n' +
        'Formes supportées :\n' +
        '  /brain save <slug> <contenu>   — écriture directe\n' +
        '  /brain save <slug>              — analyse session pour ce slug\n' +
        '  /brain save                     — analyse session complète',
    )
  }

  if (firstToken && tokens.length > 1) {
    // Direct mode: slug + content provided
    const slug = firstToken
    const content = rest.slice(slug.length).trim()
    return doSaveDirect(params, slug, content, ctx)
  }

  if (firstToken && tokens.length === 1) {
    // Analyze mode: explicit slug, derive content from session
    return doSaveAnalyze(params, firstToken, ctx)
  }

  // Analyze mode: derive both slug and content from session
  return doSaveAnalyze(params, undefined, ctx)
}

function doSaveDirect(
  params: BrainRouterParams,
  slug: string,
  content: string,
  ctx: BrainCommandContext,
): void {
  if (content.length === 0) {
    return reply(
      params,
      ctx,
      'Aucun contenu fourni. Format : `/brain save <slug> <contenu>`',
    )
  }

  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const summary =
    firstLine.length === 0
      ? 'Note ajoutée manuellement'
      : firstLine.length > 200
        ? firstLine.slice(0, 200) + '…'
        : firstLine

  // `writeBrainNote` is the source of truth for create-vs-update status;
  // `commit()` derives the action label from its `SaveResult.status`.
  const proposal: ProposedNote = {
    slug,
    summary,
    content,
    isNew: true,
  }
  commit(params, ctx, proposal)
}

async function doSaveAnalyze(
  params: BrainRouterParams,
  targetSlug: string | undefined,
  ctx: BrainCommandContext,
): Promise<void> {
  const messages = ctx.chatMessages()
  const userMessages: string[] = []
  const assistantMessages: string[] = []

  for (const m of messages) {
    if (!m) continue
    if (m.variant === 'user' && typeof m.content === 'string') {
      userMessages.push(m.content)
    } else if (m.variant === 'ai' && typeof m.content === 'string') {
      assistantMessages.push(m.content)
    }
  }

  const notes = hasBrainDir(ctx.cwd)
    ? listBrainNotes(ctx.cwd).map((n) => ({ slug: n.slug, summary: n.summary }))
    : []

  const proposal = await defaultAnalyzer.propose({
    recentUserMessages: userMessages,
    recentAssistantMessages: assistantMessages,
    existingNotes: notes,
    targetSlug,
  })

  if (!proposal) {
    const fallback =
      'Pas assez de matière dans la session pour proposer une note.\n' +
      'Fais-le manuellement : `/brain save <slug> <contenu>`'
    return reply(params, ctx, fallback)
  }

  // Resolve final slug: targetSlug wins; otherwise proposal.slug,
  // otherwise a slug derived from the user message — defensive against
  // implementations returning empty strings.
  const userLast =
    userMessages.filter((m) => m.trim().length > 0).slice(-1)[0] ?? ''
  const finalSlug =
    targetSlug ?? proposal.slug ?? deriveSlugFromMessage(userLast) ?? 'note'

  commit(params, ctx, { ...proposal, slug: finalSlug })
}

/* ------------------------------------------------------------------ */
/*  Commit + chat reply                                                */
/* ------------------------------------------------------------------ */

function commit(
  params: BrainRouterParams,
  ctx: BrainCommandContext,
  proposal: ProposedNote,
): void {
  // Check for invalid slugs that may have slipped through.
  if (!isValidSlug(proposal.slug)) {
    return reply(
      params,
      ctx,
      `Slug invalide après analyse : ${JSON.stringify(proposal.slug)}. ` +
        'Refais un `/brain save <slug> <contenu>` manuel.',
    )
  }

  let result: SaveResult
  try {
    result = writeBrainNote(ctx.cwd, proposal)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return reply(params, ctx, `Écriture échouée : ${msg}`)
  }

  const action =
    result.status === 'created' ? '✅ Créé' : '✅ Mis à jour'
  const tail =
    result.status === 'created'
      ? ''
      : '\n\n(Une section datée a été ajoutée — le contenu précédent est préservé.)'
  const preview = formatPreview(result, proposal)
  return reply(params, ctx, `${action}\n\n${preview}${tail}`)
}

/* ------------------------------------------------------------------ */
/*  Output helpers                                                     */
/* ------------------------------------------------------------------ */

function replyHelp(params: BrainRouterParams, ctx: BrainCommandContext): void {
  return reply(
    params,
    ctx,
    [
      '🧠 **brain** — mémoire légère pour l\'IA.',
      '',
      'Sous-commandes :',
      '  /brain list                       — liste les notes (slug + Summary)',
      '  /brain read <slug>                — injecte `brain/<slug>.md` dans le chat',
      '  /brain save <slug> <contenu>      — écrit directement (avec aperçu)',
      '  /brain save <slug>                — analyse la session, propose pour ce slug',
      '  /brain save                       — analyse la session, propose slug + contenu',
      '',
      'Avant chaque écriture, un aperçu clair apparaît dans le chat.',
      'Tu peux supprimer manuellement le fichier si l\'aperçu ne te convient pas.',
    ].join('\n'),
  )
}

function reply(
  params: BrainRouterParams,
  ctx: BrainCommandContext,
  text: string,
): void {
  params.setMessages((prev) => [...prev, ctx.getSystemMessage(text)])
  // IMPORTANT: do NOT call saveToHistory here. The host command wrapper
  // saves the original input itself; saving again would create duplicate
  // shell-history entries on every /brain invocation. The wrapper also
  // handles input clearing.
}
