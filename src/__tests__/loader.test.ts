/**
 * Brain V1 — loader tests.
 *
 * Uses ephemeral temp dirs (mkdtempSync + rmSync). Each test starts from an
 * empty project so there is no cross-test contamination.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { beforeEach, afterEach, describe, expect, test } from 'bun:test'

import {
  extractSummary,
  formatPreview,
  hasBrainDir,
  isValidSlug,
  listBrainNotes,
  readBrainNote,
  writeBrainNote,
} from '../loader'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-loader-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('isValidSlug', () => {
  test.each([
    ['auth', true],
    ['db2', true],
    ['auth-method', true],
    ['multi-word-slug', true],
  ])('accepts %s', (input, expected) => {
    expect(isValidSlug(input)).toBe(expected)
  })

  test.each([
    ['', false],
    ['Auth', false],
    ['with space', false],
    ['../escape', false],
    ['with/slash', false],
    ['special!', false],
    ['-leading-dash', false],
    ['trailing-dash-', false],
  ])('rejects %s', (input, expected) => {
    expect(isValidSlug(input)).toBe(expected)
  })
})

describe('hasBrainDir', () => {
  test('false when absent', () => {
    expect(hasBrainDir(tmpDir)).toBe(false)
  })

  test('true when present', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    expect(hasBrainDir(tmpDir)).toBe(true)
  })
})

describe('extractSummary', () => {
  test('returns trimmed Summary line', () => {
    expect(
      extractSummary('Summary: Postgres primary DB.\n\n# Body'),
    ).toBe('Postgres primary DB.')
  })

  test('returns empty when no Summary line', () => {
    expect(extractSummary('# Body only\n')).toBe('')
  })

  test('handles Summary: with extra spaces', () => {
    expect(extractSummary('Summary:    spaced   \n')).toBe('spaced')
  })
})

describe('listBrainNotes', () => {
  test('empty array when brain/ absent', () => {
    expect(listBrainNotes(tmpDir)).toEqual([])
  })

  test('empty array when brain/ empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    expect(listBrainNotes(tmpDir)).toEqual([])
  })

  test('returns notes sorted alphabetically', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/zebra.md'),
      'Summary: Z notes.\n',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'brain/alpha.md'),
      'Summary: A notes.\n',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'brain/middle.md'),
      'Summary: M notes.\n',
    )

    const notes = listBrainNotes(tmpDir)
    expect(notes.map((n) => n.slug)).toEqual(['alpha', 'middle', 'zebra'])
    expect(notes[0]?.summary).toBe('A notes.')
  })

  test('marks notes without Summary line', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(path.join(tmpDir, 'brain/orphan.md'), '# No summary\n')
    const notes = listBrainNotes(tmpDir)
    expect(notes[0]?.summary).toBe('(pas de ligne Summary)')
  })

  test('ignores non-md files', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: Auth.\n',
    )
    fs.writeFileSync(path.join(tmpDir, 'brain/random.txt'), 'ignored')
    const notes = listBrainNotes(tmpDir)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.slug).toBe('auth')
  })

  test('ignores files whose stem is not a valid slug', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/Bad-Case.md'),
      'Summary: Bad.\n',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: Auth.\n',
    )
    const notes = listBrainNotes(tmpDir)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.slug).toBe('auth')
  })
})

describe('readBrainNote', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: JWT auth.\n\n## Detail\n\nBody content.',
    )
  })

  test('returns null for invalid slug', () => {
    expect(readBrainNote(tmpDir, '../foo')).toBeNull()
    expect(readBrainNote(tmpDir, 'Bad')).toBeNull()
  })

  test('returns null for missing file', () => {
    expect(readBrainNote(tmpDir, 'ghost')).toBeNull()
  })

  test('reads existing note with summary', () => {
    const n = readBrainNote(tmpDir, 'auth')
    expect(n).not.toBeNull()
    expect(n?.slug).toBe('auth')
    expect(n?.summary).toBe('JWT auth.')
    expect(n?.content).toContain('Body content.')
  })
})

describe('writeBrainNote', () => {
  test('creates new file with summary + body', () => {
    const result = writeBrainNote(tmpDir, {
      slug: 'auth',
      summary: 'JWT auth',
      content: '## Section\n\nDetail body.',
      isNew: true,
    })

    expect(result.status).toBe('created')
    expect(fs.existsSync(result.filePath)).toBe(true)
    const written = fs.readFileSync(result.filePath, 'utf8')
    expect(written).toContain('Summary: JWT auth')
    expect(written).toContain('## Section')
    expect(written).toContain('Detail body.')
  })

  test('appends dated section on update, preserves previous content', () => {
    fs.mkdirSync(path.join(tmpDir, 'brain'))
    fs.writeFileSync(
      path.join(tmpDir, 'brain/auth.md'),
      'Summary: JWT auth.\n\nInitial body here.',
    )

    const fixedDate = new Date('2025-07-09T12:00:00.000Z')
    const result = writeBrainNote(
      tmpDir,
      {
        slug: 'auth',
        summary: 'Refresh tokens added',
        content: 'New detail about rotation.',
        isNew: false,
      },
      { now: () => fixedDate },
    )

    expect(result.status).toBe('updated')
    const written = fs.readFileSync(result.filePath, 'utf8')
    expect(written).toContain('Summary: JWT auth.') // original
    expect(written).toContain('Initial body here.') // original
    expect(written).toContain('## Mise à jour 2025-07-09T12:00:00.000Z')
    expect(written).toContain('New detail about rotation.')
    expect(written.indexOf('Initial body here.')).toBeLessThan(
      written.indexOf('## Mise à jour'),
    )
  })

  test('throws on invalid slug', () => {
    expect(() =>
      writeBrainNote(tmpDir, {
        slug: '../escape',
        summary: 'x',
        content: 'y',
        isNew: true,
      }),
    ).toThrow(/Invalid slug/)
  })

  test('creates brain/ if it does not exist', () => {
    const result = writeBrainNote(tmpDir, {
      slug: 'first',
      summary: 'First note',
      content: '# Hello\n\nworld',
      isNew: true,
    })

    expect(result.status).toBe('created')
    expect(fs.existsSync(path.join(tmpDir, 'brain'))).toBe(true)
    expect(fs.existsSync(result.filePath)).toBe(true)
  })

  test('result.bytes reflects actual file size', () => {
    const result = writeBrainNote(tmpDir, {
      slug: 'tiny',
      summary: 's',
      content: 'c',
      isNew: true,
    })
    const onDisk = fs.statSync(result.filePath).size
    expect(result.bytes).toBe(onDisk)
  })
})

describe('formatPreview', () => {
  test('shows file path, summary, content for new files', () => {
    const result = {
      status: 'created' as const,
      filePath: '/x/brain/foo.md',
      bytes: 42,
    }
    const preview = formatPreview(result, {
      slug: 'foo',
      summary: 'Demo',
      content: '## Section\n\nbody',
      isNew: true,
    })
    expect(preview).toContain('Création de brain/foo.md')
    expect(preview).toContain('/x/brain/foo.md')
    expect(preview).toContain('Summary: Demo')
    expect(preview).toContain('## Section')
  })

  test('uses "Mise à jour" phrasing on updates', () => {
    const result = {
      status: 'updated' as const,
      filePath: '/x/brain/foo.md',
      bytes: 100,
    }
    const preview = formatPreview(result, {
      slug: 'foo',
      summary: 'Update',
      content: 'new',
      isNew: false,
    })
    expect(preview).toContain('Mise à jour de brain/foo.md')
    expect(preview).toContain('(append)')
  })
})
