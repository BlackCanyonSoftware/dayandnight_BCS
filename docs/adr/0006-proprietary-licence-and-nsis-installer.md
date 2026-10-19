# ADR 0006 - Proprietary, documented like Pixel Galaxy Studio, shipped as a Windows installer

- **Status:** accepted
- **Date:** 2026-10-19
- **Deciders:** owner (OQ-4)

## Context

OQ-4 in the PRD asked one question in two halves: the same EULA and installer
shape as Pixel Galaxy Studio, or different? It blocked Milestone 2, because the
packaging work has to know what it is packaging and the About window has to know
what it is showing.

What the project had: an empty `licenses/` directory, no `LICENSE` file,
`"license": "UNLICENSED"` in `package.json`, and a `build` script that invoked
`electron-builder` with no configuration anywhere to drive it. ADR 0002 had also
already committed to a `licenses/THIRD-PARTY-NOTICES.md` entry for koffi "in the
commit that installs it", and that promise was unkept - the first thing this
decision had to repair.

What Pixel Galaxy Studio has, and therefore what "the same" means: a short root
`LICENSE` that points into `licenses/`, which holds seven documents - a source
licence (all rights reserved), an EULA, disclaimers, a privacy notice, a
trademarks notice, third-party notices, and the full text of every third-party
licence. Plus its own README documenting which document applies where and the
rule that a new dependency is listed in the same commit that adds it. Four
items in it are marked `[[ like this ]]` because only the owner can supply them,
and they are still unsupplied, so PGS has not shipped either.

The two products are not identical, and the differences all run one way: Day and
Night is **smaller legally and riskier technically**. It exports no video, so
PGS's video-format and codec-patent clauses have no subject. It bundles no
fonts, so there is no OFL obligation. But it runs 24 hours a day on somebody's
screen, it computes real astronomy that a user might be tempted to rely on, and
it draws itself by reaching into an undocumented part of Windows.

## Decision

**Licensing: the same shape as Pixel Galaxy Studio, adapted rather than
copied.** Proprietary, all rights reserved, with a build licensed to the person
who installs it. The same seven documents in `licenses/`, the same root pointer,
`"license": "SEE LICENSE IN LICENSE"`.

**Distribution: a Windows NSIS installer, and nothing else in v1.** Not
one-click, so the user chooses the directory. No auto-update. Signing from
environment variables only.

## What was changed rather than copied

Keeping the shape is the cheap part; the documents are only worth anything if
they describe this product. Three sections of `DISCLAIMER.md` exist because of
what Day and Night is, and they are the reason this was not a copy:

1. **A picture that stays on a screen.** The product's own efficiency argument
   is that the sky is nearly still and so rarely needs redrawing - which is the
   same sentence as "a static bright shape may sit in one place for hours". On
   OLED and plasma that is an image-retention risk. The disclaimer says which
   pause signals exist, and says plainly that the Software does not decide when
   the screen turns off and does not shift or dim the picture to protect one.
2. **The astronomy is decoration, not an instrument.** This one matters most.
   The product's claim to exist is that the sky is the real sky, which invites
   exactly the reliance that has to be disclaimed: no navigation, no aviation or
   marine use, no timing of observance. It also states the four ways the picture
   is knowingly not your sky - a sea-level unobstructed horizon, no weather, the
   computer's own clock, and a location that may be a time zone's guess.
3. **The desktop technique is undocumented.** ADR 0002 treats WorkerW
   reparenting as a risk rather than a certainty, and a customer document that
   did not say so would be hiding the one thing most likely to break. It names
   what can break it and says what happens then: a visible window rather than a
   blank desktop.

Dropped: the video-format and codec clauses, the generated-imagery section about
photographs, the font notice, and every Steam-specific paragraph - a store
release adds those back, and PGS's copies are the model. Reduced: the
flashing-imagery health notice is still there, because twinkle and glare are
adjustable, but scaled to what the controls can actually do.

