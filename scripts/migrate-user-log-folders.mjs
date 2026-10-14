#!/usr/bin/env node
/**
 * One-time migration: per-user log folders were named by login, and a POS login is the PIN
 * (logs/0009/). They are now named by user id (logs/user_4t5g6rqi…/). This moves each
 * login folder into its user's folder; a folder matching no user (failed logins with a
 * wrong PIN, test runs) goes into logs/_unknown. Day files of both are appended together.
 *
 * Usage (repo root, SurrealDB on 127.0.0.1:8000, credentials from ./.env):
 *   node scripts/migrate-user-log-folders.mjs          # dry run: prints what would move
 *   node scripts/migrate-user-log-folders.mjs --apply  # moves the folders
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sanitizeUserKey, UNKNOWN_USER } = require('../shared/user-file-logger.js')

const apply = process.argv.includes('--apply')
const root = path.resolve(import.meta.dirname, '..')

// ./.env, without overriding what the shell already set.
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}

const logDir = path.resolve(process.env.USER_LOG_DIR_HOST || path.join(root, 'logs'))

// Deleted users too: their old logs still belong to them.
const response = await fetch(`${process.env.SURREAL_HTTP_URL || 'http://127.0.0.1:8000'}/sql`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Surreal-NS': process.env.SURREAL_NS || 'posr',
    'Surreal-DB': process.env.SURREAL_DB || 'posr',
    Authorization: `Basic ${Buffer.from(`${process.env.SURREAL_USER}:${process.env.SURREAL_PASS}`).toString('base64')}`,
  },
  body: 'SELECT id, login FROM user;',
})
const [result] = await response.json()
if (!response.ok || result?.status !== 'OK') {
  throw new Error(`User lookup failed: ${JSON.stringify(result ?? response.status)}`)
}
const users = result.result
const idByLogin = new Map()
for (const user of users ?? []) {
  if (user.login != null && String(user.login).trim()) {
    idByLogin.set(String(user.login).trim(), String(user.id))
  }
}

/** A folder whose login no longer exists (PIN changed): the one user id its lines name. */
function userIdFromLines(dir) {
  const ids = new Set()
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.log'))) {
    for (const match of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/\bactor_id=(user:[a-zA-Z0-9_]+)/g)) {
      ids.add(match[1])
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined
}

const isUserIdFolder =(name) => name === UNKNOWN_USER || name.startsWith('user_')

/** Appends day logs, merges last-devices.json (most recent first), moves anything else. */
function mergeInto(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const file of fs.readdirSync(source)) {
    const from = path.join(source, file)
    const to = path.join(target, file)
    if (!fs.existsSync(to)) {
      fs.renameSync(from, to)
    } else if (file === 'last-devices.json') {
      const read = (p) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      const byKey = new Map()
      for (const device of [...read(to), ...read(from)]) {
        const known = byKey.get(device?.key)
        if (device?.key && (!known || String(device.lastSeen) > String(known.lastSeen))) {
          byKey.set(device.key, device)
        }
      }
      const merged = [...byKey.values()].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0, 20)
      fs.writeFileSync(to, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      fs.rmSync(from)
    } else {
      fs.appendFileSync(to, fs.readFileSync(from))
      fs.rmSync(from)
    }
  }
  fs.rmdirSync(source)
}

let toUsers = 0
let toUnknown = 0
for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || isUserIdFolder(entry.name)) continue
  const userId = idByLogin.get(entry.name) ?? userIdFromLines(path.join(logDir, entry.name))
  const targetName = userId ? sanitizeUserKey(userId) : UNKNOWN_USER
  if (userId) toUsers += 1
  else toUnknown += 1
  // Never print the folder name itself: it is a PIN.
  console.log(`${apply ? 'move' : 'would move'} a ${entry.name.length}-character login folder -> ${targetName}`)
  if (apply) {
    mergeInto(path.join(logDir, entry.name), path.join(logDir, targetName))
  }
}

console.log(`${toUsers} folder(s) to user ids, ${toUnknown} to ${UNKNOWN_USER}${apply ? '' : ' (dry run, add --apply)'}`)
