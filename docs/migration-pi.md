# Migration: Opencode → Pi

**Project:** Botan-ebi — Discord bot powered by an AI agent harness
**Status:** Complete (Phase 1)

---

## Table of Contents

1. [Why Migrate](#1-why-migrate)
2. [Previous Architecture](#2-previous-architecture)
3. [Current Architecture](#3-current-architecture)
4. [Migration Steps Completed](#4-migration-steps-completed)
5. [File Changes Summary](#5-file-changes-summary)
6. [Next Phase: Jarvis-like Assistant](#6-next-phase-jarvis-like-assistant)

---

## 1. Why Migrate

- **Replace two processes** (opencode server + bot) with **one** (bot spawns pi as subprocess)
- **Eliminate `opencode-assistant/` bundle** — no more opencode config, MCP server config, prompts in the project
- **Pi has richer event streaming** — message deltas, thinking output, tool execution events out of the box
- **Pi manages sessions** — no manual session create/delete/persist cycle
- **Pi handles auth** — API keys via `auth.json` or env vars, no per-provider config needed in the project

---

## 2. Previous Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      bootstrap.sh                       │
│  (manages opencode serve + bot as separate processes)   │
└────┬────────────────────┬───────────────────────────────┘
     │                    │
     ▼                    ▼
┌──────────┐      ┌──────────────┐
│ opencode │      │  botan-ebi   │
│  serve   │      │  (bun)       │
│ :4096    │◄────►│              │
│ HTTP     │      │  Kernel      │
│ REST API │      │  ├─ DiscordIn│
└──────────┘      │  ├─ DiscordOut│
                  │  ├─ OpencodeAg│
                  │  ├─ QueueMgr  │
                  │  ├─ SessionMg │
                  │  └─ HeartbeatM│
                  └──────────────┘
```

### Message flow

```
Discord DM
  → DiscordInputAdapter (rate-limited)
  → QueueManager.enqueue("incoming", packet)
  → Kernel.startIncomingLoop()
    → OpencodeAgent.process(message)
      → SessionManager.getOrCreateSession()
        → client.session.create() [if new]
        → client.session.prompt() [HTTP POST]
      → parse response parts
  → QueueManager.enqueue("outgoing", response)
  → Kernel.startOutgoingLoop()
    → DiscordOutputAdapter.send(response)
```

### Key dependency: `@opencode-ai/sdk`

| SDK call | Purpose |
|----------|---------|
| `client.session.create()` | Create session per Discord channel |
| `client.session.prompt()` | Send message, get response |
| `client.session.delete()` | Reset session on `/reset` command |

---

## 3. Current Architecture

```
┌──────────────────────────────────────────────────┐
│                botan-ebi (bun)                    │
│                                                   │
│  Kernel                                           │
│  ├─ DiscordInputAdapter (rate-limited, validated) │
│  ├─ DiscordOutputAdapter (message splitter)       │
│  ├─ PiRpcAgent ◄── stdin/stdout ──► pi --mode rpc│
│  │   └─ manages channel→session map in-memory     │
│  ├─ QueueManager (file-based persistent queues)   │
│  ├─ HeartbeatMonitor (.botan-ebi/heartbeat/)      │
│  └─ ChannelContext (last-channel tracking)        │
└──────────────────────────────────────────────────┘
```

### Message flow (current)

```
Discord DM
  → DiscordInputAdapter (rate-limited, validated)
  → QueueManager.enqueue("incoming", packet)
  → Kernel.startIncomingLoop()
    → PiRpcAgent.process(message)
      → [if known session] switch_session → prompt
      → [if new channel] prompt → get_state → store session path
      → collect text_delta events until agent_end
  → QueueManager.enqueue("outgoing", response)
  → Kernel.startOutgoingLoop()
    → DiscordOutputAdapter.send(response)
```

### Current state details

| Component | What it does |
|-----------|-------------|
| `PiRpcAgent` | Spawns `pi --mode rpc` as subprocess, JSONL protocol, auto-restart on crash |
| `channelSessions` | In-memory `Map<channelId, sessionFile>` — no disk persistence |
| `SessionManager` | **Deleted** — absorbed into PiRpcAgent |
| `QueueManager` | File-based queues (unchanged) |
| `HeartbeatMonitor` | Moved from `opencode-assistant/heartbeat/` to `.botan-ebi/heartbeat/` |

---

## 4. Migration Steps Completed

### Step 1: Create `PiRpcAgent` adapter
**`src/adapters/agents/pi/rpc-agent.ts`** — New file.

Spawns `pi --mode rpc` as a child process:
- JSONL framing with custom line reader (split on `\n`, strip `\r`)
- Maps Discord channel → Pi session file path in-memory
- `/reset` → sends `new_session` command
- Normal messages → `switch_session` (if known) → `prompt` → collect text_delta events until `agent_end`
- Auto-restart on subprocess exit/crash
- Error fallback: returns friendly error messages to Discord

### Step 2: Delete `SessionManager`
**`src/adapters/agents/opencode/session-manager.ts`** — Deleted.

Channel→session mapping is managed inside `PiRpcAgent` as a simple `Map<channelId, sessionFile>`. Pi handles session persistence on disk automatically.

### Step 3: Delete `OpencodeAgent`
**`src/adapters/agents/opencode/opencode.ts`** — Deleted.

Replaced entirely by `PiRpcAgent`.

### Step 4: Update environment config
**`src/config/env.ts`** and **`.env.example`** — Edited.

- Removed `OPENCODE_BASE_URL`, `OPENCODE_PROVIDER_ID`, `OPENCODE_MODEL_ID`
- Added `PI_PROVIDER`, `PI_MODEL`, `PI_SESSION_DIR` (all optional)
- Only `DISCORD_TOKEN` is now required

### Step 5: Update `bootstrap.sh`
**`bootstrap.sh`** — Rewritten.

- Removed all opencode server management (`start_opencode`, `stop_opencode`)
- Bot is now the only managed process
- Pi subprocess lifecycle managed by the bot itself

### Step 6: Update `Kernel`
**`src/kernel/kernel.ts`** — Edited.

- Changed heartbeat directory from `opencode-assistant/heartbeat` to `.botan-ebi/heartbeat`

### Step 7: Update entry point
**`src/index.ts`** — Edited.

```typescript
// Before:
import OpencodeAgent from "+adapters/agents/opencode/opencode.js";
const opencodeAgent = new OpencodeAgent();

// After:
import PiRpcAgent from "+adapters/agents/pi/rpc-agent.js";
const piAgent = new PiRpcAgent({
  provider: env.PI_PROVIDER,
  model: env.PI_MODEL,
  sessionDir: env.PI_SESSION_DIR,
});
```

### Step 8: Update `.gitignore` and clean up
- Removed opencode entries (opencode-assistant/, .opencode.log, .opencode.pid)
- Added `.pi/sessions/*` for pi session storage
- `.botan-ebi/heartbeat/*` for migrated heartbeat files
- Deleted `opencode-assistant/` directory

### Step 9: Update tests
- `tests/opencode.test.ts` → **Deleted**, replaced by `tests/pi-agent.test.ts`
- `tests/session-manager.test.ts` → **Deleted** (no longer applicable)
- `tests/pi-agent.test.ts` → 6 tests covering initialization, reset commands, error handling

---

## 5. File Changes Summary

| File | Action |
|------|--------|
| `src/adapters/agents/pi/rpc-agent.ts` | **Create** |
| `src/adapters/agents/opencode/opencode.ts` | **Delete** |
| `src/adapters/agents/opencode/session-manager.ts` | **Delete** |
| `src/config/env.ts` | **Edit** |
| `src/index.ts` | **Edit** |
| `package.json` | **Edit** (remove @opencode-ai/sdk) |
| `bootstrap.sh` | **Rewrite** |
| `.env.example` | **Edit** |
| `src/kernel/kernel.ts` | **Edit** (heartbeat path) |
| `.gitignore` | **Edit** |
| `README.md` | **Edit** |
| `tests/pi-agent.test.ts` | **Create** |
| `tests/opencode.test.ts` | **Delete** |
| `tests/session-manager.test.ts` | **Delete** |
| `opencode-assistant/` | **Delete** |

---

## 6. Next Phase: Jarvis-like Assistant

The bot currently runs pi as-is — a coding agent with full `read`/`bash`/`edit`/`write` tools and a coding-focused system prompt. To turn it into a general-purpose assistant, we customize pi, not replace it. Pi is the engine that gives us tool execution, session management, retry logic, model switching, and auth handling for free.

### Plan: Customize Pi (the right approach)

**Goal:** A conversational Jarvis-like assistant that can optionally use tools (web search, weather, reminders, home automation) — all routed through pi's agentic engine.

**Architecture stays:**
```
┌──────────────────────────────────────────────────┐
│                botan-ebi (bun)                    │
│                                                   │
│  Kernel                                           │
│  ├─ DiscordInputAdapter                           │
│  ├─ DiscordOutputAdapter                          │
│  ├─ PiRpcAgent ◄── stdin/stdout ──► pi --mode rpc│
│  │   (now with custom system prompt + tool filter)│
│  ├─ QueueManager (keep for crash resilience)      │
│  ├─ HeartbeatMonitor                              │
│  └─ ChannelContext                                 │
└──────────────────────────────────────────────────┘
```

### Step 1: Custom system prompt

**File:** `assistant-prompt.md` (project root)

Write a Jarvis-like system prompt that replaces pi's default coding prompt. Define the assistant's personality, tone, and capabilities. Examples:
- Formal but warm (addresses user as "Sir", dry wit)
- Proactive and solution-oriented
- Privacy-conscious
- No coding bias unless explicitly asked

**Changes to `PiRpcAgent`:**
- Pass `--system-prompt "$(cat assistant-prompt.md)"` to the pi subprocess
- Or: pass `--append-system-prompt "Your core personality rules:" + file` to keep pi's capabilities but override behavior

### Step 2: Control tool access

Pi's built-in tools (`read`, `bash`, `edit`, `write`) are coding-focused. For a general assistant we likely want:
- **`read`** — Useful for reading files, configs, etc.
- **`bash`** — Powerful, enables shell commands, scripting, web requests via curl
- **No `edit`/`write`** — File editing is a coding task, not needed for a conversational assistant
- **No `ask_advisor`** — That's a coding-specific meta-tool

**Changes to `PiRpcAgent`:**
- Pass `--tools read,bash` to limit pi to only these tools
- Future: add custom tools (web search, weather, home automation) via pi extensions

### Step 3: Add custom tools as pi extensions

Pi supports extensions (`.pi/extensions/`) that register custom tools. These are TypeScript files that hook into pi's tool system. For a Jarvis assistant, useful tools:

| Tool | What it does | How |
|------|-------------|-----|
| **Web search** | Search the web via Brave API | Pi extension: `registerTool('web_search', ...)` |
| **Weather** | Get weather for a location | Pi extension or simple bash + `curl wttr.in` |
| **Reminders** | Set timed reminders | Uses existing HeartbeatMonitor + custom tool |
| **Home control** | Smart home automation | Pi extension calling Home Assistant / MQTT |

**How to add:**
1. Create extension file in `.pi/extensions/jarvis-tools.ts`
2. Register tools using `pi.registerTool()`
3. The extension is loaded automatically by pi when present

### Step 4: Implement the changes in PiRpcAgent

**Edit:** `src/adapters/agents/pi/rpc-agent.ts`

Add three new config options:
```typescript
export interface PiRpcAgentOptions {
  provider?: string;
  model?: string;
  sessionDir?: string;
  systemPrompt?: string;       // path to custom system prompt file
  appendSystemPrompt?: string; // path to append to default prompt
  tools?: string;              // comma-separated tool allowlist, e.g. "read,bash"
  responseTimeoutMs?: number;
}
```

In `spawn()`, append the flags:
```typescript
const args = ["--mode", "rpc", "--session-dir", this.opts.sessionDir];
if (this.opts.systemPrompt) {
  const prompt = await fs.readFile(this.opts.systemPrompt, "utf-8");
  args.push("--system-prompt", prompt);
}
if (this.opts.tools) {
  args.push("--tools", this.opts.tools);
}
```

### Step 5: Add env vars

**.env:**
```
PI_SYSTEM_PROMPT=./assistant-prompt.md
PI_APPEND_SYSTEM_PROMPT=./jarvis-rules.md
PI_TOOLS=read,bash
```

**`src/config/env.ts`:**
```typescript
export interface EnvConfig {
  DISCORD_TOKEN: string;
  PI_PROVIDER?: string;
  PI_MODEL?: string;
  PI_SESSION_DIR?: string;
  PI_SYSTEM_PROMPT?: string;
  PI_APPEND_SYSTEM_PROMPT?: string;
  PI_TOOLS?: string;
  // ...
}
```

### Step 6: Move session files out of project dir

Set `PI_SESSION_DIR` to something like `~/.local/share/botan-ebi/sessions` so pi's session files don't clutter the project:

```
PI_SESSION_DIR=/home/dheeto/.local/share/botan-ebi/sessions
```

### Implementation Order

1. Add `systemPrompt`, `tools` options to `PiRpcAgent` and pass them to pi subprocess (trivial change)
2. Write `assistant-prompt.md` with Jarvis personality (the fun part)
3. Test — send a "hi" and verify tone is different
4. Set `PI_SESSION_DIR` to a proper location
5. Add pi extensions for web search, reminders, etc. as needed

### Future tools (pi extensions)

- **Web search:** `~/.pi/agent/extensions/web-search.ts` — wraps Brave Search API
- **Reminders:** Use existing HeartbeatMonitor + a custom tool that writes heartbeat files
- **Weather:** Simple bash tool — `curl wttr.in/{location}?format=%C+%t`
- **Home automation:** Pi extension calling Home Assistant REST API
- **Calendar:** Read/write iCal files via bash

These can be added incrementally — each is a standalone pi extension, no bot code changes needed.
