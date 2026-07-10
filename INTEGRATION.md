# Integrating Brain V1 into your project

Brain V1 is a **library** — it does nothing on its own. To make `/brain...`
work in your CLI / TUI / chat UI / agent framework, you need a *host
adapter* that:

1. parses the user's `/brain ...` input,
2. calls `runBrainCommand(params, args, ctx)`,
3. feeds back into your UI's message stream.

This file shows you the exact adapter contract and three reference
implementations you can copy.

## The contract (duck-typed — you implement ~10 lines)

```ts
import {
  runBrainCommand,
  type BrainRouterParams,
  type BrainCommandContext,
} from '@ruben/brain'

// 1. Adapter that pushes a message into YOUR UI.
const adapter: BrainRouterParams = {
  setMessages: (updater) => {
    YOUR_UI.setMessages((prev) =>
      typeof updater === 'function' ? updater(prev) : updater,
    )
  },
}

// 2. Context — provide your own cwd + chat history getter + system message
// factory.
const ctx: BrainCommandContext = {
  cwd: process.cwd(),
  chatMessages: () => YOUR_CHAT_STORE.messages,
  getSystemMessage: (text) => ({
    id: nanoid(),
    variant: 'ai',
    content: text,
    role: 'system',
  }),
}

// 3. Drive it.
await runBrainCommand(adapter, '/brain save foo Note content', ctx)
```

That's the entire public surface. The `BrainRouterParams['setMessages']`
duck-typed signature accepts EITHER:
- a direct array (e.g. `setMessages([...prev, newMsg])`), OR
- an updater function (e.g. `setMessages(prev => [...prev, newMsg])`).

Brain always passes the updater form internally, so make sure your host
implementation handles that.

## What Brain will NOT do

By design (verified by typecheck plus a regression guard test):

- **It will NOT** call any `saveToHistory` / `clearInput` / equivalent. Those
  are the wrapper's responsibility. Calling them from brain would create
  duplicate shell-history entries.
- **It will NOT** throw. Every error path emits a friendly "system message"
  via `params.setMessages(...)` and returns.
- **It will NOT** couple to your host's `RouterParams` / `ChatMessage`
  structures. The duck-typed boundary insulates Brain from any specific host.

## Reference 1 — Freebuff / Codebuff fork (current production usage)

```ts
// In codebuff/cli/src/commands/command-registry.ts, end of ALL_COMMANDS:
import { runBrainCommand } from '../brain'
import { getProjectRoot } from '../project-files'
import { useChatStore } from '../state/chat-store'
import { getSystemMessage } from '../utils/message-history'

defineCommandWithArgs({
  name: 'brain',
  aliases: ['b'],
  handler: async (params, args) => {
    await runBrainCommand(
      {
        setMessages:
          params.setMessages as unknown as Parameters<
            typeof runBrainCommand
          >[0]['setMessages'],
      },
      args,
      {
        cwd: getProjectRoot(),
        chatMessages: () => useChatStore.getState().messages,
        getSystemMessage,
      },
    )
    params.saveToHistory(params.inputValue.trim())
    clearInput(params)
  },
})
```

Note the `as unknown as Parameters<typeof runBrainCommand>[0]['setMessages']`
cast: TypeScript can't structurally assign Freebuff's `setMessages`
(typed on `ChatMessage[]`) to Brain's `setMessages` (typed on the narrower
`BrainChatMessage[]`), but runtime is compatible because Brain only ever
calls the updater form with simple message shapes. The cast is honest and
documented.

## Reference 2 — Generic Node CLI (no React, no TUI)

```ts
// In your CLI's command dispatcher:
import { runBrainCommand } from '@ruben/brain'

type ChatMsg = { variant: 'user' | 'ai'; content: string }
const chatLog: ChatMsg[] = []

case '/brain': {
  const trimmed = rawInput.slice('/brain'.length).trim()
  await runBrainCommand(
    {
      setMessages: (updater) => {
        const next = typeof updater === 'function' ? updater(chatLog) : updater
        chatLog.length = 0
        chatLog.push(...next)
      },
    },
    trimmed,
    {
      cwd: process.cwd(),
      chatMessages: () => chatLog,
      getSystemMessage: (text) => ({ variant: 'ai', content: text }),
    },
  )
  // Optional: print the latest system message to stdout
  for (const m of chatLog) console.log(`[${m.variant}] ${m.content}`)
  break
}
```

## Reference 3 — Test harness (no UI at all)

```ts
// In a bun test:
import { runBrainCommand } from '@ruben/brain'
import * as path from 'path'
import * as fs from 'fs'

const messages: { variant: string; content?: string }[] = []
const params = {
  setMessages: (updater: any) => {
    const next = typeof updater === 'function' ? updater(messages) : updater
    messages.length = 0
    messages.push(...next)
  },
}
const ctx = {
  cwd: '/tmp/some-temp-dir',
  chatMessages: () => [] as { variant: string; content?: string }[],
  getSystemMessage: (text: string) => ({ variant: 'ai', content: text }),
}

await runBrainCommand(params, 'save foo my note', ctx)
// Assert on disk: fs.existsSync(path.join('/tmp/some-temp-dir', 'brain/foo.md'))
```

## Edge cases to handle at the wrapper level

| Edge case | Recommended handling |
|---|---|
| Empty input (`/brain` alone, no subcommand) | Brain routes to `replyHelp` automatically — no special handling needed. |
| Input trimming | Brain trims the args string internally (`args.trim()`). The wrapper should pass `args` as-is. |
| Input clear after `/brain...` | Wrapper responsibility. Brain will NOT call your `setInputValue`. |
| Shell history recording | Wrapper responsibility. Brain will NOT call your `saveToHistory`. |
| Unknown subcommand (`/brain foobar`) | Brain emits a "Sous-commande inconnue" system message automatically. |
| Invalid slug (`/brain save Bad-Case ...`) | Brain emits an explicit error message + don't suggest going manual. No file is written. |

## Minimum runtime contract

- Bun ≥ 1.3.0 (we use `<cwd>/brain/` via `fs`, and `bun:test` for the test suite).
- TypeScript 5.5+ (only for typecheck — runtime doesn't care).
- Node API: `fs`, `path` (both built-ins).
- No other runtime dependency.

## Why the duck-typed boundary?

`BrainRouterParams` is intentionally a **subset** of any typical host's full
`RouterParams`. By exposing only what Brain actually uses, we:

1. **Keep Brain free of host dependencies** — Brain never imports from
   Freebuff, Claude, ChatGPT, or anything else.
2. **Allow multiple adapters** — the same Brain module can be wired into
   Freebuff today and into a Claude-based chat tomorrow, with zero changes
   to Brain's source.
3. **Make tests trivial** — the test harness in `src/__tests__/index.test.ts`
   is just an object literal with a `setMessages` closure; no React, no
   Zustand, no nothing.

If you want to widen or narrow what Brain accepts, edit `src/types.ts`. The
interface is the API.
