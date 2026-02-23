// agent-edit-ai.js
// AI integration: provider config, API calls, tool schemas, tool executor

import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { FileEditor } from './agent-edit-editor.js';
import { showDiff } from './agent-edit-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnv = function () {
 const envPath = path.resolve(__dirname, '..', '.env');
 const localPath = path.resolve(__dirname, '.env');
 const target = fs.existsSync(envPath) ? envPath : fs.existsSync(localPath) ? localPath : null;
 if (!target) return;

 const lines = fs.readFileSync(target, 'utf8').split('\n');
 for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
   process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
  }
 }
};

loadEnv();

// ==================== AI PROVIDER CONFIGURATION ====================
// OpenAI-compatible API provider settings
export const AI_PROVIDER = {
 apiKey: process.env.AI_API_KEY || "",
 baseUrl: process.env.AI_BASE_URL || "",
 basePath: "/v1/chat/completions",
 models: {
  planner: process.env.EDITOR_PLANNER || "",
  worker: process.env.EDITOR_WORKER || "",
  fallback: process.env.EDITOR_FALLBACK || ""
 },
 maxFailures: 3,
 maxIterations: 48,
 timeout: 640000,
 temperature: 0.65,
 maxTokens: 16384
};

// ==================== AI TOOL SCHEMAS ====================
export const AI_TOOLS = [
 {
  type: "function",
  function: {
   name: "read_file",
   description: "Reads the content of a file. Returns the content or an error.",
   parameters: {
    type: "object",
    properties: {
     path: { type: "string", description: "Path to the file" }
    },
    required: ["path"]
   }
  }
 },
 {
  type: "function",
  function: {
   name: "str_replace",
   description: "Edits a file by replacing an exact text fragment with another. Use an EXACT code fragment.",
   parameters: {
    type: "object",
    properties: {
     path: { type: "string", description: "Path to the file" },
     old_str: { type: "string", description: "Exact text to replace" },
     new_str: { type: "string", description: "New text" }
    },
    required: ["path", "old_str", "new_str"]
   }
  }
 },
 {
  type: "function",
  function: {
   name: "advanced_edit",
   description: "Advanced edits: replacePattern, editFragment, replaceVariable etc.",
   parameters: {
    type: "object",
    properties: {
     operation: {
      type: "string",
      enum: ["replacePattern", "replaceVariable", "editFragment", "append", "prepend", "editLinePart"],
      description: "Operation type"
     },
     path: { type: "string", description: "Path to the file" },
     pattern: { type: "string", description: "Regex pattern (for replacePattern)" },
     replacement: { type: "string", description: "Replacement (for replacePattern)" },
     flags: { type: "string", description: "Regex flags" },
     old_name: { type: "string", description: "Old variable name" },
     new_name: { type: "string", description: "New variable name" },
     scope: { type: "string", enum: ["global", "first"], default: "global" },
     start_line: { type: "number", description: "Number of the first line (1-based)" },
     end_line: { type: "number", description: "Number of the last line" },
     fragment_content: { type: "string", description: "New content of the fragment" },
     line: { type: "number", description: "Line number (1-based)" },
     char_start: { type: "number", description: "Starting character index (0-based)" },
     char_end: { type: "number", description: "Ending character index (exclusive)" },
     new_fragment: { type: "string", description: "New line fragment" },
     content: { type: "string", description: "Content to add" },
     add_new_line: { type: "boolean", description: "Whether to add a new line before/after" }
    },
    required: ["operation", "path"]
   }
  }
 },
 {
  type: "function",
  function: {
   name: "bash",
   description: "Executes a shell command. Use for tests, syntax checking.",
   parameters: {
    type: "object",
    properties: {
     command: { type: "string", description: "Command to execute" }
    },
    required: ["command"]
   }
  }
 },
 {
  type: "function",
  function: {
   name: "finish",
   description: "Finishes the task. Use when you consider the task completed successfully.",
   parameters: { type: "object", properties: {} }
  }
 }
];

