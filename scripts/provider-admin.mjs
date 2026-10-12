import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readOpenAIUsage, validateOpenAIDailyLimit, OPENAI_DEFAULT_JUDGE_DAILY_LIMIT } from '../app/agent-service.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCK_SUFFIXES = ['.lock', '.interaction.lock'];
const LEDGER_NAMES = ['openai-usage.json', 'openai-judge-usage.json'];

function savedLocks(directory, suffixes = LOCK_SUFFIXES) {
  return LEDGER_NAMES.flatMap(name => suffixes.filter(suffix => regularFile(resolve(directory, `${name}${suffix}`), 1024))
    .map(suffix => `${name}${suffix}`));
}

function stateDirectory(directory) {
  const requested = resolve(directory);
  let info;
  try { info = lstatSync(requested); }
  catch (error) { if (error.code === 'ENOENT') return null; throw Error('The private state directory could not be inspected.'); }
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('The private state path must be a real directory, not a symlink.');
  return realpathSync(requested);
}

function regularFile(path, maximumBytes) {
  let descriptor;
  try {
    try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || info.size > maximumBytes) throw Error();
    return true;
  } catch { throw Error('An operator state file is unsafe, oversized or unreadable. No recovery was performed.'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function atomicPrivateJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(data)}\n`);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
  }
}

export function providerStatus({ directory = resolve(ROOT, '.cache'), dailyLimit = process.env.REELBALANCE_OPENAI_DAILY_LIMIT,
  judgeDailyLimit = process.env.REELBALANCE_OPENAI_JUDGE_DAILY_LIMIT ?? OPENAI_DEFAULT_JUDGE_DAILY_LIMIT,
  now = Date.now } = {}) {
  const limit = validateOpenAIDailyLimit(dailyLimit);
  const judgeLimit = validateOpenAIDailyLimit(judgeDailyLimit);
  const resolved = stateDirectory(directory);
  const path = resolved && resolve(resolved, 'openai-usage.json');
  const usage = path ? readOpenAIUsage(path) : null;
  const judgeUsage = resolved ? readOpenAIUsage(resolve(resolved, 'openai-judge-usage.json')) : null;
  const locks = resolved ? savedLocks(resolved, [...LOCK_SUFFIXES, '.admin.lock']) : [];
  const day = new Date(now()).toISOString().slice(0, 10);
  const requestsToday = usage?.day === day ? usage.attempts : 0;
  const remainingRequests = Math.max(0, limit - requestsToday);
  const judgeRequestsToday = judgeUsage?.day === day ? judgeUsage.attempts : 0;
  const judgeRemainingRequests = Math.max(0, judgeLimit - judgeRequestsToday);
  const paused = Boolean(usage?.paused || judgeUsage?.paused);
  return {
    provider: 'openai', providerAvailability: 'not_checked', networkRequests: 0,
    dailyLimit: limit, day, requestsToday, remainingRequests,
    ledger: usage, locks,
    ledgerStatus: paused ? 'paused' : locks.length ? 'locked' : !remainingRequests ? 'budget_exhausted' : 'available',
    judge: { dailyLimit: judgeLimit, day, requestsToday: judgeRequestsToday, remainingRequests: judgeRemainingRequests,
      ledger: judgeUsage, ledgerStatus: paused ? 'paused' : locks.length ? 'locked' : !judgeRemainingRequests ? 'budget_exhausted' : 'available' },
  };
}

export function recoverOpenAI({ directory = resolve(ROOT, '.cache'), confirmAppStopped = false,
  reviewedReason, clearStaleLocks = false, now = Date.now } = {}) {
  if (confirmAppStopped !== true) throw Error('Stop every ReelBalance app process, then acknowledge it with --confirm-app-stopped.');
  if (typeof reviewedReason !== 'string' || reviewedReason.trim().length < 10 ||
      reviewedReason.length > 500 || /[\r\n\0]/.test(reviewedReason)) {
    throw Error('Supply --reviewed-reason with 10–500 characters describing the reviewed failure and correction.');
  }
  const resolved = stateDirectory(directory);
  if (!resolved) throw Error('The private state directory does not exist. No recovery was performed.');
  const path = resolve(resolved, 'openai-usage.json');
  const judgePath = resolve(resolved, 'openai-judge-usage.json');
  const auditPath = resolve(resolved, 'openai-recovery.json');
  const adminPath = `${path}.admin.lock`;
  if (savedLocks(resolved, ['.admin.lock']).length) throw Error('Another operator recovery is active or unfinished. No recovery was performed.');
  const existingLocks = savedLocks(resolved);
  const usage = readOpenAIUsage(path);
  const judgeUsage = readOpenAIUsage(judgePath);
  if (existingLocks.length && clearStaleLocks !== true) {
    throw Error('OpenAI locks exist. Review them with the app stopped, then explicitly add --clear-stale-locks.');
  }
  if (!usage?.paused && !judgeUsage?.paused && !existingLocks.length) return { recovered: false, networkRequests: 0, ledger: usage, judgeLedger: judgeUsage, clearedLocks: [] };
  regularFile(auditPath, 4096); // An existing symlink must never be replaced silently.
  let administrationLock;
  let recoveryCompleted = false;
  try {
    try { administrationLock = openSync(adminPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { throw Error('Another operator recovery is active or unfinished. No recovery was performed.'); }
    // Re-read after acquiring our lock. The stopped acknowledgement is required because
    // old app processes can retain an in-memory pause or an already-started request.
    const current = readOpenAIUsage(path);
    const currentJudge = readOpenAIUsage(judgePath);
    const currentLocks = savedLocks(resolved);
    if (JSON.stringify(current) !== JSON.stringify(usage) || JSON.stringify(currentJudge) !== JSON.stringify(judgeUsage) ||
        JSON.stringify(currentLocks) !== JSON.stringify(existingLocks)) {
      throw Error('OpenAI state changed during review. Stop all app processes and inspect it again.');
    }
    const restored = usage ? { ...usage } : null;
    if (restored) delete restored.paused;
    const restoredJudge = judgeUsage ? { ...judgeUsage } : null;
    if (restoredJudge) delete restoredJudge.paused;
    const record = {
      schemaVersion: 1, reviewedAt: new Date(now()).toISOString(), reviewedReason: reviewedReason.trim(),
      appStoppedAcknowledged: true, day: usage?.day ?? null, attempts: usage?.attempts ?? null,
      previousPause: usage?.paused ?? null, clearedLocks: currentLocks,
      judge: { day: judgeUsage?.day ?? null, attempts: judgeUsage?.attempts ?? null, previousPause: judgeUsage?.paused ?? null },
    };
    atomicPrivateJson(auditPath, record); // Save the review before permitting requests again.
    if (usage?.paused) atomicPrivateJson(path, restored);
    if (judgeUsage?.paused) atomicPrivateJson(judgePath, restoredJudge);
    for (const name of currentLocks) unlinkSync(resolve(resolved, name));
    recoveryCompleted = true;
    return { recovered: true, networkRequests: 0, ledger: restored, judgeLedger: restoredJudge, clearedLocks: record.clearedLocks };
  } finally {
    if (administrationLock !== undefined) {
      closeSync(administrationLock);
      // Partial recovery must keep both pools blocked for operator review.
      if (recoveryCompleted) unlinkSync(adminPath);
    }
  }
}

export function runProviderAdmin(argv) {
  const [command, ...arguments_] = argv;
  if (!['status', 'recover-openai'].includes(command)) throw Error('Use provider-admin.mjs status or recover-openai.');
  const options = {};
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (seen.has(argument)) throw Error('Repeated operator options are not accepted.');
    seen.add(argument);
    if (argument === '--state-dir' || argument === '--reviewed-reason') {
      const value = arguments_[++index];
      if (!value || value.startsWith('--')) throw Error(`A value is required for ${argument}.`);
      if (argument === '--reviewed-reason' && command !== 'recover-openai') throw Error('Recovery options are not accepted by read-only status.');
      options[argument === '--state-dir' ? 'directory' : 'reviewedReason'] = value;
    } else if (command === 'recover-openai' && argument === '--confirm-app-stopped') options.confirmAppStopped = true;
    else if (command === 'recover-openai' && argument === '--clear-stale-locks') options.clearStaleLocks = true;
    else throw Error('Unknown operator option.');
  }
  return command === 'status' ? providerStatus(options) : recoverOpenAI(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runProviderAdmin(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
