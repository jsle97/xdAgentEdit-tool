// agent-edit-editor-fnc.js
// Core file manipulation functions for FileEditor

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ==================== CONFIGURATION ====================
export const CONFIG = {
 MAX_FILE_SIZE: 10 * 1024 * 1024,
 DEFAULT_ENCODING: 'utf8',
 TEMP_PREFIX: '.tmp',
 RENAME_RETRIES: 4,
 RENAME_RETRY_DELAY_MS: 100,
 MAX_CONCURRENT_LOCKS: 100,
 LOCK_TIMEOUT_MS: 5000,
 ALLOWED_ROOT: process.cwd(),
 REGEX_MAX_LENGTH: 960,
 BATCH_CONCURRENCY: 5
};

// ==================== INTERNAL STATE ====================
export const fileLocks = new Map();
export const lockStats = { active: 0, maxActive: 0, totalAcquired: 0 };
export const regexCache = new Map();

// ==================== PATH SECURITY ====================
export const resolveSafe = (filePath) => {
 const resolved = path.resolve(CONFIG.ALLOWED_ROOT, filePath);
 const rootWithSep = CONFIG.ALLOWED_ROOT.endsWith(path.sep)
  ? CONFIG.ALLOWED_ROOT
  : CONFIG.ALLOWED_ROOT + path.sep;

 if (!resolved.startsWith(rootWithSep) && resolved !== CONFIG.ALLOWED_ROOT) {
  throw new Error(`Path traversal blocked: ${filePath}`);
 }
 return resolved;
};

// ==================== REGEX UTILITIES ====================
export const safeCreateRegex = (pattern, flags) => {
 if (typeof pattern !== 'string') throw new Error('Pattern must be a string');
 if (pattern.length > CONFIG.REGEX_MAX_LENGTH) {
  throw new Error(`Pattern too long (${pattern.length} > ${CONFIG.REGEX_MAX_LENGTH})`);
 }
 try {
  return new RegExp(pattern, flags);
 } catch (e) {
  throw new Error(`Invalid regex: ${e.message}`);
 }
};

export const getCachedRegex = (pattern, flags) => {
 const key = `${pattern}|${flags}`;
 if (!regexCache.has(key)) {
  regexCache.set(key, safeCreateRegex(pattern, flags));
  if (regexCache.size > 100) {
   const firstKey = regexCache.keys().next().value;
   regexCache.delete(firstKey);
  }
 }
 const cached = regexCache.get(key);
 cached.lastIndex = 0;
 return cached;
};

export const escapeRegExp = (string) => String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ==================== TEXT UTILITIES ====================
export const detectEOL = (content) => {
 const idx = content.indexOf('\n');
 if (idx === -1) return '\n';
 if (idx > 0 && content[idx - 1] === '\r') return '\r\n';
 return '\n';
};

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export const replaceWithCount = (input, regex, replacement) => {
 let count = 0;
 const result = input.replace(regex, (...args) => {
  count++;
  return typeof replacement === 'function' ? replacement(...args) : replacement;
 });
 return { result, count };
};

// ==================== LOCK MANAGEMENT ====================
export const acquireLock = async (filePath) => {
 const absolutePath = path.resolve(filePath);

 if (lockStats.active >= CONFIG.MAX_CONCURRENT_LOCKS) {
  throw new Error(`Lock limit exceeded (${CONFIG.MAX_CONCURRENT_LOCKS})`);
 }

 if (!fileLocks.has(absolutePath)) {
  fileLocks.set(absolutePath, Promise.resolve());
 }

 const currentLock = fileLocks.get(absolutePath);
 let resolveLock;
 const newLock = new Promise((resolve) => { resolveLock = resolve; });
 fileLocks.set(absolutePath, newLock);

 let timeoutId;
 try {
  await new Promise((resolve, reject) => {
   timeoutId = setTimeout(() => reject(new Error(`Lock timeout: ${absolutePath}`)), CONFIG.LOCK_TIMEOUT_MS);
   currentLock.then(() => {
    clearTimeout(timeoutId);
    resolve();
   }, () => {
    clearTimeout(timeoutId);
    resolve();
   });
  });
 } catch (err) {
  resolveLock();
  throw err;
 }

 lockStats.active++;
 lockStats.totalAcquired++;
 lockStats.maxActive = Math.max(lockStats.maxActive, lockStats.active);

 return () => {
  lockStats.active--;
  resolveLock();
  if (fileLocks.get(absolutePath) === newLock) {
   fileLocks.delete(absolutePath);
  }
 };
};

