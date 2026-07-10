# Brain — lightweight persistent memory (V1, standalone)

> Standalone library extracted from the Freebuff V1 integration.
> Zero runtime dependencies (Node `fs` + `path` only). Bring your own host
> UI / CLI / chat framework — pass a tiny adapter (~10 lines, see
> [INTEGRATION.md](./INTEGRATION.md)) and `/brain`-style persistence works.

Markdown-based note system that lets humans and agents persist curated
knowledge across sessions, scoped to the user's project (in
`<cwd>/brain/<slug>.md`).

## Status

- **V1 (shipped)**: pure heuristics, no LLM. 68 unit tests, all green. Zero
  dependency on any host UI / CLI.
- **V2 (planned)**: LLM-assisted extraction at session end. Interface in
  place (`BrainAnalyzer`); default implementation left as `llmAnalyzerFuture`
  stub that throws — flip a constant to enable when ready.

## Philosophy

- **Markdown-first**: every note is a real `.md` file. Editable in any
  editor, greppable, diffable, committable.
- **Append-on-update**: Brain never overwrites content; it appends a
  timestamped section instead. Knowledge loss is structurally impossible.
- **No LLM in V1**: `heuristicAnalyzer` is pure TypeScript. Zero dollars per
  session, zero prompt drift, zero regression risk.
- **No auto-injection in V1**: notes are surface-on-demand. Call
  `runBrainCommand(..., 'read <slug>', ...)` to inject a note into the host
  UI's message stream; nothing pushes itself.

## Folder structure

```
brain-v1/
├── src/
│   ├── types.ts          # Public contracts (BrainNote, ProposedNote, BrainAnalyzer, duck-typed params)
│   ├── loader.ts         # Filesystem ops (listBrainNotes, readBrainNote, writeBrainNote, formatPreview, isValidSlug)
│   ├── analyzer.ts       # Strategy implementations (heuristicAnalyzer, llmAnalyzerFuture stub, defaultAnalyzer)
│   ├── index.ts          # runBrainCommand — single entry point bound to a slash command
│   └── __tests__/
│       ├── loader.test.ts     # 56 unit tests covering all loader edge cases
│       ├── analyzer.test.ts   # 8 unit tests covering slug derivation, heuristic behavior
│       └── index.test.ts      # 4 unit tests covering the dispatcher surface
├── README.md             # ← (this file)
├── INTEGRATION.md        # How to embed Brain in any host (Freebuff, generic CLI, test harness)
├── LICENSE               # Apache 2.0
├── NOTICE                # Upstream attribution
├── package.json
├── tsconfig.json
└── .gitignore
```

Total: **68 unit tests, all passing** under `bun test`.

## Installation

Requires [Bun](https://bun.sh) ≥ 1.3.0.

```bash
git clone <your-repo-url> brain-v1
cd brain-v1
bun install
```

## Run the tests

```bash
bun test
# Expected: 68 tests passed (4 dispatcher + 8 analyzer + 56 loader)
```

Type-check:

```bash
bun run typecheck
# Expected: 0 errors
```

Combined:

```bash
bun run check
```

## Public API (the surface you actually use)

```ts
import { runBrainCommand, isValidSlug } from 'brain-v1/src/index.ts'

await runBrainCommand(
  { setMessages: chatStore.setMessages }, // any function matching the signature
  '/brain save foo Note: ...',             // full slash input, after the leading '/brain'
  {
    cwd: process.cwd(),
    chatMessages: () => chatStore.getState().messages,
    getSystemMessage: (text) => ({ variant: 'ai', content: text, ... }),
  },
)
```

That's the entire API surface. The wrapper (slash-command registration,
input clearing, shell history) lives in your host code — see
[INTEGRATION.md](./INTEGRATION.md) for three concrete examples.

## Slash command — `/brain <sub>`

| Sub-command | Effect |
|---|---|
| `/brain help` (or `-h`, `--help`) | Show the help table inline. |
| `/brain list` (alias `ls`) | List notes in `brain/` as bullets: `slug — Summary: …`. |
| `/brain read <slug>` (alias `show <slug>`) | Inject `brain/<slug>.md` into the chat as a system message. |
| `/brain save <slug> <content>` (aliases `add`, `write` substitute for `save` only) | Direct write: create `brain/<slug>.md` or append a dated section. |
| `/brain save <slug>` | Heuristic: derive content from latest user+assistant messages for `<slug>`. |
| `/brain save` | Heuristic: derive slug + content from the last user message. |

