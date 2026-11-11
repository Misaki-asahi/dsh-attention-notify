/**
 * Headless check of the browser half without React or a browser.
 *
 * The bundle is evaluated against a minimal hooks runtime so detection, the
 * host-window request, the fallback card, mute, and dismissal
 * are exercised exactly as written.
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
const intervalSlots = []
let intervalSlot = 0

/** Host-route traffic: every request the page sends to the always-on-top window. */
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
  setInterval: (fn) => {
    intervalSlots[intervalSlot] = fn
    intervalSlot += 1
    return intervalSlot
  },
  clearInterval() {},
  focus: () => {
    focusCalls.count += 1
  }
}
const documentStub = {
  visibilityState: 'visible',
  title: '',
  hasFocus: () => false,
  body: { hasAttribute: () => false, appendChild() {} },
  documentElement: { style: { setProperty() {} }, setAttribute() {} },
  createElement: () => ({ style: {}, remove() {} })
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
    intervalSlot = 0
    effects = []
    dirty = false
    tree = registrations[0].component({ t })
    for (const effect of effects) effect()
    if (!dirty) break
  }
  return tree
}

/** Let pending host-route promises settle and re-render. */
async function settle() {
  let tree = null
  for (let pass = 0; pass < 6; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = render()
  }
  return tree
}

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
const callsTo = (suffix) => nativeCalls.filter((call) => call.url === suffix)

// ---------------------------------------------------------------- scenarios

assert.equal(render(), null, 'renders nothing while no request is pending')
assert.equal(audio.oscillators, 0, 'silent while nothing is pending')

// An approval arrives: the host window owns it, so no in-page card is rendered.
sessionStatus.set(
  new Map([
    ['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'pwsh', reason: 'Write outside the workspace' } }]
  ])
)
let tree = await settle()
assert.equal(tree, null, 'the native window replaces the in-page card')
assert.equal(audio.oscillators, 2, 'the two-note chime plays once')
assert.equal(callsTo('/attention-notify/notify').length, 1, 'the host is asked to show the alert')
const body = JSON.parse(callsTo('/attention-notify/notify')[0].body)
assert.equal(body.title, '夜间重构')
assert.equal(body.kind, 'approval')
assert.ok(body.theme !== undefined, 'the resolved theme travels with the alert')
assert.match(body.body, /pwsh/u)
assert.equal(systemNotifications.length, 0, 'no OS toast when the host accepted the alert')
assert.ok(focusCalls.count >= 1, 'an unfocused window is pulled forward')

// The same request re-published does not ring or notify twice.
tree = await settle()
assert.equal(audio.oscillators, 2, 'a duplicate status publication stays quiet')
assert.equal(callsTo('/attention-notify/notify').length, 1, 'a duplicate publication asks for nothing new')

// A second session asks a question: still one surface, one more host request.
sessionStatus.set(
  new Map([
    ['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'pwsh' } }],
    [
      's2',
      { running: true, pendingInteraction: { kind: 'question', key: 'question:s2:c1', questions: [{ id: 'q1', question: '要保留旧的接口吗？' }] } }
    ]
  ])
)
tree = await settle()
assert.equal(tree, null, 'both requests stay on the native surface')
assert.equal(callsTo('/attention-notify/notify').length, 2, 'each request reaches the host window')
assert.equal(audio.oscillators, 4, 'the question rings once more')

// The card's primary action dismisses the alert.

// With the host route down, the themed in-page card and the OS toast take over.
nativeMode = 'fail'
sessionStatus.set(
  new Map([['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:2', toolName: 'fs' } }]])
)
tree = await settle()
let view = inspect(tree)
assert.match(view.text, /需要审批/u, 'the fallback card carries the alert')
assert.match(view.text, /夜间重构/u)
assert.equal(audio.oscillators, 6, 'the fallback alert still rings')
assert.equal(systemNotifications.length, 1, 'the OS toast is the fallback channel')
assert.equal(systemNotifications[0].title, '需要审批')
assert.equal(systemNotifications[0].options.silent, true, 'the in-app chime is the only sound')

// The request settling closes its OS notification.
sessionStatus.set(new Map())
tree = await settle()
assert.equal(tree, null, 'nothing pending leaves no card')
assert.equal(systemNotifications[0].closed, true, 'a settled request closes its native notification')

// Every alert chimes: there is no mute switch.
nativeMode = 'fail'
sessionStatus.set(
  new Map([['s2', { running: true, pendingInteraction: { kind: 'question', key: 'question:s2:c2', questions: [{ id: 'q2', question: '继续吗？' }] } }]])
)
tree = await settle()
view = inspect(tree)
assert.equal(buttonByTitle(view, '静音提示音'), undefined, 'the card no longer offers a mute toggle')
sessionStatus.set(
  new Map([['s2', { running: true, pendingInteraction: { kind: 'plan-review', key: 'question:s2:c3', questions: [{ id: 'q3', question: '计划 A' }] } }]])
)
tree = await settle()
view = inspect(tree)
assert.match(view.text, /计划等待确认/u)
assert.equal(audio.oscillators, 10, 'each alert rings, muted or not')

// Dismissal empties the overlay.
const dismissButton = buttonByTitle(view, '关闭提醒')
assert.ok(dismissButton, 'the dismiss button is offered')
dismissButton.onClick()
tree = render()
assert.equal(tree, null, 'dismissing the last card empties the overlay')

// A turn that finishes elsewhere pings once, then the card retires itself.
nativeMode = 'ok'
sessionStatus.set(new Map([['s1', { running: true }]]))
await settle()
sessionStatus.set(new Map([['s1', { running: false }]]))
tree = await settle()
assert.equal(tree, null, 'the native window owns the completion ping')
const completion = JSON.parse(callsTo('/attention-notify/notify').at(-1).body)
assert.equal(completion.kind, 'done')
assert.equal(completion.title, '夜间重构')
assert.match(completion.kindLabel, /已完成/u)

console.log('ok - one surface at a time: native window, fallback card, dismissal, completion ping')
process.exit(0)
