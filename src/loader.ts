/**
 * Brain V1 — filesystem loader.
 *
 * Pure (no I/O outside `fs`), no LLM, no host imports of any kind.
 * This module is the only place that touches the on-disk `brain/` directory;
 * every other module depends on it.
 *
 * Conventions:
 * - Slugs: lowercase letters, digits, dashes. Must start with a letter/digit.
 *   `^[a-z0-9][a-z0-9-]*$` (no path traversal, no special chars).
 * - File format: each note is `brain/<slug>.md`, first non-blank line is
 *   `Summary: <one sentence>`. The rest is free-form Markdown.
 * - Updates append a datestamped section rather than overwriting: protects
 *   against accidental knowledge loss.
 */

import * as fs from 'fs'
import * as path from 'path'

import type { BrainNote, ProposedNote, SaveResult } from './types'

/* ------------------------------------------------------------------ */
/*  Constants & validation                                             */
/* ------------------------------------------------------------------ */

/**
 * Slug rule: lowercase letters, digits, and dashes. Must start AND end with
 * an alphanumeric character. Single-character slugs are allowed (e.g. "a").
 * - REJECTS: leading dashes (-foo), trailing dashes (foo-), uppercase (Foo),
 *   spaces, slashes, dots, anything not in [a-z0-9-].
 * - ACCEPTS: "a", "auth", "db2", "auth-method", "payment-flow-v2".
 */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SUMMARY_LINE_REGEX = /^Summary:\s*(.+?)\s*$/m

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug)
}

/** Extract the first `Summary: ...` line, or empty string if missing. */
export function extractSummary(content: string): string {
  const m = content.match(SUMMARY_LINE_REGEX)
  return m && m[1] ? m[1].trim() : ''
}

/* ------------------------------------------------------------------ */
/*  Paths                                                             */
/* ------------------------------------------------------------------ */

export function getBrainDir(cwd: string): string {
  return path.join(cwd, 'brain')
}

export function hasBrainDir(cwd: string): boolean {
  return fs.existsSync(getBrainDir(cwd))
}

function noteFilePath(cwd: string, slug: string): string {
  return path.join(getBrainDir(cwd), `${slug}.md`)
}

/* ------------------------------------------------------------------ */
/*  List / read                                                       */
/* ------------------------------------------------------------------ */

export function listBrainNotes(cwd: string): BrainNote[] {
  const dir = getBrainDir(cwd)
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const notes: BrainNote[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.md')) continue
    const slug = entry.name.slice(0, -3) // strip ".md"
    if (!isValidSlug(slug)) continue // skip non-conforming files

    const filePath = path.join(dir, entry.name)
    const content = fs.readFileSync(filePath, 'utf8')
    notes.push({
      slug,
      filePath,
      content,
      summary: extractSummary(content) || '(pas de ligne Summary)',
    })
  }

  // Stable, alphabetical order. Predictable for tests and humans.
  notes.sort((a, b) => a.slug.localeCompare(b.slug))
  return notes
}

export function readBrainNote(cwd: string, slug: string): BrainNote | null {
  if (!isValidSlug(slug)) return null
  const filePath = noteFilePath(cwd, slug)
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')
  return {
    slug,
    filePath,
    content,
    summary: extractSummary(content) || '(pas de ligne Summary)',
  }
}

/* ------------------------------------------------------------------ */
/*  Write (with append-on-update to protect existing content)         */
/* ------------------------------------------------------------------ */

/**
 * Normalizes trailing whitespace and ensures a single trailing newline at EOF.
 */
function ensureTrailingNewline(s: string): string {
  return s.replace(/\s+$/, '') + '\n'
}

/**
 * Build the body of `brain/<slug>.md` for a CREATE operation.
 * Includes a `# Title` heading derived from the slug, unless the user's
 * content already starts with a markdown heading (`# X`, `## X`, ...).
 */
// Matches any of `#`, `##`, … `######` followed by whitespace, at line start.
const HEADING_AT_LINE_START = /^\s*#{1,6}\s/

function buildNewBody(note: ProposedNote): string {
  const summary = note.summary.trim() || 'Note ajoutée manuellement'
  const userProvidedOwnHeading =
    HEADING_AT_LINE_START.test(note.content.trimStart())
  const heading = userProvidedOwnHeading ? '' : `# ${slugToTitle(note.slug)}\n\n`
  return `Summary: ${summary}\n\n${heading}${ensureTrailingNewline(note.content)}`
}

/**
 * Slug → human-readable title. "auth-method" -> "Auth method".
 * Used only when the user did not start their content with `# `.
 */
function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/**
 * Build the appended section when updating an existing note. Appends a dated
 * section so old content is preserved. The clock is injectable via `opts.now`
 * to keep tests deterministic.
 */
function buildAppendSection(
  content: string,
  opts: WriteOptions = {},
): string {
  const nowIso = (opts.now?.() ?? new Date()).toISOString()
  return `## Mise à jour ${nowIso}\n\n${ensureTrailingNewline(content)}`
}

export interface WriteOptions {
  /** Injectable clock — used by tests for deterministic output. */
  now?: () => Date
}

/**
 * Write a note to `brain/<slug>.md`. If the file does not exist, creates it
 * fresh from `note.content`. If it exists, appends a dated section with
 * `note.content` — preserving previous knowledge.
 */
export function writeBrainNote(
  cwd: string,
  note: ProposedNote,
  opts: WriteOptions = {},
): SaveResult {
  if (!isValidSlug(note.slug)) {
    throw new Error(`Invalid slug: ${JSON.stringify(note.slug)}`)
  }

  const dir = getBrainDir(cwd)
  fs.mkdirSync(dir, { recursive: true })

  const filePath = noteFilePath(cwd, note.slug)
  const existed = fs.existsSync(filePath)

  let body: string
  if (existed) {
    const existing = fs.readFileSync(filePath, 'utf8')
    const existingTrimmed = existing.replace(/\s+$/, '')
    body = `${existingTrimmed}\n\n${buildAppendSection(note.content, opts)}`
  } else {
    body = buildNewBody(note)
  }

  fs.writeFileSync(filePath, body, 'utf8')
  const stat = fs.statSync(filePath)
  return {
    status: existed ? 'updated' : 'created',
    filePath,
    bytes: stat.size,
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Format a `SaveResult` and proposed note as a human-readable preview block,
 * suitable for echoing into the chat before/after the write.
 */
export function formatPreview(
  result: SaveResult,
  note: ProposedNote,
): string {
  const head = result.status === 'created'
    ? `Création de brain/${note.slug}.md`
    : `Mise à jour de brain/${note.slug}.md (append)`

  const file = `  → ${result.filePath} (${result.bytes} octets)`
  const summary = `  Summary: ${note.summary || '(vide)'}`
  const preview = `  ---aperçu---\n${indent(note.content, '  ')}\n  ---fin aperçu---`
  return `${head}\n${file}\n${summary}\n${preview}`
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => (l ? `${prefix}${l}` : l))
    .join('\n')
}