`add` and `write` are aliases **only for the `save` keyword** (the dispatcher
reads the first token), not for the whole slash command. So
`/brain add foo Note` behaves identically to `/brain save foo Note`, but
`/brain add foo`-with-no-args falls through to the `save`-no-args heuristic
branch.

## Note file format

Each note lives at `<cwd>/brain/<slug>.md`. Constraints are enforced on
read/write.

### Slug rule

```
^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$
```

- Lowercase letters, digits, dashes.
- Must start AND end with an alphanumeric character.
- Examples accepted: `auth`, `database`, `payment-method-v2`, `db2`.
- Examples rejected: `-leading`, `trailing-`, `Has-Caps`, `has space`,
  `has.dot`.

### Required line: `Summary: ...`

The **first non-blank line** of every note MUST start with `Summary:`
followed by a single-line description (used by `/brain list` for the index
view). The description should fit on one line and give a grep-friendly
summary.

### Default body (created with `writeBrainNote` for new notes)

```
Summary: <first line of user content or "Note ajoutée manuellement">

# <Title-case slug, e.g. "Auth Method">

<user-provided content>
```

### Append-on-update (when the file already exists)

Brain reads the existing file, trims trailing whitespace, then appends:

```
## Mise à jour <ISO 8601 timestamp, e.g. "2025-07-10T15:42:13.456Z">

<new user-provided content>
```

Behavior: **the previous content is never overwritten or deleted**. Each
`/brain save` keeps the history of every prior note intact. This protects
against accidental knowledge loss but means you should periodically prune
stale dated sections if the file gets long.

## Integration

This library is **deliberately uncoupled** from any host UI/CLI. To make
`/brain...` work in your tool, you only need:
1. a function with the shape `(updater | array) => void` for `setMessages`
   (we use the updater form);
2. a getter for the current chat-history array;
3. a factory that returns a "system message" in your host's chat-message
   type.

That's it. See [INTEGRATION.md](./INTEGRATION.md) for three concrete
implementations: a Freebuff adapter, a generic Node-CLI adapter, and a
bun:test harness.

## Quick workflow (first-time use, ~60 seconds)

```
brain help                                    # learn the sub-commands
brain list                                    # confirm: "Aucun dossier brain/"
brain save auth "JWT rotation 24h"            # creates brain/auth.md
brain list                                    # → 1 note: "auth — Summary: JWT rotation 24h"
brain read auth                               # injects brain/auth.md into the chat
brain save auth "Plus de détails"             # appends "## Mise à jour <ISO>" section
cat brain/auth.md                             # verify the file on disk
```

(Replace `brain` with your host's slash-command keyword + alias.)

## Limitations V1 (assumed)

| Limitation | Mitigation |
|---|---|
| ASCII slugs only (`café`, `数据库` rejected) | ASCII enforced in V1; revisit if non-Latin teams need it |
| CRLF / BOM UTF-8 not normalized at write | Use LF in your editor; we don't transcode on write |
| No LLM auto-extraction: `/brain save <slug>` requires the user to write the content | V2 (`llmAnalyzerFuture`) will offer one-click LLM extraction at session end |
| No default session-close hook | V1 deliberately avoids hooking `process.on('exit')` or terminal-watchdog handlers. Integration guide in INTEGRATION.md wraps the dispatcher into the host's existing lifecycle hooks. |

## V2 roadmap (interface in place, default is the heuristic)

Switch the active strategy with one constant in `src/analyzer.ts`:

```ts
// V1 (default):
export const defaultAnalyzer: BrainAnalyzer = heuristicAnalyzer

// V2 (uncomment when ready, with your chosen heavy lifting impl):
// export const defaultAnalyzer: BrainAnalyzer = llmAnalyzerFuture  // throws today
```

The `BrainAnalyzer` interface accepts `AnalyzeArgs` = `{ recentUserMessages,
recentAssistantMessages, existingNotes, targetSlug? }` and returns
`Promise<ProposedNote | null>`. A V2 implementation will:

1. Format `AnalyzeArgs` into a structured prompt.
2. Call the LLM via your SDK of choice.
3. Parse + validate the structured output (`{slug, summary, content}`).
4. Hand the result back — `index.ts/commit()` will run the existing
   `writeBrainNote` (still idempotent, still with preview-before-write).

Until V2 lands, calling `llmAnalyzerFuture` throws
`Error: llmAnalyzerFuture: not yet implemented`. This is intentional — the
interface is bound so V2 can drop in by replacing one constant.

## License

Apache 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
