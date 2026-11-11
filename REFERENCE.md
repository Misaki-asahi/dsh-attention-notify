# dsh-attention-notify — reference

Long-form notes for maintainers. The task-level instructions live in
[SKILL.md](SKILL.md).

## Wire format

`POST /attention-notify/notify` — `content-type: text/plain` (avoids a preflight
and keeps Node's body forwarding simple). Body is JSON:

| field | cap | meaning |
| --- | --- | --- |
| `title` | 200 | session title (or the localized "untitled") |
| `body` | 600 | the detail line |
| `kind` | — | `approval` \| `question` \| `plan-review` |
| `kindLabel` | 80 | localized kind heading |
| `openLabel` | 40 | button label |
| `dismissLabel` | 40 | button label |

`POST /attention-notify/clear` hides the window. `GET /attention-notify/ping`
answers `{"ok":true,"helper":<bool>}`.

The caps are enforced host-side (`text(value, limit)`); an empty title+body is
rejected with 400 so a malformed client cannot pop an empty card.

## Host half (`index.js`)

- `inject: ['webServer']`, registers a `prefix` route `/attention-notify`.
- Keeps one `spawn('powershell.exe', [... '-File', helper, alertFile, stopFile, pid])`
  child; respawns on the next alert after it exits.
- Writes `%TEMP%\dsh-attention-notify\alert.json` with a monotonic `seq`. The
  helper only reacts when `seq` changes, so repeated identical alerts still
  refresh the card.
- On dispose: removes the route, writes `stop`, kills the child.

Route registration is `ctx.webServer.register({ kind, path, handler })`; the
handler owns the raw Node `(req, res)` pair. A duplicate `(kind, path)` throws —
that is the composition-level contract.

## Browser half (`lib/client.js`)

- Bundled as a lazy `window.__ModuleLoader__.load({ id, factory })` factory;
  `require('react')` only.
- `inject: ['slots', 'sessions', 'uiSession', 'locale']`.
- Registers `shell.overlay` (`ctx.slots.inject('shell.overlay', () => …register)`),
  so it survives that slot's re-declaration.
- Reads `ctx.uiSession.sessionStatus` through `useSyncExternalStore`.
- Jump: `ctx.get('uiWorkspace').openSession(sessionId)` — the only supported way
  for another plugin to replace the main view's `mainView` reference. Nothing is
  hard-injected, so a composition without `uiWorkspace` degrades to raising the
  window instead of deactivating the plugin.
- Announcement bookkeeping: `seen` (5 s guard), `refreshes` (3 repeats),
  `systemNotifications` (one toast per key, closed when the request settles),
  `hostWindowShown` (so `clear` is only sent for a window this page raised).

### Completion pings

`sessionStatus` also carries `running`. A `true → false` transition means the
turn ended, which the component turns into a `transient` notice (`kind: "done"`).
Transient notices are pruned by age instead of by pending state, and the host
window is retired 12 s later unless a newer alert replaced it. The ping is
suppressed when the finished session is the one on screen and the window has
focus — `ctx.uiSession.current` plus `document.hasFocus()` — so watching a reply
never beeps at you.

### One surface at a time

`announce()` optimistically marks the host window as up; while it is up the
in-page card is not rendered, so a request produces exactly one alert. When the
route answers `{ok:false}` / `helper:false` / a non-JSON 200 (SPA fallback), the
card comes back and the OS toast is posted instead. That makes the themed card a
true fallback rather than a second popup.

## Helper (`helper/alert-window.ps1`)

Why a separate process: the plugin host is a Node child of Electron
(`ELECTRON_RUN_AS_NODE=1`) with no `BrowserWindow`, and the renderer has no
window IPC. A WinForms window is the smallest thing that can be topmost.

Order that matters:

1. `AttentionDpi::Enable()` — **before any window exists**, otherwise Windows
   treats the process as DPI-unaware and bitmap-scales the whole card (blurry
   text on a 150 % display).
2. `EnableVisualStyles()` + `SetCompatibleTextRenderingDefault($false)` — GDI
   `TextRenderer` gives ClearType edges; the GDI+ default is softer.
3. Build the form hidden, then `Application.Run()` **without** a main form. Do
   not use `Add_Shown({ $form.Hide() })`: `Shown` re-fires on every `Show()`,
   which hides the card the moment it appears.

Sizing: authoring units are DIPs at 96 DPI; `S()` scales by `系统DPI / 96`
(`GetDpiForSystem`, falling back to `GetDeviceCaps(LOGPIXELSX)`). Fonts stay in
points, so they scale with the DC's DPI.

Window style: `WS_EX_TOPMOST | WS_EX_TOOLWINDOW` and
`ShowWithoutActivation = true` — visible above every other window, absent from
Alt-Tab, and it does not steal focus. Clicking it does activate it.

The `.ps1` stays ASCII-only. Windows PowerShell 5.1 reads a BOM-less script as
ANSI, so any non-ASCII literal would corrupt the parse; all translated copy
travels in the UTF-8 alert JSON, which is read with `-Encoding UTF8`.

Lifecycle: the timer checks the `stop` file and (when given) the owner PID every
400 ms, then exits the message loop. A user-closed window just hides; the next
`seq` change shows it again.

## Why not Document Picture-in-Picture

Measured on DSH 0.2.2-rc.1 / Electron 44.7.0, from a diagnostic beacon the
plugin posted to a local listener:

```
GET /?e=apply&pip=object&rw=function&act=false
GET /?e=rearm&pip=object&rw=function&act=true
GET /?e=open-reject&name=InvalidStateError
    msg=Failed to execute 'requestWindow' on 'DocumentPictureInPicture':
        Internal error: no window
```

The API object and method exist; the browser side simply has no PiP window to
hand out. `documentPictureInPicture` is therefore unusable in this shell, and an
optimistic "opening" state must never suppress the fallback channel — the v0.3
implementation did exactly that and silently delivered nothing.

## Theme

The in-app card uses only `--dsw-alias-*` tokens with literal fallbacks. The
native card cannot read them (different process), so it uses fixed colors that
match the dark theme; keep them in sync with `--dsw-*` only by eye.

## Testing

`tests/render.test.mjs` evaluates the real bundle against a ~120-line hooks
runtime (useState/useRef/useCallback/useEffect/useSyncExternalStore) plus fake
stores, `fetch`, `Notification`, `AudioContext` and `localStorage`. It asserts
card text, the host request body, the toast fallback, the jump call, mute
persistence, and dismissal. It is not a substitute for the real window; the
route + `PrintWindow` checks in SKILL.md cover that.

## Security notes

- The route is only reachable over loopback (the server binds 127.0.0.1) and
  carries no auth of its own — it can only raise/hide a local card.
- Bodies are capped at 16 KiB and all copy is length-limited before it reaches
  the helper, so a malformed alert cannot flood the window.
- The helper runs `powershell.exe -ExecutionPolicy Bypass` on a script shipped
  inside the plugin directory; it never evaluates remote content.
