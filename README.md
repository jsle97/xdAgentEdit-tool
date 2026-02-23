# xdAgentEdit-tool

`xdAgentEdit-tool` is a CLI tool for editing a single code file with the help of an AI model. The tool operates in two phases:
1. **Planning** (planner model) – creates a plan for changes.
2. **Execution** (worker/fallback model) – applies file edits using a set of tools (`read_file`, `str_replace`, `advanced_edit`, `bash`, `finish`).

## How it works
- You launch the CLI and specify the target file.
- The tool creates a backup `*.bak`.
- You paste commands and finish input with `/exec`.
- The agent analyzes the file, plans changes, and applies them iteratively.
- Syntax validation is performed at the end with `node --check`.

## Configuration
Configuration is done via environment variables (a `.env` file in the project directory or locally near `src/` files):

- `AI_API_KEY` – API key
- `AI_BASE_URL` – API host (without path)
- `EDITOR_PLANNER` – planning model
- `EDITOR_WORKER` – execution model
- `EDITOR_FALLBACK` – fallback model

## Usage
```bash
node src/agent-edit.js <file-path>
```

Example:
```bash
node src/agent-edit.js server.js
```

In interactive mode:
- enter the task description,
- finish with `/exec` (start),
- or `/exit` (cancel).
