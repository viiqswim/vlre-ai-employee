#!/usr/bin/env zx

import { $, cd } from 'zx'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { validateFallbackConfig } from './src/startup-checks.ts'
import { startProxyHealthMonitor } from './src/proxy-health.ts'

// Set working directory to script's own directory (bash equivalent: cd "$SCRIPT_DIR")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
cd(__dirname)

// Read config from environment (Bun auto-loads .env, so process.env has all values)
const BOT_NAME = process.env['BOT_NAME'] || 'Papi Chulo'
// Use || not ?? — handles empty string (WEBHOOK_PORT= in .env gives empty string, not undefined)
const WEBHOOK_PORT = process.env['WEBHOOK_PORT'] || '48901'

console.log(`Starting ${BOT_NAME}...`)

// Check .env exists — hard exit if missing
if (!fs.existsSync('.env')) {
  console.error('ERROR: .env file not found. Copy .env.example and fill in your values.')
  process.exit(1)
}

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

// Port check helper — replaces bash /dev/tcp built-in
function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

// Claude proxy — conditional on CLAUDE_MODE=proxy
// Proxy is intentionally kept alive across service restarts — kill explicitly with:
//   kill $(lsof -t -i :3456)
if (process.env['CLAUDE_MODE'] === 'proxy') {
  const PROXY_HOST = '127.0.0.1'
  const PROXY_PORT = 3456

  if (await isPortOpen(PROXY_HOST, PROXY_PORT)) {
    console.log(`Claude proxy already running on :${PROXY_PORT} ✓`)
  } else {
    console.log('Starting Claude Max API proxy...')

    // claude-max-api is installed under nodejs 20.19.0 — must specify version explicitly
    // because this project's .tool-versions uses nodejs 22.21.1 (required for OpenClaw)
    const proxyProcess = $({
      env: { ...process.env, ASDF_NODEJS_VERSION: '20.19.0' },
      nothrow: true,
      quiet: true,
    })`claude-max-api`

    // Redirect proxy output to log file (equivalent to: &>/tmp/papi-chulo-proxy.log)
    const logStream = fs.createWriteStream('/tmp/papi-chulo-proxy.log')
    proxyProcess.stdout.pipe(logStream)
    proxyProcess.stderr.pipe(logStream)

    console.log(`Claude proxy PID: ${proxyProcess.child?.pid ?? 'unknown'}`)

    // Wait for proxy to be ready (up to 15s, 0.5s polling interval)
    const PROXY_TIMEOUT = 15
    let elapsed = 0
    console.log(`Waiting for Claude proxy on :${PROXY_PORT}...`)
    while (elapsed < PROXY_TIMEOUT) {
      if (await isPortOpen(PROXY_HOST, PROXY_PORT)) {
        console.log(`Claude proxy ready on :${PROXY_PORT} (${elapsed}s)`)
        break
      }
      await new Promise<void>((r) => setTimeout(r, 500))
      elapsed++
    }

    if (elapsed >= PROXY_TIMEOUT) {
      console.error(`ERROR: Claude proxy did not start within ${PROXY_TIMEOUT}s`)
      console.error('Check logs: cat /tmp/papi-chulo-proxy.log')
      process.exit(1)
    }
  }
}

if (process.env['CLAUDE_MODE'] === 'proxy') {
  startProxyHealthMonitor('127.0.0.1', 3456)
}

// Validate Claude fallback configuration
validateFallbackConfig()

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
