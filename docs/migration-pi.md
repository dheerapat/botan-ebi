# Migration: Opencode → Pi

**Project:** Botan-ebi — Discord bot powered by an AI agent harness
**Current:** Opencode (`@opencode-ai/sdk` + `opencode serve`)
**Target:** Pi (`@earendil-works/pi-coding-agent`)
**Status:** Draft

---

## Table of Contents

1. [Why Migrate](#1-why-migrate)
2. [Current Architecture](#2-current-architecture)
3. [Target Architecture](#3-target-architecture)
4. [Pi Integration Options](#4-pi-integration-options)
5. [Migration Steps](#5-migration-steps)
6. [File Changes Summary](#6-file-changes-summary)
7. [Deferred / Optional](#7-deferred--optional)
8. [Rollback Plan](#8-rollback-plan)

---

## 1. Why Migrate

- **Replace two processes** (opencode server + bot) with **one** (bot spawns pi as subprocess or uses SDK in-process)
- **Eliminate `opencode-assistant/` bundle** — no more opencode config, MCP server config, prompts living in the project
- **Pi has richer event streaming** — message deltas, thinking output, tool execution events out of the box
- **Pi manages sessions** — no manual session create/delete/persist cycle
- **Pi handles auth** — API keys via `auth.json` or env vars, no per-provider config needed in the project
- **Pi is the team's standard** — consistent with other tooling

---

## 2. Current Architecture

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

The `OpencodeAgent` uses three SDK calls:

| SDK call | Purpose |
|----------|---------|
| `client.session.create({ body: { title } })` | Create session per Discord channel |
| `client.session.prompt({ path: { id }, body: { parts } })` | Send message, get response |
| `client.session.delete({ path: { id } })` | Reset session on `/reset` command |

Each call is wrapped in `retryWithBackoff` (exponential backoff, 3 attempts).

---

## 3. Target Architecture

### Option A: RPC Subprocess

```
┌──────────────────────────────────────┐
│            botan-ebi (bun)           │
│                                      │
│  Kernel                              │
│  ├─ DiscordInputAdapter              │
│  ├─ DiscordOutputAdapter             │
│  ├─ PiRpcAgent ◄── stdin/stdout ──► pi --mode rpc   │
│  ├─ QueueManager (keep or remove)    │
│  ├─ SessionManager (simplified)      │
│  └─ HeartbeatMonitor (keep or cron)  │
└──────────────────────────────────────┘
```

### Option B: In-process SDK

```
┌──────────────────────────────────────────────┐
│              botan-ebi (bun)                  │
│                                               │
│  Kernel                                       │
│  ├─ DiscordInputAdapter                       │
│  ├─ DiscordOutputAdapter                      │
│  ├─ PiSdkAgent ─── createAgentSession() ──►   │
│  │                   @earendil-works/         │
│  │                   pi-coding-agent          │
│  ├─ QueueManager (keep or remove)             │
│  ├─ SessionManager (simplified)               │
│  └─ HeartbeatMonitor (keep or cron)           │
└──────────────────────────────────────────────┘
```

---

## 4. Pi Integration Options

### Option A: RPC mode (recommended for this migration)

**How it works:**
```typescript
const proc = spawn("pi", ["--mode", "rpc", "--no-session"]);
// Send JSONL commands to stdin
// Read JSONL events from stdout
```

**Commands we'd use:**
| Current SDK call | Pi RPC equivalent |
|---|---|
| `client.session.create()` | `{"type":"new_session"}` (or `{"type":"switch_session","sessionPath":"..."}` to resume) |
| `client.session.prompt()` | `{"type":"prompt","message":"..."}` |
| `client.session.delete()` | `{"type":"new_session"}` (resets implicitly) |
| — | `{"type":"abort"}` to cancel |
| — | Streaming events for real-time output |

**Pi manages sessions natively** — each Discord channel maps to a Pi session file (e.g., `discord-<channelId>.jsonl`). The bot uses `switch_session` to load the right one.

**Pros:**
- Process isolation (pi crash doesn't crash the bot)
- Clean replacement for the opencode subprocess model
- No bundling pi's SDK into the bot's dependency tree
- Can restart pi independently if needed

**Cons:**
- JSONL framing needs careful implementation (custom line reader, not Node `readline`)
- Two processes instead of one
- Need to handle subprocess lifecycle (restart on crash, etc.)

### Option B: In-process SDK

**How it works:**
```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  tools: ["read", "bash", "edit", "write"],
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // accumulate response
  }
});

await session.prompt(message);
```

**Pros:**
- Single process, no IPC overhead
- Type-safe, full access to Pi API
- Simpler error handling (no subprocess management)

**Cons:**
- Heavier dependency in `package.json`
- Pi's dependency tree is large (brings in agent-core, AI clients, etc.)
- Harder to restart independently if something goes wrong

### Recommendation

**Start with RPC mode.** It's the closer mental model to the current opencode setup (external process ↔ bot), easier to test in isolation, and avoids adding a large SDK dependency to the bot. The RPC client implementation is straightforward.

---

## 5. Migration Steps

### Step 1: Create `PiRpcAgent` adapter

**New file:** `src/adapters/agents/pi/rpc-agent.ts`

Replaces `OpencodeAgent`. Implements the same `IAgentAdapter` interface.

**Responsibilities:**
- Spawn `pi --mode rpc` as a subprocess (or connect to an existing one)
- Implement JSONL protocol: framed reads from stdout, writes to stdin
- Map `process(message)` → send `prompt` command, collect response from events
- Map `/reset` → send `new_session` command
- Map `channelId` → Pi session name (e.g., `discord-<channelId>`)
- Handle subprocess lifecycle: spawn on `start()`, kill on `stop()`, restart on crash

**Key implementation details:**
- Use raw ` spawn` from `child_process` with `stdio: ["pipe", "pipe", "inherit"]`
- Implement a proper JSONL reader (split on `\n`, strip `\r`, *not* Node `readline`)
- Track `channelId → sessionPath` mapping (replaces current `SessionManager`)
- On `process()`: if no session for channel, do nothing special (Pi creates one implicitly on first prompt). Or use `switch_session` to resume.
- Parse streaming events to build the final response text

**Dependencies added:** None (uses Node built-in `child_process`)

### Step 2: Simplify `SessionManager`

**Edit:** `src/adapters/agents/opencode/session-manager.ts`

**Before:** Maps `channelId → opencode sessionId`, persists to `sessions.json`, creates/deletes via API.

**After:** Maps `channelId → pi session file path`. Pi stores sessions on disk automatically. The bot only needs to remember which session file belongs to which channel.

This could become much simpler:

```typescript
// SessionManager becomes a thin map channelId → sessionPath
// Pi handles session persistence internally
// On new_session, we just unlink the old session path
```

**Alternative:** The PiRpcAgent can manage this internally without a separate SessionManager class.

### Step 3: Remove `@opencode-ai/sdk` dependency

**Edit:** `package.json`

Remove:
```json
"@opencode-ai/sdk": "^1.3.0"
```

No replacement dependency if using RPC mode. If using SDK mode, add:
```json
"@earendil-works/pi-coding-agent": "..."
```

### Step 4: Update environment config

**Edit:** `src/config/env.ts` and `.env.example`

Changes:
- Remove `OPENCODE_BASE_URL`, `OPENCODE_PROVIDER_ID`, `OPENCODE_MODEL_ID`
- Add `PI_PROVIDER` and `PI_MODEL` (optional overrides for `pi --mode rpc --provider ... --model ...`)
- Pi reads API keys from env vars (`ANTHROPIC_API_KEY`, etc.) or `~/.pi/agent/auth.json`

### Step 5: Update `bootstrap.sh`

**Edit:** `bootstrap.sh`

- Remove opencode server management (`start_opencode`, `stop_opencode`, related vars)
- The bot is now the only managed process
- Pi is either a subprocess (managed by the bot itself) or used via SDK (no separate process)
- Rename PID file from `.bot.pid` to something appropriate
- Consider: if using RPC, pi is spawned by the bot, so the bot process is the only thing to manage

### Step 6: Update `Kernel`

**Edit:** `src/kernel/kernel.ts`

Minimal changes:
- The `PiRpcAgent` replaces `OpencodeAgent` in `src/index.ts`, kernel doesn't care
- `HeartbeatMonitor` stays as-is (it's channel-context routing, independent of the agent)
- `QueueManager` stays as-is unless we decide to simplify (see [deferred](#7-deferred--optional))

### Step 7: Update entry point

**Edit:** `src/index.ts`

```typescript
// Before:
import OpencodeAgent from "+adapters/agents/opencode/opencode.js";
const opencodeAgent = new OpencodeAgent();

// After (RPC):
import PiRpcAgent from "+adapters/agents/pi/rpc-agent.js";
const piAgent = new PiRpcAgent({
  provider: env.PI_PROVIDER,
  model: env.PI_MODEL,
  sessionDir: env.PI_SESSION_DIR,
});

// After (SDK):
import PiSdkAgent from "+adapters/agents/pi/sdk-agent.js";
const piAgent = new PiSdkAgent({
  provider: env.PI_PROVIDER,
  model: env.PI_MODEL,
});
```

### Step 8: Update `.gitignore` and clean up

- Remove `opencode-assistant/` from the project (or keep as reference but stop bundling it)
- Pi's session files go in `.pi/sessions/` — add to `.gitignore` if not already
- Update `README.md` with new setup instructions

### Step 9: Update tests

**Edit:** `tests/opencode.test.ts` → `tests/pi-agent.test.ts`

Rewrite tests to cover:
- PiRpcAgent subprocess lifecycle (spawn, kill, restart)
- Message processing (send prompt, collect response from events)
- Session mapping (channelId → session path)
- Reset command (`/reset` → `new_session`)
- Error handling (pi process crash, timeout, invalid response)

---

## 6. File Changes Summary

### RPC mode

| File | Action | Reason |
|------|--------|--------|
| `src/adapters/agents/pi/rpc-agent.ts` | **Create** | New Pi RPC agent adapter |
| `src/adapters/agents/opencode/session-manager.ts` | **Rewrite** | Simplify — channel→sessionPath map only |
| `src/adapters/agents/opencode/opencode.ts` | **Delete** | Replaced by rpc-agent.ts |
| `src/config/env.ts` | **Edit** | Replace opencode env vars with pi env vars |
| `.env.example` | **Edit** | Same |
| `src/index.ts` | **Edit** | Wire up PiRpcAgent instead of OpencodeAgent |
| `package.json` | **Edit** | Remove `@opencode-ai/sdk` |
| `bootstrap.sh` | **Edit** | Remove opencode server management |
| `tests/opencode.test.ts` | **Rename + rewrite** | → `tests/pi-agent.test.ts` |
| `opencode-assistant/` | **Remove or archive** | No longer needed |
| `README.md` | **Edit** | Update setup/run instructions |

### Additional for SDK mode

| File | Action | Reason |
|------|--------|--------|
| `package.json` | **Add dep** | `@earendil-works/pi-coding-agent` |
| `src/adapters/agents/pi/sdk-agent.ts` | **Create** | SDK-based agent adapter |

---

## 7. Deferred / Optional

These are things we could simplify during migration but aren't required for the first cut:

### File-based queue (`QueueManager`)
The file-based queue was useful for crash recovery when talking to opencode over HTTP. With Pi's streaming RPC, the bot could simplify to in-memory queues. **Keep for now** — removing it is a separate cleanup.

### HeartbeatMonitor
Pi has no built-in cron/heartbeat. The custom `HeartbeatMonitor` (filesystem-watch based) works independently of the agent adapter. **Keep as-is** — it's decoupled from opencode.

### MCP servers
Current opencode config includes `graph-memory`, `brave-search`, and `chrome-devtools` MCP servers. Pi supports MCP servers as well via `~/.pi/agent/settings.json` or project `.pi/settings.json`. **Defer** — migrate MCP config separately after the core migration.

### Pi skills and extensions
Pi supports skills (`.pi/skills/`) and extensions (`.pi/extensions/`). The current assistant prompt lives in `opencode-assistant/.opencode/prompts/assistant.txt`. This can be migrated to a Pi skill. **Defer** — not required for the initial swap.

---

## 8. Rollback Plan

If the migration causes issues:

1. **Keep `opencode-assistant/` directory** in place (don't delete it during migration)
2. **Keep `@opencode-ai/sdk` in package.json** during development (remove only after confirming Pi works)
3. **Feature flag** in `src/index.ts`:
   ```typescript
   const usePi = process.env.USE_PI === "true";
   const agent = usePi ? new PiRpcAgent() : new OpencodeAgent();
   ```
4. **Restore `bootstrap.sh`** from git if needed
