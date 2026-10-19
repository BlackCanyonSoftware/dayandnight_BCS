# ADR 0001 - Electron shell around a static web app

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** owner, tech lead

## Context

Day and Night needs two things on screen: an editor where a preset is authored,
and a rendering surface that sits on the Windows desktop behind the icons and
runs around the clock. The owner has already shipped Pixel Galaxy Studio, an
Electron application wrapping a static ES-module web app with no build step,
and maintains it. Whatever is chosen here is maintained alongside that.

The hard constraint is the performance budget (NFR-1): this process runs 24
hours a day, so a shell with a large resident cost is a real objection, not a
stylistic one.

## Options considered

1. **Electron around a static web app, rendering with WebGL2.** One codebase.
   The editor's preview and the wallpaper import the same renderer, so preview
   is WYSIWYG by construction rather than by discipline. The editor UI from
   Pixel Galaxy Studio ports across. Resident cost is roughly 150-250 MB and
   Chromium's power profile, mitigated by the pause policy and low frame rates.

2. **Native wallpaper host (Rust + wgpu, or C++ + D3D11) with an Electron
   editor.** Best resident cost, around 20-40 MB, and the best battery
   behaviour. But the renderer exists twice, or once in a shader language that
   has to be cross-compiled, and the promise that the preview matches the
   wallpaper becomes something to maintain rather than something that is
   structurally true. Roughly double the work for the first release.

3. **Ship as a Wallpaper Engine web wallpaper.** Fastest route to a working
   product: Wallpaper Engine already handles WorkerW, multi-monitor and
   pause-on-fullscreen, and brings an audience. But it makes a paid third-party
   application a hard dependency, and the editor-to-wallpaper handoff is
   someone else's to design.

4. **System WebView2 instead of Electron.** Lighter than Electron, already on
   the machine. Rejected: much less control over the swap chain and the window,
   the reparenting story is worse, and WebView2 has historically lagged on the
   graphics features this needs.

## Decision

**Option 1.** Electron around a static ES-module web app, no build step, with
the scene rendered in WebGL2 (ADR 0003).

Electron is pinned at the current stable major (44 at the time of writing)
rather than matching Pixel Galaxy Studio's 33: this is a new project and there
is no reason to start behind.

The renderer is written as a self-contained module (`app/engine/`) behind a
deliberately narrow host interface - it is handed a preset, a timestamp, a
location and a crop rectangle, and it draws a frame - with no reference to
Electron, the DOM or the desktop. That keeps option 2 genuinely available
later: a native host would reimplement the shell, not the sky.

## Consequences

**Good.**

- One codebase, one language, one set of conventions, shared with the owner's
  other application.
- The preview cannot drift from the wallpaper, because they are the same code
  running against the same pure function.
- The editor UI, settings documents, migrations, undo, presets and monitor
  layout all port from Pixel Galaxy Studio instead of being invented.
- No build step: a file on disk is the file that runs.

**Bad, and accepted.**

- A resident cost in the hundreds of megabytes for a wallpaper, which is a real
  criticism of the product and is answered only by the pause policy actually
  working.
- Chromium's power behaviour is less predictable than a native loop, especially
  on battery, which is why battery defaults to stopping rather than reducing.

**Mitigations, which are commitments, not intentions.**

- NFR-1 is measured at Milestone 0, before any art is built, and written into
  `ARCHITECTURE.md` with the machine and the method. If it fails there, this
  decision reopens while it is still cheap to change.
- The pause policy is treated as load-bearing architecture, not polish, and is
  partly implemented in Milestone 0.
- The engine's host interface stays narrow, and architecture invariants 1 and 2
  (pure function, no DOM or Electron in the engine) are enforced in review, so
  that a native host remains a swap rather than a rewrite.
