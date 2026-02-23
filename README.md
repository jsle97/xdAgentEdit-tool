# xdAgentEdit-tool

An AI-powered CLI tool that edits code files through natural language instructions. You describe what needs to change — the agent reads the file, plans the modifications, and applies them iteratively using structured tool calls.

Built for developers who want to automate repetitive code transformations without leaving the terminal. Works with any OpenAI-compatible API provider.

---

## How It Works

The tool operates in two phases, mimicking how a senior developer would approach a code change:

```
┌─────────────────────────────────────────────────────┐
│  PHASE 1: PLANNING                                  │
│  Planner model analyzes the file + your task        │
│  → produces a structured implementation plan        │
├─────────────────────────────────────────────────────┤
│  PHASE 2: EXECUTION                                 │
│  Worker model follows the plan using 5 tools:       │
│  read_file → str_replace → advanced_edit → bash     │
│  Iterates until finish() or max 48 iterations       │
│  Auto-switches to fallback model after 3 failures   │
│  Validates syntax after each edit (node --check)    │
└─────────────────────────────────────────────────────┘
```

Every edit goes through `FileEditor` — a battle-tested file manipulation engine with atomic writes, file-level locks, and path traversal protection. Your original file is backed up before any changes.

---

## Quick Start

```bash
git clone https://github.com/jsle97/xdAgentEdit-tool.git
cd xdAgentEdit-tool
```

Create a `.env` file:
```env
AI_API_KEY=your-api-key-here
AI_BASE_URL=api.deepinfra.com
EDITOR_PLANNER=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
EDITOR_WORKER=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
EDITOR_FALLBACK=Qwen/Qwen3-235B-A22B
```

Run it:
```bash
node src/agent-edit.js server.js
```

In the interactive prompt, describe what you want:
```
paste> Refactor the route handlers to use async/await instead of callbacks.
paste> Add proper error handling with try/catch blocks.
paste> Make sure all database calls use parameterized queries.
paste> /exec
```

The agent takes over:
```
◆ PHASE 1: PLANNING (meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8)
  [structured plan output...]

◆ PHASE 2: EXECUTION (meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8)
  [Iteration 1 | Model: Llama-4-Maverick | Failures: 0]
  ⚙ read_file(path="server.js")
  ⚙ str_replace(path="server.js", old_str="db.query(sql, function...", new_str="const result = await db.query...")
  ⚙ bash(command="node --check server.js")
    ✓ Syntax is correct
  ...
  ✓ TASK COMPLETED
```

---

## AI Tools

The worker model has access to 5 tools, each mapped to safe `FileEditor` operations:

### `read_file(path)`
Reads file content with size limits (10MB max). Resolves paths safely — path traversal attempts are blocked.

### `str_replace(path, old_str, new_str)`
Finds an **exact** text fragment and replaces it. Shows a colored diff after each replacement. This is the primary editing tool — precise and predictable.

### `advanced_edit(operation, ...)`
Six specialized operations for cases where `str_replace` isn't enough:

| Operation | Description | Key Parameters |
|-----------|-------------|----------------|
| `replacePattern` | Regex-based find & replace | `pattern`, `replacement`, `flags` |
| `replaceVariable` | Safe variable renaming (word boundary) | `old_name`, `new_name`, `scope` |
| `editFragment` | Replace a range of lines | `start_line`, `end_line`, `fragment_content` |
| `append` | Add content at end of file | `content`, `add_new_line` |
| `prepend` | Add content at start of file | `content`, `add_new_line` |
| `editLinePart` | Replace characters within a specific line | `line`, `char_start`, `char_end`, `new_fragment` |

### `bash(command)`
Executes shell commands (60s timeout). Primarily used for syntax checking (`node --check`) and running tests after edits.

### `finish()`
Signals task completion. Triggers final syntax validation.

---

## Architecture

```
agent-edit.js               CLI entry point — backup, readline input, phase orchestration
  ├─ agent-edit-ai.js       AI provider config, API client, tool schemas, tool executor
  ├─ agent-edit-editor.js   FileEditor API — high-level file operations
  ├─ agent-edit-editor-fnc.js   Low-level I/O: atomic writes, locks, path security, regex cache
  ├─ agent-edit-helpers.js  Terminal colors, logging, diff visualization, syntax checking
  └─ load-env.js            Environment variable loader
```

### FileEditor — The Editing Engine

All file modifications go through `FileEditor`, which provides:

**Atomic writes** — every file write goes through a temporary file + rename cycle. If the rename fails (including cross-device `EXDEV` scenarios), it retries up to 4 times with exponential backoff. No half-written files.

**File-level locks** — concurrent edits to the same file are serialized via a Map-based lock system with 5-second timeout. Tracks active/max/total lock stats for debugging.

**Path traversal protection** — `resolveSafe()` ensures all file paths resolve within `process.cwd()`. Attempts to access `../../etc/passwd` throw immediately.

**Batch operations** — multiple edits can be grouped and applied atomically per file, with a configurable concurrency limit (default: 5 files in parallel).

**Regex caching** — compiled regex patterns are cached in an LRU map (100 entries) to avoid recompilation overhead during repeated operations.

