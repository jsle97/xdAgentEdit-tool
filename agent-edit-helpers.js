// agent-edit-helpers.js
// CLI helpers, colors, logging, diff utilities

import { exec } from 'child_process';

// ==================== TERMINAL COLORS ====================
export const colors = {
 reset: '\x1b[0m',
 bold: '\x1b[1m',
 dim: '\x1b[2m',
 red: '\x1b[31m',
 green: '\x1b[32m',
 yellow: '\x1b[33m',
 blue: '\x1b[34m',
 magenta: '\x1b[35m',
 cyan: '\x1b[36m'
};

// ==================== LOGGING UTILITIES ====================
export const log = {
 info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
 success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
 error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
 warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
 step: (msg) => console.log(`${colors.magenta}◆${colors.reset} ${msg}`),
 diff: (type, msg) => console.log(type === '+'
  ? `${colors.green}+ ${msg}${colors.reset}`
  : `${colors.red}- ${msg}${colors.reset}`)
};

// ==================== DIFF VISUALIZATION ====================
export const showDiff = (oldContent, newContent, contextLines = 3) => {
 const oldLines = oldContent.split('\n');
 const newLines = newContent.split('\n');

 let startDiff = 0;
 while (startDiff < oldLines.length && startDiff < newLines.length && oldLines[startDiff] === newLines[startDiff]) {
  startDiff++;
 }

 let endOld = oldLines.length - 1;
 let endNew = newLines.length - 1;
 while (endOld >= 0 && endNew >= 0 && oldLines[endOld] === newLines[endNew]) {
  endOld--;
  endNew--;
 }

 if (startDiff > endOld && startDiff > endNew) {
  log.info("No changes");
  return;
 }

 console.log(`\n${colors.bold}━━━ DIFF ━━━${colors.reset}`);

 if (startDiff <= endOld) {
  for (let i = startDiff; i <= endOld; i++) {
   log.diff('-', `${i + 1}: ${oldLines[i]}`);
  }
 }

 if (startDiff <= endNew) {
  for (let i = startDiff; i <= endNew; i++) {
   log.diff('+', `${i + 1}: ${newLines[i]}`);
  }
 }

 console.log(`${colors.bold}━━━━━━━━━━━━${colors.reset}\n`);
};

// ==================== SYNTAX CHECKING ====================
export const checkSyntax = (filePath) => {
 return new Promise((resolve) => {
  exec(`node --check "${filePath}"`, (error, stdout, stderr) => {
   if (error) {
    log.error(`Syntax error: ${stderr.split('\n')[0]}`);
    resolve({ valid: false, error: stderr });
   } else {
    log.success("Syntax is correct");
    resolve({ valid: true });
   }
  });
 });
};

// ==================== CLI UTILITIES ====================
export const printUsage = () => {
 console.log(`\n${colors.bold}xdedit-pro${colors.reset} - Advanced AI code editor\n`);
 console.log(`  Usage: node agent-edit.js <file>`);
 console.log(`  Example: node agent-edit.js server.js\n`);
 console.log(`  After launch, paste instructions and type ${colors.cyan}/exec${colors.reset}\n`);
};

export const printInputHeader = (fileName) => {
 console.log(`\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
 console.log(`${colors.dim}Paste instructions/diffs for file: ${fileName}${colors.reset}`);
 console.log(`${colors.dim}Type /exec to start, or /exit to cancel${colors.reset}`);
 console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
};

export const printSummaryHeader = () => {
 console.log(`\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
 console.log(`${colors.bold}  SUMMARY${colors.reset}`);
 console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
};

export const printSummaryFooter = () => {
 console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
};

// ==================== EXEC WRAPPER ====================
export const execCommand = exec;