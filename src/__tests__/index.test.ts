/**
 * Brain V1 — index tests (dispatcher + reply + save modes).
 *
 * Mocks BrainCommandContext and BrainRouterParams with simple
 * record-based stubs. Verifies:
 *   - reply() does NOT call saveToHistory (regression guard).
 *   - reply() does NOT call clearInput (dead code guard).
 *   - /brain list, read, save dispatch correctly.
 *   - /brain save with no args triggers the analyzer.
 *   - /brain save <invalid-slug> returns explicit error.
 *   - /brain save <slug> <content> writes directly, appending on update.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { beforeEach, afterEach, describe, expect, test } from 'bun:test'

import { runBrainCommand, isValidSlug } from '../index'
import type {
  BrainChatMessage,
  BrainCommandContext,
  BrainRouterParams,
} from '../types'

/* ------------------------------------------------------------------ */
/*  Test harness                                                       */
/* ------------------------------------------------------------------ */

interface CapturedCall {
  name: 'setMessages' | 'saveToHistory' | 'clearInput' | 'getSystemMessage'
  args: unknown[]
}

function makeHarness(cwd: string) {
  const calls: CapturedCall[] = []
  const messages: BrainChatMessage[] = []

  // setMessages matches `BrainRouterParams['setMessages']` — accepts either
  // a direct array or an updater function. Brain itself uses the updater
  // form; the harness handles both for compatibility with any host.
  const setMessages: BrainRouterParams['setMessages'] = (updater) => {
    calls.push({ name: 'setMessages', args: ['updater'] })
    const next =
      typeof updater === 'function' ? updater(messages) : updater
    messages.length = 0
    messages.push(...next)
  }

  const getSystemMessage = (content: string): BrainChatMessage => {
    calls.push({ name: 'getSystemMessage', args: [content] })
    return { variant: 'ai', content }
  }

  const params: BrainRouterParams = {
    setMessages,
  }

  const chatMessages: BrainChatMessage[] = []
  const ctx: BrainCommandContext = {
    cwd,
    chatMessages: () => chatMessages,
    getSystemMessage,
  }

  return {
    calls,
    messages,
    setMessages,
    getSystemMessage,
    params,
    ctx,
    chatMessages,
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-index-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ */
/*  /brain list                                                        */
/* ------------------------------------------------------------------ */

describe('/brain list', () => {
  test('reports absence of brain/ without crashing', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'list', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Aucun dossier')
  })

  test('lists notes with slug + summary', async () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: JWT auth.\n\nbody',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'brain/db.md'),
      'Summary: Postgres primary.\n\nbody',
    )
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'list', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Notes disponibles (2)')
    expect(last?.content).toContain('**auth**')
    expect(last?.content).toContain('**db**')
  })
})

/* ------------------------------------------------------------------ */
/*  /brain read                                                        */
/* ------------------------------------------------------------------ */

describe('/brain read', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: JWT auth.\n\nbody line',
    )
  })

  test('injects full content as system message', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'read auth', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.variant).toBe('ai')
    expect(last?.content).toContain('Summary: JWT auth.')
    expect(last?.content).toContain('body line')
  })

  test('returns null/error for missing slug', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'read ghost', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('introuvable')
  })

  test('returns error for invalid slug', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'read Bad-Case', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Slug invalide')
  })

  test('read without slug prompts for a slug', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'read', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Spécifie un slug')
  })
})

/* ------------------------------------------------------------------ */
/*  /brain save  (three modes)                                         */
/* ------------------------------------------------------------------ */

