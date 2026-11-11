window.__ModuleLoader__.load({
  id: 'dsh-attention-notify',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'attention-notify'
    /** localStorage key for the user's sound preference. */
    const MUTE_KEY = 'dsh-attention-notify:muted'
    /** How long one in-page card stays before it retires itself. */
    const CARD_LIFETIME_MS = 22_000
    /** Minimum gap between two announcements of the same pending request. */
    const REPEAT_GUARD_MS = 5_000
    /** At most this many cards stack in the page overlay. */
    const MAX_CARDS = 4
    /** A request still pending this long re-announces itself once. */
    const REFRESH_MS = 30_000
    /** How many extra announcements one request may produce. */
    const MAX_REFRESHES = 3
    /** How long a "turn finished" card stays before the host window is retired. */
    const DONE_LIFETIME_MS = 12_000

    /** Simplified Chinese dictionary. */
    const zh = {
      'approval.title': '需要审批',
      'approval.detail': '工具 {tool} 请求越权执行',
      'approval.detailGeneric': '有一次性权限请求等待你允许或拒绝',
      'approval.detailWithReason': '工具 {tool}：{reason}',
      'question.title': '等待你的选择',
      'question.detailFallback': '回到会话里选择选项或填写回答',
      'plan.title': '计划等待确认',
      'plan.detail': '查看计划，选择批准或要求修改',
      'done.title': '已完成',
      'done.detail': '这一轮回复已结束，可以回来看了',
      'session.untitled': '未命名会话',
      'action.open': '打开会话',
      'action.focusApp': '切回 DSH',
      'action.dismiss': '关闭提醒',
      'action.mute': '静音提示音',
      'action.unmute': '开启提示音'
    }

    /** English dictionary, checked against the Chinese key set. */
    const en = {
      'approval.title': 'Approval needed',
      'approval.detail': 'Tool {tool} requests privileged execution',
      'approval.detailGeneric': 'A one-time permission request needs allow or reject',
      'approval.detailWithReason': 'Tool {tool}: {reason}',
      'question.title': 'Waiting for your choice',
      'question.detailFallback': 'Return to the session to pick an option or answer',
      'plan.title': 'Plan awaiting review',
      'plan.detail': 'Open the plan to approve it or request changes',
      'done.title': 'Turn finished',
      'done.detail': 'The reply is done — come back when you like',
      'session.untitled': 'Untitled session',
      'action.open': 'Open session',
      'action.focusApp': 'Back to DSH',
      'action.dismiss': 'Dismiss',
      'action.mute': 'Mute the alert sound',
      'action.unmute': 'Enable the alert sound'
    }

    /**
     * Card chrome, expressed through host theme tokens with literal fallbacks.
     */
    const CSS = `
.dan-card{pointer-events:auto;position:relative;display:flex;flex-direction:column;gap:5px;padding:13px 14px 12px;border-radius:var(--dsw-radius-xl, 14px);border:1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));background:var(--dsw-specific-input-major, var(--dsw-alias-bg-base, #fff));box-shadow:var(--dsw-shadow-lv2, 0 10px 30px rgba(0,0,0,.18));overflow:hidden;animation:dan-in 240ms cubic-bezier(.22,1,.36,1)}
.dan-card *{box-sizing:border-box}
.dan-bar{position:absolute;inset:0 0 auto;height:3px;background:var(--dsw-alias-state-warn-primary,#e08b1a)}
.dan-head{display:flex;align-items:center;gap:8px;min-height:22px}
.dan-spacer{flex:1 1 auto}
.dan-dot{flex:none;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-state-warn-primary,#e08b1a);animation:dan-pulse 1.8s ease-in-out infinite}
.dan-kind{font-size:12px;font-weight:600;line-height:16px;letter-spacing:.2px;color:var(--dsw-alias-state-warn-primary,#e08b1a)}
.dan-title{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dan-detail{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.dan-foot{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:4px}
.dan-btn{font:inherit;font-size:12px;line-height:18px;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dan-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.dan-btn-primary{border-color:transparent;background:var(--dsw-alias-state-warn-primary,#e08b1a);color:#fff}
.dan-btn-primary:hover{background:var(--dsw-alias-state-warn-primary,#e08b1a);color:#fff;filter:brightness(1.06)}
.dan-iconbtn{flex:none;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;cursor:pointer}
.dan-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.dan-card[data-kind="question"] .dan-bar,.dan-card[data-kind="question"] .dan-dot{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dan-card[data-kind="question"] .dan-kind{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dan-card[data-kind="question"] .dan-btn-primary{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dan-card[data-kind="done"] .dan-bar,.dan-card[data-kind="done"] .dan-dot{background:var(--dsw-alias-state-success-primary,#3fb950)}
.dan-card[data-kind="done"] .dan-kind{color:var(--dsw-alias-state-success-primary,#3fb950)}
.dan-card[data-kind="done"] .dan-btn-primary{background:var(--dsw-alias-state-success-primary,#3fb950)}
.dan-stack{position:fixed;top:calc(var(--dsh-frame-overlay-top, 20px) + 4px);right:18px;z-index:40;display:flex;flex-direction:column;gap:10px;width:340px;max-width:calc(100vw - 36px);pointer-events:none}
.dan-stack .dan-card{pointer-events:auto}
@keyframes dan-in{from{opacity:0;transform:translateY(-10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes dan-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@media (prefers-reduced-motion:reduce){.dan-card{animation:none}.dan-dot{animation:none}}
`

    /** Read one persisted preference. */
    function readPref(key) {
      try {
        return window.localStorage.getItem(key) === '1'
      } catch {
        return false
      }
    }

    /** Persist one preference. */
    function writePref(key, value) {
      try {
        window.localStorage.setItem(key, value ? '1' : '0')
      } catch {
        /* private mode: the preference simply does not survive the page */
      }
    }

    /** Whether the alert sound is muted. */
    const isMuted = () => readPref(MUTE_KEY)

    /** Lazily created Web Audio context shared by every alert. */
    let audioContext

    /** Create the shared AudioContext once. */
    function ensureAudio() {
      if (audioContext) return audioContext
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (typeof AudioCtor !== 'function') return undefined
        audioContext = new AudioCtor()
      } catch {
        audioContext = undefined
      }
      return audioContext
    }

    /**
     * Play the two-note attention chime. Scheduling waits for a resumed context
     * so a page whose audio was autoplay-blocked still rings after the first
     * gesture instead of silently dropping the sound.
     */
    function playChime() {
      if (isMuted()) return
      const context = ensureAudio()
      if (!context) return
      const ring = () => {
        try {
          const start = context.currentTime
          for (const [frequency, offset, duration] of [
            [880, 0, 0.34],
            [1174.66, 0.15, 0.5]
          ]) {
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.setValueAtTime(frequency, start + offset)
            gain.gain.setValueAtTime(0.0001, start + offset)
            gain.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(start + offset)
            oscillator.stop(start + offset + duration + 0.02)
          }
        } catch {
          /* an audio device changing mid-call must not break the notification */
        }
      }
      try {
        if (context.state === 'suspended') context.resume().then(ring, () => {})
        else ring()
      } catch {
        /* ignore */
      }
    }

    /** Collapse markup whitespace and cap one line of question text. */
    function summarize(text) {
      if (typeof text !== 'string') return ''
      const flat = text.replace(/\s+/gu, ' ').trim()
      return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat
    }

    /** The first question's text, when the request carries one. */
    function firstQuestionText(pending) {
      const questions = pending && pending.questions
      if (!Array.isArray(questions) || questions.length === 0) return ''
      const first = questions[0]
      if (!first || typeof first !== 'object') return ''
      return summarize(first.question)
    }

    /** Normalize one pending interaction into a renderable notice. */
    function createNotice(pending, sessionId, sessions, t) {
      const kind = pending.kind === 'question' ? 'question' : pending.kind === 'plan-review' ? 'question' : 'approval'
      const row = sessions && sessions.byId ? sessions.byId[sessionId] : undefined
      const rawTitle = row && typeof row.title === 'string' ? row.title.trim() : ''
      const sessionTitle = rawTitle === '' ? t('session.untitled') : rawTitle
      const isPlan = pending.kind === 'plan-review'
      let kindLabel = t('approval.title')
      let detail = t('approval.detailGeneric')
      if (kind === 'question') {
        kindLabel = isPlan ? t('plan.title') : t('question.title')
        detail = isPlan ? t('plan.detail') : firstQuestionText(pending) || t('question.detailFallback')
      } else {
        const tool = typeof pending.toolName === 'string' ? pending.toolName.trim() : ''
        const reason = typeof pending.reason === 'string' ? summarize(pending.reason) : ''
        if (tool && reason) detail = t('approval.detailWithReason', { tool, reason })
        else if (tool) detail = t('approval.detail', { tool })
      }
      return {
        key: pending.key,
        kind,
        kindLabel,
        sessionId,
        sessionTitle,
        detail,
        // The host window is a separate process with no locale of its own, so
        // its copy travels with the alert. Its action only raises the app, so
        // the label says that instead of promising a jump it cannot perform.
        openLabel: t('action.focusApp'),
        dismissLabel: t('action.dismiss'),
        at: Date.now()
      }
    }

    /**
     * Bring a pending Session to the front of the app.
     * `uiWorkspace.openSession` owns the main-view reference, so it is the only
     * supported way for another plugin to switch the main area.
     * @param context - Client plugin context.
     * @param sessionId - Session to select.
     * @returns whether the Session was opened.
     */
    function openSession(context, sessionId) {
      let opened = false
      if (typeof sessionId === 'string' && sessionId !== '') {
        let workspace
        try {
          workspace = context.get('uiWorkspace')
        } catch {
          workspace = undefined
        }
        if (workspace && typeof workspace.openSession === 'function') {
          try {
            workspace.openSession(sessionId)
            opened = true
          } catch (error) {
            console.warn('[attention-notify] could not open the session:', error)
          }
        }
      }
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      return opened
    }

    /**
     * Ask the host half to raise its always-on-top window. The page reaches it
     * over a relative path: a browser hits the local server directly, and the
     * desktop shell forwards unknown `dsh-app://` paths to that same server.
     * @param notice - the alert to show.
     * @returns whether the host accepted it.
     */
    async function notifyNative(notice) {
      try {
        const response = await fetch('/attention-notify/notify', {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            title: notice.sessionTitle,
            body: notice.detail,
            kind: notice.kind,
            kindLabel: notice.kindLabel,
            openLabel: notice.openLabel,
            dismissLabel: notice.dismissLabel,
            sessionId: notice.sessionId,
            key: notice.key,
            theme: readTheme(notice.kind)
          })
        })
        if (!response.ok) return false
        // A 200 alone proves nothing: when the route is missing, the SPA
        // fallback answers HTML with status 200. Only an explicit `ok: true`
        // JSON envelope counts as delivery, so a stale page or a wrong origin
        // falls through to the OS notification instead of going silent.
        const payload = await response.json().catch(() => null)
        if (payload === null || payload.ok !== true) return false
        // `helper: false` means the route answered but no window came up.
        return payload.helper !== false
      } catch {
        return false
      }
    }

    /**
     * Ask the host whether the native window's button requested a jump.
     * The helper cannot call the client, so the page polls this while a card is
     * up; the host answers once per press.
     * @returns the requested session, or null.
     */
    async function takeJump() {
      try {
        const response = await fetch('/attention-notify/take-jump', { cache: 'no-store' })
        if (!response.ok) return null
        const payload = await response.json()
        return payload && payload.jump && typeof payload.jump.sessionId === 'string' ? payload.jump : null
      } catch {
        return null
      }
    }

    /** Hide the host window once nothing is pending. */
    async function clearNative() {
      try {
        await fetch('/attention-notify/clear', { method: 'POST', body: '{}' })
      } catch {
        /* the host may be restarting; the window closes with it */
      }
    }

    /** One stacked card, rendered by React inside the page. */
    function NoticeCard(props) {
      const { notice, t, muted, onOpen, onDismiss, onToggleMute } = props
      return h(
        'div',
        { className: 'dan-card', 'data-kind': notice.kind, role: 'alert' },
        h('div', { className: 'dan-bar' }),
        h(
          'div',
          { className: 'dan-head' },
          h('span', { className: 'dan-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dan-kind' }, notice.kindLabel),
          h('span', { className: 'dan-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dan-iconbtn',
              title: muted ? t('action.unmute') : t('action.mute'),
              'aria-label': muted ? t('action.unmute') : t('action.mute'),
              onClick: onToggleMute
            },
            muted ? '🔇' : '🔊'
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dan-iconbtn',
              title: t('action.dismiss'),
              'aria-label': t('action.dismiss'),
              onClick: () => onDismiss(notice.key)
            },
            '✕'
          )
        ),
        h('div', { className: 'dan-title' }, notice.sessionTitle),
        h('div', { className: 'dan-detail' }, notice.detail),
        h(
          'div',
          { className: 'dan-foot' },
          h('button', { type: 'button', className: 'dan-btn dan-btn-primary', onClick: () => onOpen(notice) }, t('action.open'))
        )
      )
    }

    /**
     * Resolve one host theme token to a concrete colour string, so the native
     * card (a separate process with no access to the page's CSS variables) can
     * match the current light/dark theme.
     * @param token - CSS custom property name.
     * @param property - style property to read back.
     * @param fallback - value used when the token or the DOM is unavailable.
     */
    function resolveToken(token, property, fallback) {
      try {
        const probe = document.createElement('div')
        probe.style.display = 'none'
        if (property.startsWith('border')) {
          probe.style.borderStyle = 'solid'
          probe.style.borderWidth = '1px'
        }
        probe.style[property] = `var(${token})`
        document.body.appendChild(probe)
        const value = window.getComputedStyle(probe)[property]
        probe.remove()
        return typeof value === 'string' && value !== '' && value !== 'rgba(0, 0, 0, 0)' ? value : fallback
      } catch {
        return fallback
      }
    }

    /** The palette the native card should paint itself with. */
    function readTheme(kind) {
      const accentToken =
        kind === 'question'
          ? '--dsw-alias-state-business-primary'
          : kind === 'done'
            ? '--dsw-alias-state-success-primary'
            : '--dsw-alias-state-warn-primary'
      return {
        bg: resolveToken('--dsw-specific-input-major', 'backgroundColor', '#1a1e29'),
        text: resolveToken('--dsw-alias-label-primary', 'color', '#f2f4f7'),
        muted: resolveToken('--dsw-alias-label-secondary', 'color', '#c6cde0'),
        border: resolveToken('--dsw-alias-border-l3', 'borderTopColor', 'rgba(255,255,255,0.12)'),
        accent: resolveToken(accentToken, 'color', kind === 'done' ? '#3fb950' : '#e08b1a')
      }
    }

    /**
     * Build the notifier over the client Session status source.
     * @param ctx - Client plugin context.
     * @returns the notifier, or null when the status source is unavailable.
     */
    function createAttentionNotifier(ctx) {
      const statusSource = ctx.uiSession ? ctx.uiSession.sessionStatus : undefined
      if (!statusSource || typeof statusSource.subscribe !== 'function') {
        console.warn('[attention-notify] uiSession.sessionStatus is unavailable; the overlay stays idle')
        return null
      }
      const listSource = ctx.sessions ? ctx.sessions.list : undefined
      const subscribeStatus = (listener) => statusSource.subscribe(listener)
      const getStatus = () => statusSource.getSnapshot()
      const subscribeSessions =
        listSource && typeof listSource.subscribe === 'function' ? (listener) => listSource.subscribe(listener) : () => () => {}
      const getSessions = () =>
        listSource && typeof listSource.getSnapshot === 'function' ? listSource.getSnapshot() : { byId: {} }

      /** Native OS notifications, keyed by pending interaction. */
      const systemNotifications = new Map()
      /** Extra announcements already spent per pending interaction. */
      const refreshes = new Map()
      /** Latest rendered state, readable from timer callbacks. */
      let visibleNotices = []
      let translate = (key) => key
      // Assigned by the mounted component, which owns the React state.
      let unpublish = () => {}
      let setMuted = () => {}
      let setNativeUp = () => {}

      const closeSystemNotification = (key) => {
        const notification = systemNotifications.get(key)
        if (notification === undefined) return
        systemNotifications.delete(key)
        try {
          notification.close()
        } catch {
          /* ignore */
        }
      }

      /**
       * Deliver one alert: the host's always-on-top window when it is reachable,
       * otherwise the OS notification, which the system also draws above other
       * applications but retires by itself.
       */
      let hostWindowShown = false
      const announce = (notice) => {
        hostWindowShown = true
        setNativeUp(true)
        const fallback = () => {
          hostWindowShown = false
          setNativeUp(false)
          postSystemNotification(notice)
        }
        notifyNative(notice).then((delivered) => {
          if (!delivered) fallback()
        }, fallback)
      }

      /** Hide the host window, but only when this page put one up. */
      const retireHostWindow = () => {
        if (!hostWindowShown) return
        hostWindowShown = false
        void clearNative()
      }

      /**
       * Post one native OS notification. The OS draws it above every window and
       * keeps it in the notification center: that is the system-level layer a
       * renderer-only plugin can reach. A repeat replaces the previous toast for
       * the same request instead of stacking a second one.
       */
      const postSystemNotification = (notice) => {
        try {
          if (typeof Notification === 'undefined') return
          if (Notification.permission === 'denied') return
          const show = () => {
            try {
              closeSystemNotification(notice.key)
              const notification = new Notification(notice.kindLabel, {
                body: `${notice.sessionTitle} · ${notice.detail}`,
                tag: `dsh-attention-notify:${notice.key}`,
                silent: true,
                requireInteraction: true
              })
              notification.onclick = () => {
                handlers.open(notice)
              }
              notification.onclose = () => {
                if (systemNotifications.get(notice.key) === notification) systemNotifications.delete(notice.key)
              }
              systemNotifications.set(notice.key, notification)
            } catch (error) {
              console.warn('[attention-notify] system notification unavailable:', error)
            }
          }
          if (Notification.permission === 'granted') {
            show()
            return
          }
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') show()
          }, () => {})
        } catch {
          /* the in-window card remains the fallback channel */
        }
      }

      const handlers = {
        open: (notice) => {
          openSession(ctx, notice.sessionId)
          closeSystemNotification(notice.key)
          unpublish(notice.key)
        },
        dismiss: (key) => {
          closeSystemNotification(key)
          unpublish(key)
        },
        toggleMute: () => {
          const next = !isMuted()
          writePref(MUTE_KEY, next)
          setMuted(next)
          if (!next) playChime()
        }
      }

      return {
        component(props) {
          translate = typeof props.t === 'function' ? props.t : (key) => zh[key] || key
          const status = React.useSyncExternalStore(subscribeStatus, getStatus)
          const sessions = React.useSyncExternalStore(subscribeSessions, getSessions)
          const [notices, setNotices] = React.useState([])
          const [mutedState, setMutedState] = React.useState(isMuted)
          const [nativeUp, setNativeUpState] = React.useState(false)
          const seen = React.useRef(new Map())
          const running = React.useRef(new Map())
          const live = React.useRef({ sessions })

          live.current.sessions = sessions
          setMuted = setMutedState
          setNativeUp = setNativeUpState
          unpublish = (key) => setNotices((current) => current.filter((notice) => notice.key !== key))

          const open = React.useCallback((notice) => {
            handlers.open(notice)
            // The user is already on the request now, so the host window can go.
            retireHostWindow()
          }, [])
          const dismiss = React.useCallback((key) => {
            handlers.dismiss(key)
            if (visibleNotices.length <= 1) retireHostWindow()
          }, [])
          const toggleMute = React.useCallback(() => {
            handlers.toggleMute()
          }, [])

          // Detect newly pending approvals and questions, retire cards whose
          // request settled, and announce each arrival exactly once.
          React.useEffect(() => {
            const now = Date.now()
            const pendingByKey = new Map()
            for (const [sessionId, state] of status) {
              const pending = state ? state.pendingInteraction : undefined
              if (!pending || typeof pending.key !== 'string') continue
              pendingByKey.set(pending.key, { pending, sessionId })
            }
            setNotices((current) => {
              const kept = current.filter(
                (notice) => (notice.transient === true ? now - notice.at < DONE_LIFETIME_MS : pendingByKey.has(notice.key))
              )
              return kept.length === current.length ? current : kept
            })
            for (const key of [...systemNotifications.keys()]) {
              if (!pendingByKey.has(key)) closeSystemNotification(key)
            }
            for (const key of [...refreshes.keys()]) {
              if (!pendingByKey.has(key)) refreshes.delete(key)
            }
            for (const key of [...seen.current.keys()]) {
              if (!pendingByKey.has(key)) seen.current.delete(key)
            }
            // Nothing is waiting any more: retire the host window with the card.
            if (pendingByKey.size === 0) retireHostWindow()
            const fresh = []
            for (const [key, entry] of pendingByKey) {
              const announced = seen.current.get(key)
              if (announced !== undefined && now - announced < REPEAT_GUARD_MS) continue
              seen.current.set(key, now)
              fresh.push(createNotice(entry.pending, entry.sessionId, live.current.sessions, translate))
            }
            // A session that was running and is now idle just finished a turn:
            // that is worth a ping when the user is elsewhere.
            const finished = []
            const mainSessionId = (() => {
              try {
                return ctx.uiSession && ctx.uiSession.current ? ctx.uiSession.current.getSnapshot()?.key : undefined
              } catch {
                return undefined
              }
            })()
            const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : false
            for (const [sessionId, state] of status) {
              const wasRunning = running.current.get(sessionId)
              const isRunning = state ? state.running === true : false
              running.current.set(sessionId, isRunning)
              if (wasRunning !== true || isRunning) continue
              // Watching this very session already shows the result.
              if (sessionId === mainSessionId && focused) continue
              const row = live.current.sessions && live.current.sessions.byId ? live.current.sessions.byId[sessionId] : undefined
              const title = row && typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : translate('session.untitled')
              finished.push({
                key: `done:${sessionId}:${String(now)}`,
                kind: 'done',
                kindLabel: translate('done.title'),
                sessionId,
                sessionTitle: title,
                detail: translate('done.detail'),
                openLabel: translate('action.open'),
                dismissLabel: translate('action.dismiss'),
                at: now,
                transient: true
              })
            }
            for (const notice of finished) fresh.push(notice)
            if (fresh.length === 0) return
            setNotices((current) => {
              const shown = new Set(current.map((notice) => notice.key))
              return [...fresh.filter((notice) => !shown.has(notice.key)), ...current].slice(0, MAX_CARDS)
            })
            playChime()
            for (const notice of fresh) announce(notice)
            if (finished.length > 0) {
              // A finished turn is news, not a question: retire the card after a
              // while unless a newer alert replaced it.
              window.setTimeout(() => {
                if (visibleNotices.some((notice) => notice.transient === true)) return
                retireHostWindow()
              }, DONE_LIFETIME_MS)
            }
            // Pull the app forward so the in-page card is actually visible; the
            // host window covers the case where the shell refuses to raise.
            if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
              try {
                window.focus()
              } catch {
                /* ignore */
              }
            }
          }, [status])

          // Mirror the visible notices for the refresh timer.
          React.useEffect(() => {
            visibleNotices = notices
          }, [notices])

          // A request still waiting after half a minute announces itself again,
          // so an alert missed while working elsewhere does not end the story.
          React.useEffect(() => {
            const timer = window.setInterval(() => {
              for (const notice of visibleNotices) {
                const spent = refreshes.get(notice.key) ?? 0
                if (spent >= MAX_REFRESHES) continue
                refreshes.set(notice.key, spent + 1)
                announce(notice)
                playChime()
              }
            }, REFRESH_MS)
            return () => window.clearInterval(timer)
          }, [])

          // The native window can only ask the page to jump; this is where that
          // request turns into a real session switch.
          React.useEffect(() => {
            const timer = window.setInterval(() => {
              if (visibleNotices.length === 0) return
              takeJump().then((jump) => {
                if (jump === null) return
                openSession(ctx, jump.sessionId)
                retireHostWindow()
                unpublish(jump.key)
              })
            }, 1000)
            return () => window.clearInterval(timer)
          }, [])

          // Retire each card after its own lifetime; adding a card does not
          // restart another card's countdown.
          React.useEffect(() => {
            if (notices.length === 0) return undefined
            const now = Date.now()
            const timers = notices.map((notice) =>
              window.setTimeout(
                () => {
                  setNotices((current) => current.filter((candidate) => candidate.key !== notice.key))
                },
                Math.max(1200, CARD_LIFETIME_MS - (now - notice.at))
              )
            )
            return () => {
              for (const timer of timers) window.clearTimeout(timer)
            }
          }, [notices])

          // One surface at a time: while the host window is up it owns the
          // alert, and the themed in-page card exists only as its fallback.
          if (notices.length === 0 || nativeUp) return null
          return h(
            'div',
            { className: 'dan-stack', 'data-attention-notify': '', 'aria-live': 'polite' },
            h('style', { key: 'style' }, CSS),
            notices.map((notice) =>
              h(NoticeCard, {
                key: notice.key,
                notice,
                t: translate,
                muted: mutedState,
                onOpen: open,
                onDismiss: dismiss,
                onToggleMute: toggleMute
              })
            )
          )
        }
      }
    }

    /** Services this plugin needs before it can render. */
    const inject = ['slots', 'sessions', 'uiSession', 'locale']

    /**
     * Install dictionaries, unlock the chime on the first gesture, and register
     * the overlay entry.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en
          }),
        'attention-notify: dictionaries'
      )

      const notifier = createAttentionNotifier(ctx)
      if (notifier === null) return

      // Autoplay policies keep a fresh AudioContext suspended until a user
      // gesture, so the first press or click unlocks the chime.
      ctx.effect(() => {
        const unlock = () => {
          const context = ensureAudio()
          if (context && context.state === 'suspended') context.resume().catch(() => {})
        }
        window.addEventListener('pointerdown', unlock, true)
        window.addEventListener('keydown', unlock, true)
        return () => {
          window.removeEventListener('pointerdown', unlock, true)
          window.removeEventListener('keydown', unlock, true)
        }
      }, 'attention-notify: gesture unlock')

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'attention-notify',
            order: 50,
            locale: NS
          },
          notifier.component
        )
      )

      // Manual smoke test: `__DSH_ATTENTION_NOTIFY__.test()` in the page console.
      try {
        window.__DSH_ATTENTION_NOTIFY__ = {
          test: () => {
            playChime()
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                const notification = new Notification('审批与选择提醒', {
                  body: '这是一条测试提醒，说明系统通知与提示音通道正常。',
                  silent: true
                })
                notification.onclick = () => {
                  try {
                    window.focus()
                  } catch {
                    /* ignore */
                  }
                  notification.close()
                }
              }
            } catch (error) {
              console.warn('[attention-notify] test notification failed:', error)
            }
          },
          play: playChime,
          muted: isMuted,
          /**
           * Prove the page→host channel end to end. Returns whether the host
           * accepted the alert, so a console check distinguishes "client half
           * missing" from "route missing".
           */
          selftest: async () => {
            const delivered = await notifyNative({
              kind: 'approval',
              kindLabel: '需要审批',
              sessionTitle: '自检',
              detail: '这条来自 __DSH_ATTENTION_NOTIFY__.selftest()',
              openLabel: '切回 DSH',
              dismissLabel: '知道了'
            })
            playChime()
            return delivered
          }
        }
      } catch {
        /* ignore */
      }
    }

    return { inject, apply }
  }
})
