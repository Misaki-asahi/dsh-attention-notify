/**
 * Host half of dsh-attention-notify.
 *
 * The browser half decides when a session needs attention; this half owns the
 * one surface a plugin can actually put above other applications: a small
 * always-on-top window in its own process (`helper/alert-window.ps1`), fed
 * through a JSON file and reached over a local HTTP route the page posts to.
 *
 * Nothing here touches the model, the session log, or the approval decision.
 *
 * @module dsh-attention-notify
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory of this package. */
const here = dirname(fileURLToPath(import.meta.url))
/** Where the helper window and this plugin exchange state. */
const stateDir = join(tmpdir(), 'dsh-attention-notify')
/** The single alert document the helper polls. */
const alertFile = join(stateDir, 'alert.json')
/** Presence of this file asks the helper to exit. */
const stopFile = join(stateDir, 'stop')
/** Largest accepted request body. */
const MAX_BODY_BYTES = 16 * 1024

/** Required service: the local HTTP server the Web client posts to. */
export const inject = ['webServer']

/** Accept only a colour string the helper can parse; anything else is dropped. */
function readTheme(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const pick = (value) =>
    typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/iu.test(value.trim()) ? value.trim() : undefined
  const theme = {}
  for (const name of ['bg', 'text', 'muted', 'border', 'accent']) {
    const value = pick(raw[name])
    if (value !== undefined) theme[name] = value
  }
  return Object.keys(theme).length === 0 ? undefined : theme
}

/** Write a JSON response. */
function respond(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

/**
 * Read a bounded JSON request body.
 * @param request - Node request.
 * @returns the parsed document, or a rejection when the body is unusable.
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

/** Trim one untrusted string field. */
function text(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/**
 * Register the alert route and own the helper window process.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  let helper
  let sequence = 0

  try {
    mkdirSync(stateDir, { recursive: true })
    rmSync(stopFile, { force: true })
    // A jump file can only be left by a build that still had the feature.
    rmSync(join(stateDir, 'jump.json'), { force: true })
  } catch (error) {
    ctx.logger?.warn?.(error)
  }

  /**
   * Publish one alert document; the helper picks it up on its next tick.
   *
   * The document holds the session title and the alert text, which can be
   * sensitive, so it lives only in the user's temporary directory and is
   * overwritten with an empty `visible: false` payload the moment the alert is
   * cleared. Nothing here leaves the machine.
   */
  const publish = (visible, alert) => {
    sequence += 1
    const payload = { seq: sequence, visible, ...(alert ?? {}) }
    try {
      writeFileSync(alertFile, JSON.stringify(payload), 'utf8')
    } catch (error) {
      ctx.logger?.warn?.(error)
    }
  }

  /** Start the helper window once, on the first alert that needs it. */
  const ensureHelper = () => {
    if (helper !== undefined) return
    // The topmost card is a WinForms window driven by Windows PowerShell. On
    // other platforms there is nothing to spawn: the route still answers with
    // `helper: false`, which makes the page fall back to the OS notification.
    if (process.platform !== 'win32') return
    const script = join(here, 'helper', 'alert-window.ps1')
    if (!existsSync(script)) {
      ctx.logger?.warn?.(new Error(`attention-notify: helper script missing at ${script}`))
      return
    }
    try {
      helper = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, alertFile, stopFile, String(process.pid)],
        { stdio: 'ignore', windowsHide: true }
      )
      helper.on('error', (error) => {
        ctx.logger?.warn?.(error)
        helper = undefined
      })
      helper.on('exit', () => {
        helper = undefined
      })
    } catch (error) {
      ctx.logger?.warn?.(error)
      helper = undefined
    }
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: '/attention-notify',
    handler: (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (request.method === 'GET' && pathname === '/attention-notify/ping') {
        respond(response, 200, { ok: true, helper: helper !== undefined })
        return
      }
      if (request.method !== 'POST') {
        respond(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (pathname !== '/attention-notify/notify' && pathname !== '/attention-notify/clear') {
        respond(response, 404, { ok: false, error: 'unknown endpoint' })
        return
      }
      readJson(request).then(
        (body) => {
          if (pathname === '/attention-notify/clear') {
            publish(false)
            respond(response, 200, { ok: true })
            return
          }
          const title = text(body.title, 200)
          const detail = text(body.body, 600)
          if (title === '' && detail === '') {
            respond(response, 400, { ok: false, error: 'empty alert' })
            return
          }
          const kind = body.kind === 'question' || body.kind === 'plan-review' || body.kind === 'done' ? body.kind : 'approval'
          ensureHelper()
          publish(true, {
            title,
            body: detail,
            kind,
            kindLabel: text(body.kindLabel, 80),
            openLabel: text(body.openLabel, 40),
            dismissLabel: text(body.dismissLabel, 40),
            theme: readTheme(body.theme)
          })
          respond(response, 200, { ok: true, helper: helper !== undefined })
        },
        () => respond(response, 400, { ok: false, error: 'invalid body' })
      )
    }
  })

  ctx.effect(() => {
    return () => {
      try {
        disposeRoute()
      } catch (error) {
        ctx.logger?.warn?.(error)
      }
      try {
        writeFileSync(stopFile, '1')
      } catch (error) {
        ctx.logger?.warn?.(error)
      }
      try {
        helper?.kill()
      } catch {
        /* the helper may already be gone */
      }
      helper = undefined
      // Leave no alert text behind once the plugin itself goes away.
      try {
        rmSync(alertFile, { force: true })
      } catch {
        /* the file may already be gone */
      }
    }
  }, 'attention-notify: helper window and route')
}
