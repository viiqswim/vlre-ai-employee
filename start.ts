#!/usr/bin/env zx

import { $, cd } from 'zx'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { validateOpenRouterConfig } from './src/startup-checks.ts'

// Set working directory to script's own directory (bash equivalent: cd "$SCRIPT_DIR")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
cd(__dirname)

// Check .env exists — hard exit if missing
if (!fs.existsSync('.env')) {
  console.error('ERROR: .env file not found. Copy .env.example and fill in your values.')
  process.exit(1)
}

// Load .env into process.env (start.ts runs under zx/Node — it does NOT auto-load .env like Bun does)
// This must happen before reading any env vars below.
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
  if (key && !(key in process.env)) process.env[key] = val
}

// Read config from environment
const BOT_NAME = process.env['BOT_NAME'] || 'Papi Chulo'
// Use || not ?? — handles empty string (WEBHOOK_PORT= in .env gives empty string, not undefined)
const WEBHOOK_PORT = process.env['WEBHOOK_PORT'] || '48901'

console.log(`Starting ${BOT_NAME}...`)

// OpenClaw gateway health check — WARN ONLY, non-fatal (equivalent to: curl -sf ... &>/dev/null)
try {
  const health = await fetch('http://127.0.0.1:18789/health')
  if (!health.ok) throw new Error('not ok')
} catch {
  console.log('⚠️  WARNING: OpenClaw gateway not running. Start with: openclaw gateway start')
}

// Tailscale Funnel — conditional on tailscale being installed
const hasTailscale = (await $({ nothrow: true, quiet: true })`which tailscale`).ok
if (hasTailscale) {
  console.log(`Starting Tailscale Funnel on port ${WEBHOOK_PORT}...`)
  const funnelResult = await $({ nothrow: true, quiet: true })`tailscale funnel --bg ${WEBHOOK_PORT}`

  if (!funnelResult.ok) {
    // stderr has the error reason (equivalent to: FUNNEL_OUTPUT=$(tailscale funnel --bg ... 2>&1))
    const reason = funnelResult.stderr.trim()
    console.log('')
    console.log('⚠️  WARNING: Tailscale Funnel failed to start!')
    console.log(`   Reason: ${reason}`)
    console.log(`   Hostfully webhooks will NOT reach ${BOT_NAME}.`)
    console.log(`   To fix: visit https://login.tailscale.com and enable Funnel,`)
    console.log(`   then run: tailscale funnel --bg ${WEBHOOK_PORT}`)
    console.log('')
  } else {
    // Extract public URL from funnel status (equivalent to: tailscale funnel status | grep -o 'https://...')
    const statusResult = await $({ nothrow: true, quiet: true })`tailscale funnel status`
    const funnelUrl = statusResult.stdout.match(/https:\/\/[^\s]*/)?.[0]?.replace(/\/$/, '') ?? ''

    if (funnelUrl) {
      process.env['WEBHOOK_PUBLIC_URL'] = funnelUrl
      console.log(`Funnel running: ${funnelUrl}`)
      console.log(`✅ Funnel active — ${funnelUrl} → localhost:${WEBHOOK_PORT}`)
    } else {
      console.log('Funnel started (could not determine public URL)')
    }
  }
}

validateOpenRouterConfig()

const { createHostfullyClient } = await import('./skills/hostfully-client/client.ts')
const hostfullyClient = createHostfullyClient()
try {
  console.log('Validating Hostfully API key...')
  await hostfullyClient.validateApiKey()
  console.log('Hostfully API key ✓')
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// Start Papi Chulo main process (foreground — blocks until Ctrl+C)
const SERVICE_LOG = '/tmp/papi-chulo.log'
console.log(`Starting ${BOT_NAME} main process...`)
console.log(`Logs also written to: ${SERVICE_LOG}`)
const serviceLogStream = fs.createWriteStream(SERVICE_LOG, { flags: 'w' })
await new Promise<void>((resolve, reject) => {
  const child = spawn('bun', ['run', 'src/index.ts'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })
  child.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(chunk); serviceLogStream.write(chunk); })
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk); serviceLogStream.write(chunk); })
  child.on('error', reject)
  child.on('exit', (code) => {
    serviceLogStream.end()
    if (code !== 0 && code !== null) reject(new Error(`${BOT_NAME} exited with code ${code}`))
    else resolve()
  })
})