// ==================== API CLIENT ====================
export const callAPI = (model, messages, tools = null) => {
 return new Promise((resolve, reject) => {
  const payload = {
   model: model,
   messages: messages,
   temperature: AI_PROVIDER.temperature,
   max_tokens: AI_PROVIDER.maxTokens
  };

  if (tools) payload.tools = tools;

  const data = JSON.stringify(payload);

  const req = https.request({
   hostname: AI_PROVIDER.baseUrl,
   path: AI_PROVIDER.basePath,
   method: "POST",
   headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${AI_PROVIDER.apiKey}`
   },
   timeout: AI_PROVIDER.timeout
  }, (res) => {
   let body = '';
   res.on('data', chunk => body += chunk);
   res.on('end', () => {
    try {
     const json = JSON.parse(body);
     if (json.error) reject(new Error(json.error.message));
     else resolve(json);
    } catch (e) {
     reject(e);
    }
   });
  });

  req.on('error', reject);
  req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  req.write(data);
  req.end();
 });
};

// ==================== TOOL EXECUTOR ====================
export const executeTool = async (name, args, targetFile, execCommand) => {
 switch (name) {
  case 'read_file': {
   try {
    const filePath = args.path || targetFile;
    const result = await FileEditor.readFile({ filePath });
    return result.success ? result.content : `ERROR: ${result.error}`;
   } catch (e) {
    return `READ ERROR: ${e.message}`;
   }
  }

  case 'str_replace': {
   try {
    const filePath = args.path || targetFile;
    const result = await FileEditor.readFile({ filePath });

    if (!result.success) {
     return `ERROR: ${result.error}`;
    }

    const oldContent = result.content;

    if (!oldContent.includes(args.old_str)) {
     return `ERROR: Fragment not found in file.`;
    }

    const newResult = await FileEditor.replaceText({
     filePath,
     oldStr: args.old_str,
     newStr: args.new_str,
     backup: false
    });

    if (newResult.success) {
     const newContent = await FileEditor.readFile({ filePath });
     if (newContent.success) {
      showDiff(oldContent, newContent.content);
     }
     return `✓ Replaced fragment in ${path.basename(filePath)} (${newResult.replacements} changes)`;
    } else {
     return `EDIT ERROR: ${newResult.message}`;
    }
   } catch (e) {
    return `ERROR: ${e.message}`;
   }
  }

  case 'advanced_edit': {
   try {
    const filePath = args.path || targetFile;
    let result;

    switch (args.operation) {
     case 'replacePattern':
      result = await FileEditor.replacePattern({
       filePath,
       pattern: args.pattern,
       replacement: args.replacement,
       flags: args.flags || 'g',
       backup: false
      });
      break;

     case 'replaceVariable':
      result = await FileEditor.replaceVariable({
       filePath,
       oldName: args.old_name,
       newName: args.new_name,
       scope: args.scope || 'global',
       backup: false
      });
      break;

     case 'editFragment':
      result = await FileEditor.editFragment({
       filePath,
       startLine: args.start_line,
       endLine: args.end_line,
       content: args.fragment_content,
       backup: false
      });
      break;

     case 'append':
      result = await FileEditor.append({
       filePath,
       content: args.content,
       addNewLine: args.add_new_line !== false,
       backup: false
      });
      break;

     case 'prepend':
      result = await FileEditor.prepend({
       filePath,
       content: args.content,
       addNewLine: args.add_new_line !== false,
       backup: false
      });
      break;

     case 'editLinePart':
      result = await FileEditor.editLinePart({
       filePath,
       line: args.line,
       start: args.char_start,
       end: args.char_end,
       newFragment: args.new_fragment,
       backup: false
      });
      break;

     default:
      return `Unknown operation: ${args.operation}`;
    }

    return result.success
     ? `✓ ${args.operation} executed successfully`
     : `ERROR: ${result.error || result.message}`;
   } catch (e) {
    return `ERROR: ${e.message}`;
   }
  }

  case 'bash': {
   return new Promise((resolve) => {
    execCommand(args.command, { timeout: 60000 }, (error, stdout, stderr) => {
     if (error) {
      resolve(`ERROR (exit ${error.code}): ${stderr || error.message}`);
     } else {
      resolve(stdout || stderr || '(empty output)');
     }
    });
   });
  }

  case 'finish': {
   return "TASK_COMPLETED";
  }

  default:
   return `Unknown tool: ${name}`;
 }
};

// ==================== SYSTEM PROMPTS ====================
export const SYSTEM_PROMPTS = {
 planner: "You are an Intelligent Project Architect for software development. Transform requirements into concise, actionable plans for production systems. Expertise: architecture, tech stacks (web/mobile/AI/databases/cloud), security (GDPR/HIPAA), performance, deployment.\n\nMain goal: Analyze requirements and generate executable plans.\n\n# TASKS\nPrimary task: Create structured plans.\n\nTasks:\n1. Extract Requirements: List explicit/implicit needs (e.g., security, scalability).\n2. Design Architecture: Select patterns (e.g., monolith/microservices) and tech stack.\n3. Add Essentials: Include logging, monitoring, testing, security, CI/CD.\n4. Structure Plan: Divide into phases with high-level tasks and brief justifications.\n5. Output Concisely: Use format below; justify key decisions briefly.\n\n# OUTPUT FORMAT\n## PROJECT SUMMARY\n- Type: [Web/Mobile/etc.]\n- Core Requirements: [Bullets]\n- Tech Stack: [Keys]\n- Added Essentials: [e.g., Security]\n\n## KEY DECISIONS\n- [Decision]: [Reasoning]\n\n---\n\n# IMPLEMENTATION PLAN\n## PHASE 1: Setup & Foundation\n### Task 1.1: [e.g., Initialize Project]\n- Purpose: [Brief]\n- Tech: [Tools]\n\n[Additional full tasks per phase...]\n\n## PHASE 2: Core Development\n### Task 2.1: [e.g., Build Feature]\n- Purpose: [Brief]\n- Tech: [Tools]\n\n[PHASE 3: Quality & Security; PHASE 4: Deploy & Operate - full tasks only]\n\n---\n\n# CONSTRAINTS\n- Design for reliability, scalability, maintainability.\n- Add production components proactively.\n- Limit to full tasks; no subtasks.",

 worker: `You are a precise code editor with access to advanced tools.

AVAILABLE TOOLS:
1. read_file(path) - reads a file
2. str_replace(path, old_str, new_str) - replaces an EXACT fragment of text
3. advanced_edit(operation, ...) - advanced operations:
   - replacePattern: regex replacement
   - replaceVariable: safe variable renaming (word boundary)
   - editFragment: line range replacement
   - append/prepend: adding at the end/beginning
   - editLinePart: editing part of a line
4. bash(command) - executes shell command (tests, syntax)
5. finish() - finishes the task

RULES:
- Use str_replace only when you have an EXACT fragment of code to replace.
- For regex replacement, use advanced_edit with operation='replacePattern'.
- For variable renaming, use replaceVariable (ensures word boundary).
- After each edit, check syntax (bash "node --check <file>").
- If an error occurs - fix it immediately.
- When finished, call tool:finish().`
};