// ==================== ATOMIC FILE OPERATIONS ====================
export const atomicWriteRaw = async (filePath, data, options = {}) => {
 const { makeBackup = false, mode, encoding = CONFIG.DEFAULT_ENCODING, signal } = options;
 const dir = path.dirname(filePath);

 if (signal?.aborted) throw new Error('Operation aborted');

 await fs.mkdir(dir, { recursive: true });

 if (makeBackup) {
  try {
   const stats = await fs.stat(filePath).catch(() => null);
   if (stats?.isFile()) {
    const backupPath = `${filePath}.${Date.now()}.bak`;
    await fs.copyFile(filePath, backupPath);
   }
  } catch (err) {
   console.warn(`[FileEditor] Backup failed for ${filePath}: ${err.message}`);
  }
 }

 const tempFile = path.join(dir, `${CONFIG.TEMP_PREFIX}.${crypto.randomUUID()}`);
 await fs.writeFile(tempFile, data, { encoding });

 if (mode !== undefined) {
  try { await fs.chmod(tempFile, mode); } catch (e) { }
 }

 let lastErr;
 for (let attempt = 0; attempt < CONFIG.RENAME_RETRIES; attempt++) {
  if (signal?.aborted) {
   await fs.unlink(tempFile).catch(() => { });
   throw new Error('Operation aborted during rename');
  }

  try {
   await fs.rename(tempFile, filePath);
   lastErr = null;
   break;
  } catch (error) {
   lastErr = error;
   if (error.code === 'EXDEV') {
    await fs.copyFile(tempFile, filePath);
    await fs.unlink(tempFile);
    lastErr = null;
    break;
   }
   if (attempt < CONFIG.RENAME_RETRIES - 1) {
    await sleep(CONFIG.RENAME_RETRY_DELAY_MS * Math.pow(1.5, attempt));
   }
  }
 }

 if (lastErr) {
  try { await fs.unlink(tempFile); } catch (e) { }
  throw lastErr;
 }
};

export const atomicWrite = async (filePath, data, options = {}) => {
 const release = await acquireLock(filePath);
 try {
  await atomicWriteRaw(filePath, data, options);
 } finally {
  release();
 }
};

// ==================== SAFE FILE READING ====================
export const safeRead = async (filePath, maxSize = CONFIG.MAX_FILE_SIZE, encoding = CONFIG.DEFAULT_ENCODING) => {
 try {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error(`Path is directory: ${filePath}`);
  if (stats.size > maxSize) throw new Error(`File too large (${stats.size}b > ${maxSize}b)`);
  return await fs.readFile(filePath, { encoding });
 } catch (error) {
  if (error.code === 'ENOENT') throw new Error('File does not exist');
  throw error;
 }
};

// ==================== CONCURRENCY UTILITIES ====================
export const withConcurrencyLimit = async (tasks, limit) => {
 const results = [];
 const executing = new Set();

 for (const task of tasks) {
  const p = task().finally(() => executing.delete(p));
  executing.add(p);
  results.push(p);

  if (executing.size >= limit) {
   await Promise.race(executing);
  }
 }

 return Promise.allSettled(results).then(settled =>
  settled.map(r => r.status === 'fulfilled' ? r.value : { status: r.reason?.message || 'Unknown error' })
 );
};

// ==================== OPERATION VALIDATION ====================
export const VALID_OP_TYPES = new Set([
 'replaceText', 'replacePattern', 'append', 'prepend', 'editFragment', 'editLinePart'
]);

export const validateOperation = (op) => {
 if (!op.type || !VALID_OP_TYPES.has(op.type)) {
  throw new Error(`Unknown operation type: ${op.type}`);
 }

 switch (op.type) {
  case 'replaceText':
   if (typeof op.oldStr !== 'string' || typeof op.newStr !== 'string') {
    throw new Error(`replaceText requires string oldStr and newStr`);
   }
   break;
  case 'replacePattern':
   if (typeof op.pattern !== 'string' || typeof op.replacement !== 'string') {
    throw new Error(`replacePattern requires string pattern and replacement`);
   }
   break;
  case 'append':
  case 'prepend':
   if (typeof op.content !== 'string') {
    throw new Error(`${op.type} requires string content`);
   }
   break;
  case 'editFragment':
   if (typeof op.content !== 'string') {
    throw new Error(`editFragment requires string content`);
   }
   if (typeof op.startLine !== 'number' || typeof op.endLine !== 'number') {
    throw new Error(`editFragment requires numeric startLine and endLine`);
   }
   break;
  case 'editLinePart':
   if (typeof op.newFragment !== 'string') {
    throw new Error(`editLinePart requires string newFragment`);
   }
   if (typeof op.line !== 'number' || typeof op.start !== 'number' || typeof op.end !== 'number') {
    throw new Error(`editLinePart requires numeric line, start and end`);
   }
   break;
 }
};