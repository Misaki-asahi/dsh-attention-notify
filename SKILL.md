---
name: dsh-attention-notify
description: Install, verify, retune, or review the dsh-attention-notify plugin, which raises a system-level always-on-top alert card with a chime whenever a DSH session is waiting for approval, needs a choice, or finishes a turn. Use when the user asks for approval or question notifications, an always-on-top or "置顶" popup, a notification sound, "会话需要审批时提醒我", "弹窗盖不住", or asks to install, debug, tune, or audit this plugin.
---

# dsh-attention-notify

A DSH plugin (host half + browser half + a native helper process) that tells the
user a session needs them, on top of every other window.

## What it watches

`ctx.uiSession.sessionStatus` → per-session `pendingInteraction`:

| kind | meaning |
| --- | --- |
| `approval` | a tool waits for allow/reject |
| `question` | `ask_user_question` waits for a choice or text |
| `plan-review` | `exit_plan_mode` waits for approve/changes |

Plus one transition signal: a session whose `running` goes `true → false`
finished a turn, so it pings as `kind: "done"`. That ping is skipped while the
user is looking at that very session with the window focused, and its card
retires itself after 12 s.

## What it does

1. **Always-on-top card** — a separate `powershell.exe` process runs
   `helper/alert-window.ps1` (WinForms, `WS_EX_TOPMOST`, `ShowWithoutActivation`),
   shown on the primary screen's top-right corner. It never steals focus.
2. **Chime** — two-note Web Audio in the page, unlocked on the first gesture.
3. **In-app card** — `shell.overlay` slot; rendered only when the host window
   is unavailable (non-Windows, route down), so a request never shows two cards.
4. **Windows toast** — fallback when the host route is unreachable.
5. **Repeat** — a still-pending request re-announces itself every 30 s (×3).
6. **Completion ping** — `running: true → false` announces `已完成` once, so a
   reply that lands while the user is elsewhere is not missed.

## Data flow

```
lib/client.js  --POST /attention-notify/notify-->  index.js (host)
       |                                              | writes %TEMP%\dsh-attention-notify\alert.json
       |                                              v
       +-- chime, in-app card                  helper/alert-window.ps1 (polls, shows)
```

The page reaches the host over a **relative** path: a browser hits the local
server directly, and the desktop shell forwards unknown `dsh-app://app` paths to
that same server with its cookie. No port discovery is needed.

## Install

**The plugin package is this skill's own base directory.** The skill tool reports
it as `Base directory for this skill: …`; that directory already contains
`package.json`, `index.js`, `lib/`, and `helper/`, so a skill install needs no
separate clone:

```powershell
dsh plugin --profile desktop add "<the skill base directory>"
```

On fresh machines the repository also ships `install.ps1` / `install.sh`, which
clone into `<DSH_HOME>/skills/dsh-attention-notify`, run that same `dsh plugin
add`, and print the reload step. Prefer them over hand-building the paths.

On Windows the same directory also works from a skills junction. On
macOS/Linux this installs the plugin fine — only the always-on-top card is
missing (see Hard limits).

Check first: `plugin_manager action=list_bundles` — if `dsh-attention-notify`
already lists a row, the plugin is installed and only the reload step applies.
Reinstalling the same package from a different path is what produces
`restart-required` / `package-moved`, so prefer one stable location.

Then reload the host half once (the client half hot-reloads on its own):

```
plugin_manager  action=set_bundle  target=dsh-attention-notify  enabled=false
plugin_manager  action=set_bundle  target=dsh-attention-notify  enabled=true
```

`restart-required` + `package-moved` means the bundle's resolved directory
changed: restart DSH, or remove the bundle before adding it from another path.

Never install the plugin *from a second copy* of these files: two paths with one
package name is the only way to end up with a broken install.

## Verify

1. Headless behavior test (no React, no browser):

   ```powershell
   node tests/render.test.mjs
   ```

