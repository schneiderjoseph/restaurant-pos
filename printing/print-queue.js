'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Persistent retry queue for prints that could not reach their printer.
 *
 * A job is one printer + one payload (+ the copies still owed). Jobs are kept per printer in
 * arrival order: a printer that is still down blocks only its own jobs, and once it answers the
 * backlog prints oldest first. New prints for a printer that has a backlog are queued behind it
 * so tickets never come out of order. The queue is saved to disk so a restart does not lose it.
 */

const QUEUE_FILE = process.env.PRINT_QUEUE_FILE || path.join(__dirname, 'data', 'print-queue.json');
const RETRY_INTERVAL_MS = Math.max(2000, Number(process.env.PRINT_QUEUE_RETRY_MS) || 10000);
// Past this age a ticket is no use to the kitchen any more; drop it instead of printing it hours late.
const MAX_AGE_MS = Math.max(60000, Number(process.env.PRINT_QUEUE_MAX_AGE_MS) || 6 * 60 * 60 * 1000);

let jobs = [];
let printFn = null;
let timer = null;
let flushing = null;

function printerKey(printer) {
  const p = printer || {};
  if (p.type === 'network') return `network:${p.ip}:${p.port || 9100}`;
  if (p.type === 'usb') return `usb:${p.vid || ''}:${p.pid || ''}`;
  if (p.type === 'serial') return `serial:${p.path || p.port || ''}`;
  if (p.type === 'bluetooth') return `bluetooth:${p.address || ''}`;
  return `${p.type || 'unknown'}:${JSON.stringify(p)}`;
}

function load() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    jobs = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('[print-queue] could not read queue file:', err.message || String(err));
    }
    jobs = [];
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    const tmp = `${QUEUE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(jobs));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    console.error('[print-queue] could not save queue file:', err.message || String(err));
  }
}

function hasPending(printer) {
  const key = printerKey(printer);
  return jobs.some((j) => j.key === key);
}

/**
 * @param {Object} entry - { printer, printType, data, config, copies, error? }
 * @returns {string} job id
 */
function enqueue(entry) {
  const job = {
    id: crypto.randomUUID(),
    key: printerKey(entry.printer),
    printer: entry.printer,
    printType: entry.printType,
    data: entry.data,
    config: entry.config,
    copies: Math.max(1, Number(entry.copies) || 1),
    createdAt: Date.now(),
    attempts: 0,
    lastError: entry.error || null,
  };
  jobs.push(job);
  save();
  console.warn(`[print-queue] queued ${job.printType} for ${job.key} (${jobs.length} pending)`);
  return job.id;
}

async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    const now = Date.now();
    const expired = jobs.filter((j) => now - j.createdAt > MAX_AGE_MS);
    if (expired.length > 0) {
      expired.forEach((j) => console.warn(`[print-queue] dropped expired ${j.printType} for ${j.key}`));
      jobs = jobs.filter((j) => now - j.createdAt <= MAX_AGE_MS);
      save();
    }

    const blocked = new Set();
    // Snapshot: jobs enqueued while flushing wait for the next pass.
    for (const job of jobs.slice()) {
      if (blocked.has(job.key)) continue;
      try {
        while (job.copies > 0) {
          await printFn(job);
          job.copies -= 1;
        }
        jobs = jobs.filter((j) => j.id !== job.id);
        save();
        console.log(`[print-queue] printed queued ${job.printType} for ${job.key} (${jobs.length} pending)`);
      } catch (err) {
        job.attempts += 1;
        job.lastError = err && err.message ? err.message : String(err);
        if (err && err.permanent) {
          console.error(`[print-queue] dropped ${job.printType} for ${job.key}: ${job.lastError}`);
          jobs = jobs.filter((j) => j.id !== job.id);
        } else {
          blocked.add(job.key);
        }
        save();
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

function list() {
  return jobs.map(({ id, key, printType, copies, createdAt, attempts, lastError }) => ({
    id,
    printer: key,
    printType,
    copies,
    createdAt: new Date(createdAt).toISOString(),
    attempts,
    lastError,
  }));
}

function remove(id) {
  const before = jobs.length;
  jobs = jobs.filter((j) => j.id !== id);
  if (jobs.length !== before) save();
  return jobs.length !== before;
}

/**
 * @param {(job: Object) => Promise<void>} fn - prints one copy of a job; rejects when the printer is unreachable
 */
function start(fn) {
  printFn = fn;
  load();
  if (jobs.length > 0) console.log(`[print-queue] ${jobs.length} pending print(s) restored`);
  if (!timer) {
    timer = setInterval(() => {
      if (jobs.length > 0) flush();
    }, RETRY_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

module.exports = { start, enqueue, flush, hasPending, list, remove, printerKey };