---

## Resilience Features

**Automatic backup** — a timestamped `.bak` copy is created before any edits begin. If something goes wrong, your original is safe.

**Model fallback** — after 3 consecutive tool failures, the agent automatically switches from the worker model to the fallback model and continues. The fallback gets a note that the previous model struggled.

**Iteration limit** — hard cap of 48 iterations prevents infinite loops. If the agent can't finish in 48 tool calls, it stops and reports.

**Syntax validation** — the agent checks `node --check` after each edit. If syntax breaks, it gets the error message and attempts to fix it immediately.

**Diff visualization** — every `str_replace` call prints a colored terminal diff showing exactly what changed, so you can follow along in real time.

---

## Configuration

All settings via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `AI_API_KEY` | API key for your provider | `sk-...` |
| `AI_BASE_URL` | API hostname (no path) | `api.deepinfra.com` |
| `EDITOR_PLANNER` | Model for planning phase | `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` |
| `EDITOR_WORKER` | Model for execution phase | `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` |
| `EDITOR_FALLBACK` | Fallback model on failures | `Qwen/Qwen3-235B-A22B` |

Works with any OpenAI-compatible API (DeepInfra, Together, OpenRouter, Ollama, local vLLM, etc.).

Internal defaults:
- Temperature: `0.65`
- Max tokens: `16384`
- API timeout: `640s`
- Max iterations: `48`
- Max failures before fallback: `3`

---

## Example Session

```bash
$ node src/agent-edit.js api-handler.js

✓ Created backup: api-handler.js.1740300000000.bak

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Paste instructions/diffs for file: api-handler.js
Type /exec to start, or /exit to cancel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

paste> Add input validation to all POST endpoints.
paste> Use a helper function validateBody(schema, body) that throws on invalid input.
paste> Return 400 with descriptive error messages.
paste> /exec

◆ Task: Add input validation to all POST endpoints. Use a helper function...

◆ PHASE 1: PLANNING (planner-model)
  [Plan with phases, tasks, tech decisions...]

◆ PHASE 2: EXECUTION (worker-model)
  [Iteration 1] ⚙ read_file(path="api-handler.js")
  [Iteration 2] ⚙ str_replace(path="api-handler.js", old_str="...", new_str="...")
    ━━━ DIFF ━━━
    - 12: app.post('/users', (req, res) => {
    + 12: app.post('/users', (req, res) => {
    + 13:  const errors = validateBody(userSchema, req.body)
    + 14:  if (errors) return res.status(400).json({ errors })
    ━━━━━━━━━━━━
  [Iteration 3] ⚙ bash(command="node --check api-handler.js")
    ✓ Syntax is correct
  ...
  ✓ TASK COMPLETED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ File: api-handler.js (4832 bytes)
ℹ Iterations: 8
✓ Syntax is correct

✓ Changes applied successfully
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Security

- **Path traversal blocked** — all file paths are resolved against `process.cwd()` and validated
- **File size limit** — 10MB maximum per file operation
- **Regex length limit** — patterns capped at 960 characters to prevent ReDoS
- **Lock timeout** — 5-second timeout prevents deadlocks
- **Shell command timeout** — `bash` tool has 60-second execution limit
- **No network access** — FileEditor only touches local files; network calls are limited to the AI API

---

## Shell Setup

**Option A — symlink (recommended)**

```bash
chmod +x src/agent-edit.js
sudo ln -s "$(pwd)/src/agent-edit.js" /usr/local/bin/xde
```

Now you can edit any file with:
```bash
xde server.js
xde src/utils/parser.js
```

**Option B — shell function with backup info**

Add to `~/.bashrc` or `~/.zshrc`:
```bash
xde() {
 local XDE_DIR="$HOME/tools/xdAgentEdit-tool"
 if [ $# -eq 0 ]; then
  echo "Usage: xde <file-path>"
  return 1
 fi
 if [ ! -f "$1" ]; then
  echo "File not found: $1"
  return 1
 fi
 echo "Backup: $1.bak"
 node "$XDE_DIR/src/agent-edit.js" "$1"
}
```

Then `source ~/.bashrc` and use as `xde server.js`.

**Option C — with model override**

```bash
xde() {
 local XDE_DIR="$HOME/tools/xdAgentEdit-tool"
 EDITOR_PLANNER="${2:-$EDITOR_PLANNER}" \
 EDITOR_WORKER="${2:-$EDITOR_WORKER}" \
 node "$XDE_DIR/src/agent-edit.js" "$1"
}
```

Override model on the fly: `xde handler.js Qwen/Qwen3-235B-A22B`.

---

## Limitations

- Currently targets single-file editing (one file per session)
- Syntax validation uses `node --check` — works for JavaScript/Node.js files
- Requires an OpenAI-compatible API endpoint
- No built-in test suite yet

---

## Requirements

- **Node.js 18+**
- An OpenAI-compatible API key (DeepInfra, OpenRouter, Together, Ollama, etc.)

---

## License

MIT

---

**Author**: Jakub Śledzikowski — [jsle.eu](https://jsle.eu) | jakub@jsle.eu
