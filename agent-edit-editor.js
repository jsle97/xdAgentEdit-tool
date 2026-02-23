// agent-edit-editor.js
// FileEditor API - high-level file editing interface

import {
 CONFIG,
 fileLocks,
 lockStats,
 regexCache,
 resolveSafe,
 getCachedRegex,
 escapeRegExp,
 detectEOL,
 acquireLock,
 atomicWrite,
 atomicWriteRaw,
 safeRead,
 replaceWithCount,
 withConcurrencyLimit,
 validateOperation,
 safeCreateRegex
} from './agent-edit-editor-fnc.js';

// ==================== FILEEDITOR API ====================
export const FileEditor = {
 stats: () => ({
  locks: {
   active: lockStats.active,
   maxActive: lockStats.maxActive,
   totalAcquired: lockStats.totalAcquired,
   totalFiles: fileLocks.size
  },
  cache: { regexSize: regexCache.size }
 }),

 readFile: async ({ filePath, maxSize, encoding }) => {
  try {
   const safePath = resolveSafe(filePath);
   const content = await safeRead(safePath, maxSize, encoding);
   return { content, success: true };
  } catch (e) {
   return { error: e.message, success: false };
  }
 },

 editFile: async ({ filePath, content, backup = false, mode, signal }) => {
  try {
   const safePath = resolveSafe(filePath);
   await atomicWrite(safePath, content, { makeBackup: backup, mode, signal });
   return { success: true };
  } catch (e) {
   return { error: e.message, success: false };
  }
 },

 viewFragment: async ({ filePath, startLine = 1, endLine, signal }) => {
  try {
   if (signal?.aborted) throw new Error('Operation aborted');
   const safePath = resolveSafe(filePath);
   const data = await safeRead(safePath);
   const eol = detectEOL(data);
   const lines = data.split(eol);
   const end = endLine || lines.length;

   if (startLine < 1 || startLine > lines.length) {
    return { error: 'Invalid start line number' };
   }

   const clampedEnd = Math.min(end, lines.length);
   const fragment = lines.slice(startLine - 1, clampedEnd).join(eol);

   return {
    fragment,
    totalLines: lines.length,
    eolType: eol === '\r\n' ? 'CRLF' : eol === '\r' ? 'CR' : 'LF',
    linesInFragment: clampedEnd - startLine + 1,
    clamped: end !== clampedEnd
   };
  } catch (e) {
   return { error: e.message };
  }
 },

 editFragment: async ({ filePath, startLine, endLine, content, backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'editFragment', filePath, startLine, endLine, content }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok'
   ? { success: true, linesAffected: endLine - startLine + 1 }
   : { error: res?.status || 'Unknown error' };
 },

 replaceText: async ({ filePath, oldStr, newStr, backup = false, options = {}, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'replaceText', filePath, oldStr, newStr, options }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok'
   ? { success: true, replacements: res.replacements }
   : { success: false, message: res?.status || 'Unknown error' };
 },

 replaceVariable: async ({ filePath, oldName, newName, scope = 'global', backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{
    type: 'replaceText',
    filePath,
    oldStr: oldName,
    newStr: newName,
    options: { wordBoundary: true, caseInsensitive: false, scope }
   }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok'
   ? { success: true, replacements: res.replacements }
   : { success: false, message: res?.status || 'Unknown error' };
 },

 replacePattern: async ({ filePath, pattern, replacement, flags = 'g', backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'replacePattern', filePath, pattern, replacement, flags }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok'
   ? { success: true, replacements: res.replacements }
   : { success: false, message: res?.status || 'Unknown error' };
 },

 append: async ({ filePath, content, addNewLine = true, backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'append', filePath, content, addNewLine }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok' ? { success: true } : { error: res?.status || 'Unknown error' };
 },

 prepend: async ({ filePath, content, addNewLine = true, backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'prepend', filePath, content, addNewLine }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok' ? { success: true } : { error: res?.status || 'Unknown error' };
 },

 editLinePart: async ({ filePath, line, start, end, newFragment, backup = false, signal }) => {
  const result = await FileEditor.batchEdit({
   operations: [{ type: 'editLinePart', filePath, line, start, end, newFragment }],
   backup,
   signal
  });
  const res = result.results?.[0];
  return res?.status === 'ok' ? { success: true } : { error: res?.status || 'Unknown error' };
 },

 search: async ({ filePath, query, regex = false, options = {}, signal }) => {
  try {
   if (signal?.aborted) throw new Error('Operation aborted');
   const safePath = resolveSafe(filePath);
   const { caseInsensitive = false, context = 0, limit = Infinity, offset = 0 } = options;
   const data = await safeRead(safePath);
   const lines = data.split(detectEOL(data));
   const results = [];
   let matcher;

   if (regex) {
    const flags = caseInsensitive ? 'i' : '';
    matcher = safeCreateRegex(query, flags);
   } else {
    const q = caseInsensitive ? String(query).toLowerCase() : String(query);
    matcher = { test: (line) => (caseInsensitive ? line.toLowerCase().includes(q) : line.includes(q)) };
   }

   let found = 0;
   for (let idx = 0; idx < lines.length && results.length < limit; idx++) {
    if (signal?.aborted) break;
    const content = lines[idx];

    if (matcher.test(content)) {
     found++;
     if (found <= offset) continue;

     const contextLines = [];
     if (context > 0) {
      const start = Math.max(0, idx - context);
      const end = Math.min(lines.length - 1, idx + context);
      for (let i = start; i <= end; i++) {
       contextLines.push({ line: i + 1, content: lines[i] });
      }
     }

     results.push({
      line: idx + 1,
      content: content.trim(),
      context: contextLines,
      matchIndex: found
     });
    }
   }

   return { results, totalFound: found, hasMore: found > offset + results.length };
  } catch (e) {
   return { error: e.message };
  }
 },

 batchEdit: async ({ operations, backup = false, signal }) => {
  if (!Array.isArray(operations)) return { error: 'Operations must be an array' };
  if (operations.length === 0) return { results: [] };
  if (signal?.aborted) return { error: 'Batch operation aborted', results: [] };

  const filesMap = new Map();
  for (const op of operations) {
   if (!op.filePath) continue;
   const safePath = resolveSafe(op.filePath);
   if (!filesMap.has(safePath)) filesMap.set(safePath, []);
   filesMap.get(safePath).push({ ...op, filePath: safePath });
  }

  const processFile = async (filePath, ops) => {
   const release = await acquireLock(filePath);
   try {
    if (signal?.aborted) return { file: filePath, status: 'Aborted' };

    let content = '';
    let exists = true;
    try {
     content = await safeRead(filePath);
    } catch (e) {
     if (e.message === 'File does not exist') {
      exists = false;
      const canCreate = ops.some(op => ['append', 'prepend'].includes(op.type));
      if (!canCreate) return { file: filePath, status: 'File does not exist' };
     } else {
      throw e;
     }
    }

    const eol = detectEOL(content);
    let modified = false;
    let totalReplacements = 0;

    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
     const op = ops[opIdx];
     if (signal?.aborted) break;

     try {
      validateOperation(op);
     } catch (validationError) {
      console.error(`[Batch] Op #${opIdx} (${op.type}) skipped: ${validationError.message}`);
      continue;
     }

     switch (op.type) {
      case 'replaceText': {
       const isGlobal = op.options?.scope !== 'first';
       const flags = (isGlobal ? 'g' : '') + (op.options?.caseInsensitive ? 'i' : '');
       const rawPattern = escapeRegExp(op.oldStr);
       const pattern = op.options?.wordBoundary ? `\\b${rawPattern}\\b` : rawPattern;
       const regex = getCachedRegex(pattern, flags);
       const safeReplacement = String(op.newStr).replace(/\$/g, '$$$$');
       const { result, count } = replaceWithCount(content, regex, safeReplacement);
       if (count > 0) {
        content = result;
        modified = true;
        totalReplacements += count;
       }
       break;
      }

      case 'replacePattern': {
       const regex = getCachedRegex(op.pattern, op.flags || 'g');
       const { result, count } = replaceWithCount(content, regex, op.replacement);
       if (count > 0) {
        content = result;
        modified = true;
        totalReplacements += count;
       }
       break;
      }

      case 'append': {
       const addNewLine = op.addNewLine !== false;
       const prefix = (content.length > 0 && !content.endsWith('\n') && addNewLine) ? eol : '';
       content = content + prefix + String(op.content);
       modified = true;
       break;
      }

      case 'prepend': {
       const addNewLine = op.addNewLine !== false;
       const suffix = addNewLine ? eol : '';
       content = String(op.content) + suffix + content;
       modified = true;
       break;
      }

      case 'editFragment': {
       const lines = content.split(eol);
       const { startLine, endLine } = op;
       if (startLine >= 1 && endLine <= lines.length && startLine <= endLine) {
        const prefix = lines.slice(0, startLine - 1);
        const suffix = lines.slice(endLine);
        const newFrag = String(op.content).split(/\r?\n/);
        content = [...prefix, ...newFrag, ...suffix].join(eol);
        modified = true;
       } else {
        console.warn(`[Batch] Op #${opIdx} editFragment: range ${startLine}-${endLine} out of bounds (file has ${lines.length} lines)`);
       }
       break;
      }

      case 'editLinePart': {
       const lines = content.split(eol);
       const lineIdx = op.line - 1;
       if (lineIdx >= 0 && lineIdx < lines.length) {
        const currentLine = lines[lineIdx];
        const start = Math.max(0, op.start);
        const end = Math.min(currentLine.length, op.end);
        if (start <= end) {
         lines[lineIdx] = currentLine.substring(0, start) + String(op.newFragment) + currentLine.substring(end);
         content = lines.join(eol);
         modified = true;
        } else {
         console.warn(`[Batch] Op #${opIdx} editLinePart: char range ${op.start}-${op.end} invalid on line ${op.line} (length ${currentLine.length})`);
        }
       } else {
        console.warn(`[Batch] Op #${opIdx} editLinePart: line ${op.line} out of bounds (file has ${lines.length} lines)`);
       }
       break;
      }
     }
    }

    if (modified || (!exists && ops.some(op => ['append', 'prepend'].includes(op.type)))) {
     await atomicWriteRaw(filePath, content, { makeBackup: backup, signal });
     const opTypes = [...new Set(ops.map(o => o.type))];
     return {
      file: filePath,
      status: 'ok',
      replacements: totalReplacements,
      created: !exists,
      operationTypes: opTypes
     };
    }

    return { file: filePath, status: 'no_changes' };
   } catch (err) {
    return { file: filePath, status: err.message };
   } finally {
    release();
   }
  };

  const tasks = [...filesMap.entries()].map(([filePath, ops]) =>
   () => processFile(filePath, ops)
  );

  const settledResults = await withConcurrencyLimit(tasks, CONFIG.BATCH_CONCURRENCY);
  return { results: settledResults };
 },

 cleanup: () => {
  if (lockStats.active > 0) {
   console.warn(`[FileEditor] Cleanup called with ${lockStats.active} active locks`);
  } else {
   fileLocks.clear();
  }
  regexCache.clear();
  lockStats.maxActive = 0;
  lockStats.totalAcquired = 0;
 }
};