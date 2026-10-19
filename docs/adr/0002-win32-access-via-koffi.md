# ADR 0002 - Win32 access through koffi, behind one module

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** owner, tech lead

## Context

Putting a window behind the desktop icons on Windows cannot be done from
Electron's own API. It needs a specific sequence of Win32 calls:

| Call                                        | Why                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `FindWindowW("Progman", null)`              | Find the Explorer desktop window.                                                                            |
| `SendMessageTimeoutW(progman, 0x052C, ...)` | Ask Explorer to spawn a `WorkerW` behind the icon layer.                                                     |
| `EnumWindows` + `FindWindowExW`             | Find the `WorkerW` with no `SHELLDLL_DefView` child - the one behind the icons rather than in front of them. |
| `SetParent(ourWindow, workerW)`             | Reparent our window into it.                                                                                 |
| `SHQueryUserNotificationState`              | Detect a full-screen or exclusive-mode application, for the pause policy.                                    |

That is the whole list. Five calls, no callbacks into our code except
`EnumWindows`, no long-lived native objects, no performance sensitivity - the
reparenting happens once per window, and the notification state is polled a few
times a minute.

Electron also needs the native window handle to pass to `SetParent`, which
`BrowserWindow.getNativeWindowHandle()` provides.

## Options considered

1. **koffi.** A maintained FFI for Node and Electron, MIT licensed, by Niels
   Martignène. Verified at decision time as `koffi@3.3.3`, MIT, repository
   `github.com/Koromix/koffi`. Ships prebuilt binaries for Electron ABIs, so
   consumers need no compiler. Declaring the five signatures is perhaps forty
   lines.

2. **A hand-written N-API addon.** Total control, no runtime FFI layer, the
   smallest possible surface, and the fastest - neither of which this needs.
   Costs a C++ source file, `node-gyp`, a build toolchain in CI, and a
   prebuild-per-Electron-version story. It also puts a compile step into a
   project whose stated virtue is not having one.

3. **`node-ffi-napi`.** The historical choice. Rejected: effectively
   unmaintained, and a 24/7 process is the wrong place for an unmaintained
   native dependency.

4. **Shelling out to PowerShell with `Add-Type`.** No dependency at all.
   Rejected: spawning a PowerShell process to poll the notification state
   several times a minute is worse than the dependency, start-up is slow enough
   to be visible against NFR-4, and the user's execution policy can refuse it
   outright. (The owner's own environment has PowerShell 5.1 at `Restricted`,
   which would break this on the developer's machine first.)

## Decision

**Option 1, koffi**, with every call confined to `desktop/host-win32.js`.

No other module in the project may call Win32 (architecture invariant 8). The
module exposes intent, not mechanism:

```js
attachToDesktop(hwnd) -> "workerw" | "fallback"
detachFromDesktop(hwnd)
userNotificationState() -> "normal" | "fullscreen" | "d3d" | "presentation" | "busy"
```

Everything above it is written against those three functions, so option 2
remains a drop-in replacement: swap the module's body, keep its exports, change
nothing else.

## Consequences

**Good.**

- Forty lines of declarations instead of a C++ build step, and the project keeps
  its no-build-step property for everything the user actually edits.
- MIT, actively maintained, prebuilt for Electron, so `npm install` needs no
  compiler on a contributor's machine.
- The blast radius of the dependency is one file with three exported functions.

**Bad, and accepted.**

- A native dependency that has to be rebuilt or re-matched when Electron's ABI
  moves, which is a real maintenance tax at every Electron major.
- `electron-builder` has to be told to unpack the native binary from the ASAR
  archive, which is a packaging detail that will be got wrong once.
- An FFI mistake crashes the process rather than throwing, so the signatures
  need care and a test that exercises each one.

**Commitments.**

- Milestone 0 proves the whole sequence on real hardware. If koffi turns out to
  be awkward against the current Electron, option 2 is implemented behind the
  same three exports and this ADR is superseded rather than amended.
- `attachToDesktop` returning `"fallback"` is a supported, documented degraded
  mode - a bottom-most desktop-level window - not a failure. The editor says
  which mode is active, so a future Windows change is a visible bug rather than
  a blank desktop.
- The exact package name, version, publisher and licence were verified before
  installation, and go in `licenses/THIRD-PARTY-NOTICES.md` in the commit that
  adds the dependency.