`licenses/THIRD-PARTY-NOTICES.md` also does something PGS's does not: it states
where the city list came from. It was typed by hand rather than taken from a
gazetteer, which is a licensing fact as much as an accuracy one, and it is the
kind of thing that becomes unanswerable a year later.

## The installer, and the one new risk

Day and Night ships a native module and Pixel Galaxy Studio never has. koffi's
binary arrives prebuilt and platform-selected (`@koromix/koffi-win32-x64`), and
it is a Node-API addon, so there is no compiler step and no `electron-rebuild` -
that part is easier than feared. But **a native module cannot be loaded from
inside an asar archive**, so `asarUnpack` has to match it.

The failure mode is nasty: the installer builds, the application installs and
starts, and then cannot find the desktop - the entire product, gone, on
somebody else's machine. So `desktop/build/check-bundle.js` asserts that a
`.node` file exists under `resources/app.asar.unpacked`, by walking the
directory rather than matching a path, so a koffi upgrade that moves the binary
still passes while a packaging change that loses it fails the build. The hook
does the same for the legal documents, as PGS's does.

## Options considered

**For licensing:**

1. **Mirror Pixel Galaxy Studio (chosen).** The documents already exist, are
   written in plain language to be reviewed cheaply, and carry a process for
   adding dependencies. Reuse keeps one legal review covering two products and
   makes a second review of this one a comparison rather than a reading.
2. **Open source it (MIT or Apache-2.0).** One file, no kit, and the repository
   becomes shareable. Rejected: it gives up selling the product and it diverges
   from the company's only precedent for no gain the owner wants.
3. **Source-available (PolyForm Noncommercial, BSL).** Readable but not
   commercially usable. Rejected: more legal surface than either alternative, no
   precedent here, and it still needs the same review.
4. **Defer past Milestone 2.** Rejected: it leaves ADR 0002's notices promise
   unkept, and the packaging work would be done twice - once without documents
   to bundle and again once there were.

**For distribution:**

1. **Windows NSIS installer (chosen).** Matches the Windows-only scope, gives an
   uninstaller and a place to register autostart (OQ-1), and is the shape
   `electron-builder.yml` already describes for PGS.
2. **Portable zip.** Cheapest, but no autostart registration, no uninstaller,
   and the worst SmartScreen friction - wrong for something that must survive a
   reboot.
3. **Microsoft Store (MSIX).** The Store handles updates, payment and showing
   the EULA, which is genuinely attractive. Rejected for v1 on a technical
   risk, not a commercial one: a packaged Store application runs under
   restrictions that sit badly with `SetParent` into Explorer's window tree, so
   the core technique may simply not work. Worth proving separately before any
   plan depends on it.
4. **Steam first**, as the PGS kit assumes. Deferred rather than rejected: it
   brings an audience and supplies its own updater, but a wallpaper that needs
   to start at login sits awkwardly inside a game launcher's model, and it is a
   second channel rather than a replacement for the first.

## Consequences

- The four `[[ ]]` placeholders are inherited, not resolved: publisher legal
  name and form, governing law and venue, support address, and whether any mark
  is registered. They do not block Milestone 2 and they do block a release. The
  roadmap carries them.
- **A build made today is not releasable**, for a reason unrelated to licensing:
  there is no icon. `app/brand/` is empty by design awaiting the owner's logo,
  so `win.icon` is deliberately absent from `electron-builder.yml` and a build
  carries Electron's default. That is recorded in the roadmap rather than
  papered over with a placeholder graphic.
- No auto-update means a user who installs v1 stays on v1 until they download
  the next one. Acceptable now; a decision to revisit when there is a second
  version to ship.
- An unsigned installer earns a SmartScreen warning. The configuration takes a
  certificate from the environment and never from the repository, so signing is
  a release-time step rather than a code change.
- The notices file is now part of the review for every dependency change, which
  is a small, permanent tax on adding one. That is the intended effect.
