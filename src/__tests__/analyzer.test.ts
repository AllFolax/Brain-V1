/**
 * Brain V1 — analyzer tests.
 *
 * Verifies the heuristic strategy in V1, and that the V2 stub throws when
 * invoked (preventing accidental reliance on unimplemented code).
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  defaultAnalyzer,
  deriveSlugFromMessage,
  heuristicAnalyzer,
  llmAnalyzerFuture,
} from '../analyzer'
import type { BrainNote } from '../types'

describe('deriveSlugFromMessage', () => {
  test('lowercases', () => {
    expect(deriveSlugFromMessage('AUTH uses JWT')).toBe('auth-uses-jwt')
  })

  test('removes punctuation, keeps dashes', () => {
    expect(deriveSlugFromMessage('Why use Postgres?!')).toBe('why-use-postgres')
  })

  test('caps at 8 words', () => {
    expect(
      deriveSlugFromMessage('one two three four five six seven eight nine'),
    ).toBe('one-two-three-four-five-six-seven-eight')
  })

  test('caps at 50 chars', () => {
    const long = 'verylongword '.repeat(20).trim()
    const slug = deriveSlugFromMessage(long)
    expect(slug.length).toBeLessThanOrEqual(50)
  })

  test('strips leading/trailing dashes', () => {
    expect(deriveSlugFromMessage('---foo---')).toBe('foo')
  })

  test('falls back to "note" on empty', () => {
    expect(deriveSlugFromMessage('!@#$%')).toBe('note')
    expect(deriveSlugFromMessage('')).toBe('note')
  })
})

describe('heuristicAnalyzer.propose', () => {
  beforeEach(() => {
    // Just for clarity; no shared state.
  })

  test('returns null when user messages are empty', async () => {
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: [],
      recentAssistantMessages: ['assistant did stuff'],
      existingNotes: [],
    })
    expect(result).toBeNull()
  })

  test('returns null when assistant messages are empty', async () => {
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: ['user wrote something meaningful'],
      recentAssistantMessages: [],
      existingNotes: [],
    })
    expect(result).toBeNull()
  })

  test('returns null when user message is too short', async () => {
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: ['hi'],
      recentAssistantMessages: ['long enough assistant message here'],
      existingNotes: [],
    })
    expect(result).toBeNull()
  })

  test('proposes a note when both sides have substance', async () => {
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: ['We are using PostgreSQL for the primary DB.'],
      recentAssistantMessages: [
        'I will set up the connection pooling and migrations.',
      ],
      existingNotes: [],
    })

    expect(result).not.toBeNull()
    expect(result?.isNew).toBe(true)
    expect(result?.summary).toContain('PostgreSQL')
    expect(result?.slug).toBe('we-are-using-postgresql-for-the-primary-db')
    expect(result?.content).toContain('## Intention utilisateur')
    expect(result?.content).toContain('## Résultat (assistant)')
  })

  test('respects targetSlug when provided', async () => {
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: ['Some longer user message here please.'],
      recentAssistantMessages: ['The assistant response is detailed.'],
      existingNotes: [],
      targetSlug: 'database',
    })

    expect(result?.slug).toBe('database')
  })

  test('truncates long summaries and assistant content', async () => {
    const longUser = 'x'.repeat(500)
    const longAssistant = 'y'.repeat(3000)
    const result = await heuristicAnalyzer.propose({
      recentUserMessages: [longUser],
      recentAssistantMessages: [longAssistant],
      existingNotes: [],
    })

    // Summary is cut at MAX_SUMMARY_CHARS with a French truncation marker.
    // The marker contributes a few chars; allow up to MAX + 20 of buffer.
    expect(result?.summary.length).toBeLessThanOrEqual(220)
    expect(result?.summary).toContain('tronqué')
    // Assistant content is also truncated and includes the marker
    expect(result?.content).toContain('tronqué')
  })
})

describe('heuristicAnalyzer.proposeUpdate', () => {
  test('returns proposal tagged isNew=false for existing note', async () => {
    const existing: BrainNote = {
      slug: 'database',
      filePath: '/x/brain/database.md',
      summary: 'PostgreSQL.',
      content: 'old body',
    }
    const result = await heuristicAnalyzer.proposeUpdate(
      {
        recentUserMessages: ['Switched from PostgreSQL to SQLite.'],
        recentAssistantMessages: ['Yes, migrations are now simpler.'],
        existingNotes: [{ slug: 'database', summary: 'PostgreSQL.' }],
      },
      existing,
    )
    expect(result?.slug).toBe('database')
    expect(result?.isNew).toBe(false)
  })
})

describe('llmAnalyzerFuture (V2 stub)', () => {
  test('propose throws "not yet implemented"', async () => {
    await expect(
      llmAnalyzerFuture.propose({
        recentUserMessages: ['a'],
        recentAssistantMessages: ['b'],
        existingNotes: [],
      }),
    ).rejects.toThrow(/not yet implemented/)
  })

  test('proposeUpdate throws "not yet implemented"', async () => {
    await expect(
      llmAnalyzerFuture.proposeUpdate(
        {
          recentUserMessages: ['a'],
          recentAssistantMessages: ['b'],
          existingNotes: [],
        },
        {
          slug: 'x',
          filePath: '/x.md',
          summary: 's',
          content: 'c',
        },
      ),
    ).rejects.toThrow(/not yet implemented/)
  })
})

describe('defaultAnalyzer', () => {
  test('returns a non-null proposal from a substantive session', async () => {
    // Replaces the previous identity assertion. V2 will swap the constant
    // without breaking this behavior check.
    const result = await defaultAnalyzer.propose({
      recentUserMessages: ['We are using PostgreSQL for the primary DB.'],
      recentAssistantMessages: ['Connection pool and migrations set up.'],
      existingNotes: [],
    })
    expect(result).not.toBeNull()
    expect(result?.summary).toContain('PostgreSQL')
  })
})