2. Host route alive — take the port from `Get-NetTCPConnection -State Listen`
   owned by the `dsh-desktop-host` process:

   ```powershell
   Invoke-WebRequest http://127.0.0.1:<port>/attention-notify/ping
   # {"ok":true,"helper":false}
   ```

3. Real window without waiting for a session:

   ```powershell
   Invoke-WebRequest http://127.0.0.1:<port>/attention-notify/notify -Method POST `
     -ContentType 'text/plain;charset=UTF-8' `
     -Body '{"title":"t","body":"b","kind":"approval","kindLabel":"需要审批","openLabel":"切回 DSH","dismissLabel":"知道了"}'
   # {"ok":true,"helper":true}  — and the card appears top-right
   Invoke-WebRequest http://127.0.0.1:<port>/attention-notify/clear -Method POST -Body '{}'
   ```

4. Confirm `topmost` with `GetWindowLong(hwnd, -20) & 0x8`, and that the DPI code
   ran: the helper logs `dpi=… scale=…` when started with `-LogFile`.

## Troubleshooting

| symptom | cause | fix |
| --- | --- | --- |
| no card at all, `alert.json` never changes | the page is not running this bundle | reload the page. The production desktop build has **no** Reload accelerator (`Ctrl+R` does nothing); quit and reopen DSH. A browser tab just needs `F5`. `F12` opens DevTools: `typeof __DSH_ATTENTION_NOTIFY__` is `"undefined"` when the client half is missing |
| `__DSH_ATTENTION_NOTIFY__.selftest()` resolves `false` | page→host channel down (route missing or wrong origin) | check `GET /attention-notify/ping`; reload the bundle |
| no card, `{"ok":true,"helper":false}` | helper script missing or spawn failed | check `helper/alert-window.ps1` exists; run it by hand with `-LogFile` |
| card appears but is invisible | it was hidden by a later `clear`, or a stale process | kill `powershell` helpers; the host respawns on the next alert |
| text is blurry | process is DPI-unaware, Windows bitmap-scales the window | keep `AttentionDpi::Enable()` first; never create a window before it |
| card is tiny on a 4K screen | scaling not applied | every pixel value must go through `S()` |
| Chinese copy shows as boxes | script lost its ASCII-only rule, or JSON read without `-Encoding UTF8` | keep the `.ps1` ASCII; read the alert with `-Encoding UTF8` |
| route answers 404 | host half not loaded | reload the bundle (see Install) |
| no toast fallback | Windows notifications off / Focus Assist | expected; in-app card remains |

## Tuning

| want | file | symbol |
| --- | --- | --- |
| size, fonts, colors, position | `helper/alert-window.ps1` | `S()`, `$cardWidth`, font sizes |
| repeat cadence / count | `lib/client.js` | `REFRESH_MS`, `MAX_REFRESHES` |
| card lifetime, card count | `lib/client.js` | `CARD_LIFETIME_MS`, `MAX_CARDS` |
| copy (zh/en) | `lib/client.js` | `zh`, `en` dictionaries |

Client changes hot-reload in ~500 ms; `index.js` and `helper/` need a bundle
reload or an app restart.

## Hard limits

- **The always-on-top card is Windows-only.** It is a WinForms window driven by
  `powershell.exe`; the host half skips the spawn on other platforms and the
  route answers `{"ok":true,"helper":false}`, so the page falls back to the OS
  notification. Do not tell a macOS/Linux user they will get a topmost card.
- This skill's own files are platform-neutral: installing it is just a directory
  link (`mklink /J` on Windows, `ln -s` elsewhere).
- Document Picture-in-Picture is **not implemented** by the bundled Electron:
  `requestWindow()` rejects with `InvalidStateError: … Internal error: no window`.
- Host plugins run inside `ELECTRON_RUN_AS_NODE`, so no `BrowserWindow` and no
  `setAlwaysOnTop` — hence the separate helper process.

See [REFERENCE.md](REFERENCE.md) for internals, the wire format, and the full
runtime evidence.
