/**
 * Headless check of the browser half without React or a browser.
 *
 * The bundle is evaluated against a minimal hooks runtime so detection, the
 * host-window request, the OS-toast fallback, session jump, mute, dismissal,
 * and card rendering are exercised exactly as written.
 *
 * Run with: node tests/render.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

// ---------------------------------------------------------------- fake platform

/** A tiny external store, matching the getSnapshot/subscribe contract React expects. */
function createStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    }
  }
}

const sessionList = createStore({
  phase: 'ready',
  ids: ['s1', 's2'],
  byId: { s1: { id: 's1', title: '夜间重构' }, s2: { id: 's2', title: '接口联调' } }
})
const sessionStatus = createStore(new Map())

const storage = new Map()
const audio = { contexts: 0, oscillators: 0 }
const focusCalls = { count: 0 }

/** Host-route traffic: every POST the page makes to the always-on-top window. */
const nativeCalls = []
let nativeMode = 'ok'

globalThis.fetch = async (url, options) => {
  nativeCalls.push({ url, body: options?.body })
  if (nativeMode === 'fail') throw new Error('host route unavailable')
  if (nativeMode === 'no-helper') return { ok: true, json: async () => ({ ok: true, helper: false }) }
  return { ok: true, json: async () => ({ ok: true, helper: true }) }
}

class FakeAudioContext {
  constructor() {
    audio.contexts += 1
    this.state = 'running'
    this.currentTime = 0
    this.destination = {}
  }
  createOscillator() {
    audio.oscillators += 1
    return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
}

let loaded
const windowStub = {
  __ModuleLoader__: { load: (definition) => (loaded = definition) },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  },
  AudioContext: FakeAudioContext,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  focus: () => {
    focusCalls.count += 1
  }
}
const documentStub = {
  visibilityState: 'visible',
  title: '',
  hasFocus: () => false,
  body: { hasAttribute: () => false },
  documentElement: { style: { setProperty() {} }, setAttribute() {} }
}

const systemNotifications = []
globalThis.Notification = class FakeNotification {
  static permission = 'granted'
  constructor(title, options) {
    this.title = title
    this.options = options
    this.closed = false
    systemNotifications.push(this)
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

// ---------------------------------------------------------------- hooks runtime

let cursor = 0
let effects = []
let dirty = false
const state = []
const refs = []
const subscriptions = new Map()

const ReactStub = {
  createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [
      state[index],
      (next) => {
        const value = typeof next === 'function' ? next(state[index]) : next
        if (Object.is(value, state[index])) return
        state[index] = value
        dirty = true
      }
    ]
  },
  useRef(initial) {
    const index = cursor++
    if (!(index in refs)) refs[index] = { current: initial }
    return refs[index]
  },
  useCallback(fn) {
    cursor += 1
    return fn
  },
  useEffect(fn) {
    effects.push(fn)
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    const index = cursor++
    if (!subscriptions.has(index)) {
      subscriptions.set(
        index,
        subscribe(() => {
          dirty = true
        })
      )
    }
    return getSnapshot()
  }
}

// ---------------------------------------------------------------- load the bundle

new Function('window', 'document', 'setTimeout', source)(windowStub, documentStub, setTimeout)
assert.equal(loaded.id, 'dsh-attention-notify', 'bundle registers under its package id')

const registrations = []
const localeDictionaries = []
const opened = []
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (namespace, dictionaries) => {
      localeDictionaries.push({ namespace, dictionaries })
      return () => {}
    }
  },
  slots: {
    inject: (_owner, register) => {
      register()
      return () => {}
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    }
  },
  sessions: { list: sessionList },
  uiSession: { sessionStatus },
  get: (name) => (name === 'uiWorkspace' ? { openSession: (sessionId) => opened.push(sessionId) } : undefined)
}

const plugin = loaded.factory((specifier) => {
  assert.equal(specifier, 'react', 'the bundle only requires react from the platform table')
  return ReactStub
})
assert.deepEqual(plugin.inject, ['slots', 'sessions', 'uiSession', 'locale'])
plugin.apply(ctx)

assert.equal(localeDictionaries.length, 1, 'plugin registers its dictionaries once')
assert.deepEqual(
  Object.keys(localeDictionaries[0].dictionaries.en).sort(),
  Object.keys(localeDictionaries[0].dictionaries.zh).sort(),
  'zh and en dictionaries cover the same keys'
)
assert.equal(registrations.length, 1, 'plugin registers exactly one slot entry')
assert.equal(registrations[0].options.name, 'shell.overlay')
assert.equal(registrations[0].options.id, 'attention-notify')
assert.equal(typeof registrations[0].component, 'function')

const t = (key, values) => {
  const template = localeDictionaries[0]?.dictionaries.zh?.[key] ?? key
  if (!values) return template
  return template.replace(/\{(\w+)\}/gu, (match, name) => (name in values ? String(values[name]) : match))
}

/** Render until the hook state settles, then return the tree. */
function render() {
  let tree = null
  for (let pass = 0; pass < 40; pass += 1) {
    cursor = 0
    effects = []
    dirty = false
    tree = registrations[0].component({ t })
    for (const effect of effects) effect()
    if (!dirty) break
  }
  return tree
}

/** Let the async host-route request settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Flatten a rendered tree into its text and its <button> props. */
function collect(node, out) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.text += String(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (typeof node.type === 'function') return collect(node.type(node.props), out)
  if (node.type === 'style') return out
  if (node.type === 'button') out.buttons.push(node.props)
  collect(node.props?.children, out)
  return out
}

