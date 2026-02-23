#!/usr/bin/env node
// agent-edit.js
// Main entry point for xdedit-pro

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';

import { FileEditor } from './agent-edit-editor.js';
import { AI_PROVIDER, AI_TOOLS, callAPI, executeTool, SYSTEM_PROMPTS } from './agent-edit-ai.js';
import { colors, log, checkSyntax, printUsage, printInputHeader, printSummaryHeader, printSummaryFooter } from './agent-edit-helpers.js';

// ==================== MAIN FUNCTION ====================
const main = async () => {
 if (process.argv.length < 3) {
  printUsage();
  process.exit(1);
 }

 const targetFile = path.resolve(process.argv[2]);

 try {
  await fs.access(targetFile);
 } catch (error) {
  log.error(`File does not exist: ${targetFile}`);
  process.exit(1);
 }

 // Create backup
 try {
  const content = await FileEditor.readFile({ filePath: targetFile });
  if (content.success) {
   const backupFile = `${targetFile}.${Date.now()}.bak`;
   await fs.writeFile(backupFile, content.content, 'utf8');
   log.success(`Created backup: ${path.basename(backupFile)}`);
  }
 } catch (e) {
  log.warn(`Failed to create backup: ${e.message}`);
 }

 // Interactive task input
 const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${colors.cyan}paste>${colors.reset} `
 });

 printInputHeader(path.basename(targetFile));

 const lines = [];

 for await (const line of rl) {
  const trimmed = line.trim();

  if (trimmed === '/exec') {
   rl.close();
   break;
  }

  if (trimmed === '/exit') {
   log.info("Cancelled");
   process.exit(0);
  }

  lines.push(line);
 }

 const task = lines.join('\n').trim();

 if (!task) {
  log.error("No task provided");
  process.exit(1);
 }

 log.step(`Task: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);

 // Read file
 const fileContent = await FileEditor.readFile({ filePath: targetFile });
 if (!fileContent.success) {
  log.error(`Failed to read file: ${fileContent.error}`);
  process.exit(1);
 }

 const ext = path.extname(targetFile).slice(1);

 // PHASE 1: PLANNING
 console.log(`\n${colors.magenta}◆ PHASE 1: PLANNING (${AI_PROVIDER.models.planner})${colors.reset}`);

 const planMessages = [
  { role: "system", content: SYSTEM_PROMPTS.planner },
  {
   role: "user",
   content: `[FILE PATH: ${path.basename(targetFile)}]
TASK: ${task}

FILE CONTENT:
\`\`\`${ext}
${fileContent.content.replaceAll(/\n/g, ' ')}
\`\`\`
`
  }
 ];

 let plan;
 try {
  const planRes = await callAPI(AI_PROVIDER.models.planner, planMessages);
  plan = planRes.choices[0].message.content;
  console.log(`${colors.dim}${plan.replaceAll(/\n/g, ' ').substring(0, 9200)}${plan.length > 9200 ? '...' : ''}${colors.reset}\n`);
 } catch (e) {
  log.error(`Planning error: ${e.message}`);
  plan = "Execute the task: " + task;
 }

 // PHASE 2: EXECUTION
 console.log(`${colors.magenta}◆ PHASE 2: EXECUTION (${AI_PROVIDER.models.worker})${colors.reset}`);

 const workerMessages = [
  { role: "system", content: SYSTEM_PROMPTS.worker },
  {
   role: "user",
   content: `[FILE PATH: ${targetFile}]
TASK: ${task}

PLAN:
${plan}

CURRENT FILE CONTENT (partial):
\`\`\`${ext}
${fileContent.content.substring(0, 800)}${fileContent.content.length > 800 ? ' - use tool:read_file for more, call tool BEFORE start implementation' : ''}
\`\`\`

Start implementation. Check syntax after each edit.`
  }
 ];

 let currentModel = AI_PROVIDER.models.worker;
 let failureCount = 0;
 let iterations = 0;
 let taskComplete = false;

 while (iterations < AI_PROVIDER.maxIterations && !taskComplete) {
  iterations++;
  console.log(`\n${colors.dim}  [Iteration ${iterations} | Model: ${currentModel.split('/')[1]} | Failures: ${failureCount}]${colors.reset}`);

  try {
   const response = await callAPI(currentModel, workerMessages, AI_TOOLS);
   const msg = response.choices[0].message;

   workerMessages.push(msg);

   if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const toolCall of msg.tool_calls) {
     const toolName = toolCall.function.name;
     const toolArgs = JSON.parse(toolCall.function.arguments);

     console.log(`\n${colors.cyan}⚙ ${toolName}${colors.reset}(${Object.keys(toolArgs).map(k => `${k}=${typeof toolArgs[k] === 'string' ? `"${toolArgs[k].substring(0, 30)}${toolArgs[k].length > 30 ? '...' : ''}"` : toolArgs[k]}`).join(', ')})`);

     let result = await executeTool(toolName, toolArgs, targetFile, exec);

     if (result instanceof Promise) {
      result = await result;
     }

     if (result === "TASK_COMPLETED") {
      taskComplete = true;
      console.log(`\n${colors.green}${colors.bold}✓ TASK COMPLETED${colors.reset}`);

      log.step("Checking syntax...");
      await checkSyntax(targetFile);
      break;
     }

     if (result.length > 200) {
      console.log(`${colors.dim}    ${result.substring(0, 200).replace(/\n/g, ' ')}...${colors.reset}`);
     } else {
      console.log(`${colors.dim}    ${result.replace(/\n/g, ' ')}${colors.reset}`);
     }

     workerMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      name: toolName,
      content: result
     });

     if (result.startsWith('ERROR')) {
      failureCount++;
     } else {
      failureCount = Math.max(0, failureCount - 1);
     }
    }
   } else {
    if (msg.content) {
     console.log(`${colors.dim}${msg.content.substring(0, 200)}${colors.reset}`);

     if (msg.content.toLowerCase().includes('finished') ||
       msg.content.toLowerCase().includes('done') ||
       msg.content.toLowerCase().includes('completed')) {

      const syntax = await checkSyntax(targetFile);
      if (syntax.valid) {
       taskComplete = true;
      } else {
       workerMessages.push({
        role: "user",
        content: `Syntax error! Fix it: ${syntax.error}`
       });
      }
     } else {
      workerMessages.push({
       role: "user",
       content: "Continue using tools. If finished, use the finish() tool."
      });
     }
    }
   }

   if (failureCount >= AI_PROVIDER.maxFailures) {
    console.log(`\n${colors.red}⚠ Too many errors (${failureCount}). Switching to fallback...${colors.reset}`);
    currentModel = AI_PROVIDER.models.fallback;
    failureCount = 0;

    workerMessages.push({
     role: "system",
     content: "Previous model was not handling the task well. Switched to a more advanced model. Try differently."
    });
   }

  } catch (e) {
   log.error(`API error: ${e.message}`);
   failureCount++;

   if (failureCount >= AI_PROVIDER.maxFailures && currentModel !== AI_PROVIDER.models.fallback) {
    currentModel = AI_PROVIDER.models.fallback;
    failureCount = 0;
   }
  }
 }

 if (iterations >= AI_PROVIDER.maxIterations && !taskComplete) {
  log.warn(`Reached iteration limit (${AI_PROVIDER.maxIterations})`);
 }

 // SUMMARY
 printSummaryHeader();

 const stat = await fs.stat(targetFile).catch(() => ({ size: 0 }));
 log.info(`File: ${path.basename(targetFile)} (${stat.size} bytes)`);
 log.info(`Iterations: ${iterations}`);
 log.info(`FileEditor Statistics: ${JSON.stringify(FileEditor.stats().locks)}`);

 const finalCheck = await checkSyntax(targetFile);
 if (finalCheck.valid) {
  console.log(`\n${colors.green}${colors.bold}✓ Changes applied successfully${colors.reset}`);
 } else {
  console.log(`\n${colors.yellow}${colors.bold}⚠ Changes applied, but syntax error occurred${colors.reset}`);
  console.log(`${colors.dim}To restore original, use latest backup: ${targetFile}.*.bak${colors.reset}`);
 }

 FileEditor.cleanup();
 printSummaryFooter();
};

// Run
main().catch(e => {
 log.error(`FATAL: ${e.message}`);
 console.error(e.stack);
 process.exit(1);
});