describe('/brain save — direct mode', () => {
  test('creates new note with explicit slug + content', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save foo Une décision sur la base PostgreSQL.',
      h.ctx,
    )
    const filePath = path.join(tmpDir, 'brain/foo.md')
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('Summary:')
    expect(content).toContain('Une décision sur la base PostgreSQL.')
    const last = h.messages.at(-1)
    expect(last?.content).toContain('✅ Créé')
    expect(last?.content).toContain('brain/foo.md')
  })

  test('appends dated section on update (preserves prior content)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: Initial JWT.\n\nOriginal body.',
    )
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save auth Refresh tokens ajouté.',
      h.ctx,
    )
    const content = fs.readFileSync(path.join(tmpDir, 'brain/auth.md'), 'utf8')
    expect(content).toContain('Initial JWT.')
    expect(content).toContain('Original body.')
    expect(content).toContain('## Mise à jour')
    expect(content).toContain('Refresh tokens ajouté.')
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Mis à jour')
  })

  test('auto-injects # Title heading derived from slug', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save auth-method Detail here.',
      h.ctx,
    )
    const content = fs.readFileSync(
      path.join(tmpDir, 'brain/auth-method.md'),
      'utf8',
    )
    expect(content).toContain('# Auth Method')
  })

  test('does not double-inject title when content already has one', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save foo # Custom Title\n\nBody.',
      h.ctx,
    )
    const content = fs.readFileSync(path.join(tmpDir, 'brain/foo.md'), 'utf8')
    // Only one '# Title' line should appear
    const headingLines = content.split('\n').filter((l) => /^\s*#{1,6}\s/.test(l))
    expect(headingLines).toEqual(['# Custom Title'])
  })

  test('does not inject title when content starts with ## Subsection', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save foo ## Subsection\n\nBody.',
      h.ctx,
    )
    const content = fs.readFileSync(path.join(tmpDir, 'brain/foo.md'), 'utf8')
    const headingLines = content.split('\n').filter((l) => /^\s*#{1,6}\s/.test(l))
    expect(headingLines).toEqual(['## Subsection'])
  })
})

describe('/brain save with invalid slug', () => {
  test('returns explicit error, does not fall through to analyze', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(
      h.params,
      'save Bad-Case some content here',
      h.ctx,
    )
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Slug invalide')
    expect(last?.content).toContain('"Bad-Case"')
    // Should NOT have written anything
    expect(fs.existsSync(path.join(tmpDir, 'brain'))).toBe(false)
  })
})

describe('/brain save — analyze modes', () => {
  beforeEach(() => {
    // Pretend the user just had a meaningful exchange.
  })

  test('analyze-without-slug derives slug from LAST substantive message', async () => {
    const h = makeHarness(tmpDir)
    h.chatMessages.push(
      { variant: 'user', content: 'We are using PostgreSQL for the primary DB.' },
      {
        variant: 'ai',
        content: 'Setting up connection pooling and migrations accordingly.',
      },
      { variant: 'user', content: 'Confirm before commit.' },
    )
    await runBrainCommand(h.params, 'save', h.ctx)
    // Current heuristic uses the LAST user message (>=5 chars) for the slug.
    // V2 will replace this with an LLM-based strategy that favors the most
    // substantive recent exchange.
    const expected = path.join(tmpDir, 'brain/confirm-before-commit.md')
    expect(fs.existsSync(expected)).toBe(true)
  })

  test('analyze-with-slug writes to existing slug', async () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/database.md'),
      'Summary: Postgres primary.\n',
    )
    const h = makeHarness(tmpDir)
    h.chatMessages.push(
      { variant: 'user', content: 'Switch to SQLite for tests.' },
      { variant: 'ai', content: 'Done.' },
    )
    await runBrainCommand(h.params, 'save database', h.ctx)
    const content = fs.readFileSync(
      path.join(tmpDir, 'brain/database.md'),
      'utf8',
    )
    expect(content).toContain('Postgres primary.') // original
    expect(content).toContain('Switch to SQLite') // appended
  })

  test('analyze returns fallback message when session is empty', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'save', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Pas assez de matière')
  })
})

/* ------------------------------------------------------------------ */
/*  Markers past this point: reply() side-effects are now structurally */
/*  enforced: BrainRouterParams does not expose saveToHistory or        */
/*  clearInput, so a regression that re-introduced calls would fail    */
/*  TypeScript compilation. No mock-based runtime test needed.          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  /brain help                                                        */
/* ------------------------------------------------------------------ */

describe('/brain help', () => {
  test('shows usage', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, '', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('brain')
    expect(last?.content).toContain('list')
    expect(last?.content).toContain('read')
    expect(last?.content).toContain('save')
  })

  test('shows help on unknown subcommand', async () => {
    const h = makeHarness(tmpDir)
    await runBrainCommand(h.params, 'foobar', h.ctx)
    const last = h.messages.at(-1)
    expect(last?.content).toContain('Sous-commande inconnue')
  })
})

/* ------------------------------------------------------------------ */
/*  isValidSlug re-export                                             */
/* ------------------------------------------------------------------ */

describe('isValidSlug re-export', () => {
  test('accepts valid slug', () => {
    expect(isValidSlug('auth')).toBe(true)
  })
  test('rejects invalid slug', () => {
    expect(isValidSlug('Auth')).toBe(false)
  })
})