function inspect(tree) {
  const out = { text: '', buttons: [] }
  if (tree === null) return out
  collect(tree, out)
  return out
}

const buttonByTitle = (view, title) => view.buttons.find((button) => button.title === title)
const postsTo = (suffix) => nativeCalls.filter((call) => call.url === suffix)

// ---------------------------------------------------------------- scenarios

assert.equal(render(), null, 'renders nothing while no request is pending')
assert.equal(audio.oscillators, 0, 'silent while nothing is pending')

// An approval arrives: card, host window request, and one chime.
sessionStatus.set(
  new Map([
    ['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'pwsh', reason: 'Write outside the workspace' } }]
  ])
)
let view = inspect(render())
assert.match(view.text, /需要审批/u)
assert.match(view.text, /夜间重构/u)
assert.match(view.text, /pwsh/u)
assert.match(view.text, /Write outside the workspace/u)
assert.equal(view.buttons.length, 3, 'card exposes mute, dismiss, and open')
assert.equal(audio.oscillators, 2, 'the two-note chime plays once')
await flush()
assert.equal(postsTo('/attention-notify/notify').length, 1, 'the host always-on-top window is asked to show')
assert.match(postsTo('/attention-notify/notify')[0].body, /夜间重构/u)
assert.match(postsTo('/attention-notify/notify')[0].body, /approval/u)
assert.equal(systemNotifications.length, 0, 'no OS toast when the host window accepted the alert')
assert.ok(focusCalls.count >= 1, 'an unfocused window is pulled forward')

// The same request re-published does not ring or notify twice.
view = inspect(render())
await flush()
assert.equal(audio.oscillators, 2, 'a duplicate status publication stays quiet')
assert.equal(postsTo('/attention-notify/notify').length, 1, 'a duplicate publication asks for nothing new')
assert.equal((view.text.match(/需要审批/gu) ?? []).length, 1, 'one card per request')

// A second session asks a question beside the standing approval.
sessionStatus.set(
  new Map([
    ['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'pwsh' } }],
    [
      's2',
      { running: true, pendingInteraction: { kind: 'question', key: 'question:s2:c1', questions: [{ id: 'q1', question: '要保留旧的接口吗？' }] } }
    ]
  ])
)
view = inspect(render())
await flush()
assert.match(view.text, /等待你的选择/u)
assert.match(view.text, /接口联调/u)
assert.match(view.text, /要保留旧的接口吗？/u)
assert.equal(audio.oscillators, 4, 'the question rings once more')
assert.equal(postsTo('/attention-notify/notify').length, 2, 'each request reaches the host window')

// "打开会话" jumps to the owning session, retires the card, and hides the window.
const openButton = view.buttons.find((button) => button.children === '打开会话')
assert.ok(openButton, 'the open-session action is offered')
openButton.onClick()
await flush()
assert.deepEqual(opened, ['s2'], 'the jump uses uiWorkspace.openSession')
assert.equal(postsTo('/attention-notify/clear').length, 1, 'opening the session retires the host window')
const afterOpen = inspect(render())
assert.doesNotMatch(afterOpen.text, /等待你的选择/u, 'the opened card leaves the overlay')
assert.match(afterOpen.text, /需要审批/u, 'the other pending request keeps its card')

// The host route being unreachable falls back to the OS notification.
nativeMode = 'fail'
sessionStatus.set(
  new Map([['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:2', toolName: 'fs' } }]])
)
view = inspect(render())
await flush()
assert.equal(audio.oscillators, 6, 'the fallback alert still rings')
assert.equal(systemNotifications.length, 1, 'the OS toast is the fallback channel')
assert.equal(systemNotifications[0].title, '需要审批')
assert.match(systemNotifications[0].options.body, /夜间重构/u)
assert.equal(systemNotifications[0].options.silent, true, 'the in-app chime is the only sound')

// The request settling closes its OS notification.
sessionStatus.set(new Map())
inspect(render())
await flush()
assert.equal(systemNotifications[0].closed, true, 'a settled request closes its native notification')
assert.equal(postsTo('/attention-notify/clear').length >= 1, true, 'nothing pending clears the host window')

// Mute is persisted and silences the chime, but not the alert.
nativeMode = 'ok'
sessionStatus.set(
  new Map([['s2', { running: true, pendingInteraction: { kind: 'question', key: 'question:s2:c2', questions: [{ id: 'q2', question: '继续吗？' }] } }]])
)
view = inspect(render())
const muteButton = buttonByTitle(view, '静音提示音')
assert.ok(muteButton, 'the mute button is offered')
muteButton.onClick()
await flush()
assert.equal(storage.get('dsh-attention-notify:muted'), '1', 'mute is persisted')
sessionStatus.set(
  new Map([['s2', { running: true, pendingInteraction: { kind: 'plan-review', key: 'question:s2:c3', questions: [{ id: 'q3', question: '计划 A' }] } }]])
)
view = inspect(render())
await flush()
assert.match(view.text, /计划等待确认/u)
assert.equal(audio.oscillators, 8, 'a muted alert keeps the earlier count')
assert.equal(postsTo('/attention-notify/notify').length >= 3, true, 'a muted alert still reaches the host window')

// Dismissal empties the overlay.
const dismissButton = buttonByTitle(view, '关闭提醒')
assert.ok(dismissButton, 'the dismiss button is offered')
dismissButton.onClick()
await flush()
assert.equal(render(), null, 'dismissing the last card empties the overlay')

console.log('ok - client bundle notifies, jumps, mutes, and dismisses as specified')
process.exit(0)
