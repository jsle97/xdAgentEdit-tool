# Technical Documentation

## Structure
The application code is located in the `src/` directory:

- `src/agent-edit.js` – main CLI entry point and orchestration of the plan/execution process.
- `src/agent-edit-ai.js` – AI provider configuration, tool definitions, and tool executor.
- `src/agent-edit-editor.js` – public API `FileEditor` for file operations.
- `src/agent-edit-editor-fnc.js` – low-level I/O functions, locks, validations, and path security.
- `src/agent-edit-helpers.js` – logging, colors, diff, and CLI helper functions.
- `src/load-env.js` – loading variables from the `.env` file.

## Workflow
1. **Input validation**: `agent-edit.js` checks arguments and file availability.
2. **Backup**: creates a `*.bak` file for safety.
3. **Task collection**: `readline` interface gathers user instructions.
4. **Planning**: call `callAPI()` with the planner model using the full file context.
5. **Iterative execution**: worker model uses tools and modifies the file.
6. **Quality control**: syntax checking and summary statistics.

## AI Tools (tool calling)
Defined in `src/agent-edit-ai.js`:
- `read_file(path)`
- `str_replace(path, old_str, new_str)`
- `advanced_edit(operation, ...)`
- `bash(command)`
- `finish()`

`executeTool()` maps each tool call to `FileEditor` operations or shell commands.

## Security and Reliability
- Protection against path traversal via `resolveSafe()` (root = `process.cwd()`).
- Atomic file writing through temporary file + rename (`atomicWriteRaw`).
- File-level locks (`acquireLock`) and concurrency limit (`withConcurrencyLimit`).
- Batch operation validation (`validateOperation`).
- File size and regex length limits (`MAX_FILE_SIZE`, `REGEX_MAX_LENGTH`).

## Operational Notes
- The tool assumes a Node.js environment.
- Syntax verification is performed using `node --check`.
- In case of errors, it is possible to revert to the `*.bak` backup.
