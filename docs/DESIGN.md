# Design

The editor's visual direction, its tokens, and the components it is built from.
The wallpaper itself is not covered here - that is `ARCHITECTURE.md` and the
presets.

## Audience and tone

The same person who uses Pixel Galaxy Studio: someone who enjoys having many
controls and resents being condescended to. So the panel is dense, every control
is reachable, and nothing is hidden behind a "basic / advanced" split. The
writing is plain and specific - "how much haze the air holds, which is what
makes a sunset red rather than orange" rather than "adjust atmospheric
parameters".

Tone rules, carried over from Pixel Galaxy Studio and `Morestuff.txt`:

- **Every control has a hint on its `i`.** No loose explanatory paragraphs in
  the panel. The `i` is the only place extra words live, and a control without
  one is a bug (US-023).
- **Hints say why, not only what.** A hint that restates the label is useless.
- **No exclamation marks, no "Oops", no personality in error text.** Say what
  happened and what to do.

## Visual direction

Pixel Galaxy Studio is a dark-sky tool and reads as night: near-black panels,
cyan and violet. Day and Night is about the **transition** between day and
night, so its palette is the hour either side of the horizon: deep twilight
blue surfaces with a warm amber accent, and a dusk violet as the secondary.
Amber on blue is also the actual colour relationship the product is about,
which makes the chrome and the content agree without the chrome imitating the
content.

The shell layout is deliberately the same as Pixel Galaxy Studio - a fixed
left sidebar of settings, a stage on the right - because the owner maintains
both and muscle memory is worth more than novelty. What differs is the palette,
the stage's time scrubber, and that this application has a light theme.

Unlike Pixel Galaxy Studio, the editor ships **light and dark themes**, toggled
by a sun/moon button in the top bar. Dark is the default. The choice persists,
and `system` follows the Windows theme (see OQ-3 in `PRD.md`).

### Brand slot

The top-left of the sidebar holds the brand lockup: the mark, then the
wordmark. **Filled on 2026-10-22** from the brand kit, brand `daynnight`,
built by brandkit 1.41.0 - and **re-synced on 2026-11-01** at 1.49.0, which is
when it became a `brandkit bundle` rather than four files copied in by hand.
The slot had reserved its space, so nothing moved when they arrived.

The arrangement is the kit's own `template/header.html` rather than a guess:
its `BRAND.md` names the file for each job and says plainly that picking one
that merely looks close is how two applications end up wearing the same brand
differently. The application loads the shipped SVGs rather than setting type in
CSS, so it and the kit cannot drift apart.

Two cuts, swapped by theme rather than recoloured: `wordmark-light.svg` on a
light background and `wordmark-dark.svg` on a dark one. They are different
files in the kit and neither is a filter applied to the other.

**The name is drawn DAYnNIGHT and written Day and Night.** The wordmark divides
it DAY, n, NIGHT and sets the two ends of the word in the two ends of the
palette, which is the product's idea in two colours. Every sentence - this
repository, the licence, the installer, the window title - says Day and Night,
and the images carry that as their alt text, because a screen reader should be
told the name rather than the stylisation. `licenses/TRADEMARKS.md` claims both
and says they are the same name.

**Not taken from the kit, yet:** its palette. The editor keeps the colour
tokens in `app/tokens.css`, which are measured for contrast here rather than
inherited; adopting the kit's palette would change every screen and is the
owner's decision. It is in the roadmap.

**The typeface was taken, on 2026-11-01**, at the owner's instruction, when the
kit was rebuilt at 1.49.0 and the brand's face changed to Jost. See Type
below for what that cost.

## Contrast

NFR-6 names WCAG 2.2 AA, and until 2026-10-24 only the keyboard half of it had
ever been checked. The contrast half failed: `--ink-faint` measured 3.06:1
against the panel, where AA asks for 4.5, and that token draws every hint
marker, the footer and the product name. It is 5.06:1 in the dark theme and
5.05:1 in the light now.

Measured, not chosen. The other text tokens came out at ink 13.7 and 15.7, dim
6.5 and 6.0, accent 9.4 and 4.8 - all passing, which is why only one needed
moving. A browser test walks every piece of text in both themes and applies the
AA thresholds, so dimming a token fails the suite rather than the standard.

## Brand

The brand is **`daynnight`**, from the brand kit (a separate, private
repository). The application set is bundled into `app/brand/`, the README set
into `docs/brand/`, both by `brandkit bundle` and both verified by
`brandkit check`. **Kit 1.56.1**, synced 2026-11-06.

Its design standard is **Material Design 3**, and this product is built to that
and to nothing else. The standard owns shape, spacing, the type scale,
elevation, motion, layout and how a control behaves; the brand keeps its
colours, its mark and its display face. `app/brand/BRAND.md` has the rules as
the kit applies them, and they are not restated here - a second copy is a
second thing to fall out of date.

The kit is at 1.56.1 and the rollout named 1.56.0; the patch between them was
reproducibility in the library's own CI (LF line endings in `dist/`, a named
text-layout engine, a dated `BRAND.md`) and changed nothing about this brand's
design. The version recorded is the one actually synced from.

**This product's recorded departure** is the palette: the colours below are
its own, measured for contrast here rather than inherited from the brand's.
That is deliberate and predates the standard, which does not own colour
anyway.

## Tokens

Colours live in `app/tokens.css` and nowhere else. Everything that is not a
colour - radius, spacing, the type scale, elevation, motion, the shell's
sizes - comes from the brand kit's `brand/template/tokens.css` and is the
standard's. **Never retype a number the standard supplies.** A one-off colour,
radius or duration in a component is a bug. Both themes define the same names,
so no component knows which theme it is in.

### Colour

| Token         | Dark (default) | Light     | Role                                 |
| ------------- | -------------- | --------- | ------------------------------------ |
| `--bg`        | `#0a0d14`      | `#f4f6fa` | The window behind everything         |
| `--panel`     | `#111622`      | `#ffffff` | Sidebar, dialogs                     |
| `--panel-2`   | `#171d2b`      | `#eef1f7` | Raised rows, inputs, section bodies  |
| `--line`      | `#273044`      | `#d9dfea` | Borders                              |
| `--line-soft` | `#1d2433`      | `#e7ebf3` | Dividers inside a section            |
| `--ink`       | `#e4e8f2`      | `#141821` | Body text                            |
| `--ink-dim`   | `#97a1b8`      | `#525b6d` | Labels, secondary text               |
| `--ink-faint` | `#848da1`      | `#5d6778` | The faintest text that is still text |
| `--accent`    | `#ffb257`      | `#9a5a00` | Primary: sunrise amber               |
| `--accent-2`  | `#7c6cff`      | `#51389e` | Secondary: dusk violet               |
| `--warn`      | `#ffb454`      | `#8a5200` | Caution                              |
| `--bad`       | `#ff6b6b`      | `#b42020` | Error                                |
| `--ok`        | `#5fe0a8`      | `#0a6b48` | Success                              |

The light accents are the dark ones darkened until they pass 4.5:1 as text on
`--panel`. This is the trap Pixel Galaxy Studio's brand notes already call out:
an accent chosen on a dark background disappears on white, so it gets its own
value rather than a filter.

Every pair in the table is checked for WCAG 2.2 AA at the size it is used:
4.5:1 for body text, 3:1 for large text and for UI component boundaries. The
check is part of the browser test suite, not a one-time review.

### Type

**Two faces: the brand is _named_ in Jost and _read_ in Public Sans.** Both
come from the brand kit. They replaced the system stack on 2026-11-01 at the
owner's instruction, and the split arrived with the kit's 1.55.0 rebuild on
2026-11-04.

The old decision was that a wallpaper tool should look like the operating
system it sits on and that shipping a webfont for chrome is weight for nothing.
Both were true and the brand won anyway, because a product whose editor is set
in Segoe and whose wordmark is drawn in Jost is a product with two typefaces -
the wrong two. The cost is 112 KB of `.woff` in the installer and the only
third-party licences in the product that are not MIT (SIL OFL 1.1 for each;
`licenses/THIRD-PARTY-NOTICES.md` works through the two clauses that matter to
a paid product).

**Which face does which job is not decided here either.** Jost is a geometric
display face: it draws the name beautifully and sets a paragraph badly, which
is exactly the mistake an application makes when it has one brand font and
reaches for it everywhere. The brand definition records the split, so this
project spends it rather than deciding it:

| Token            | Face             | Where                                            |
| ---------------- | ---------------- | ------------------------------------------------ |
| `--font-display` | Jost             | the panel's section headings, the reader's title |
| `--font`         | Public Sans      | body, labels, values, hints - everything read    |
| `--font-mono`    | the system stack | `var(--mono)`, aliased; no file ships for it     |

The wordmark is not in that table: it is a drawn SVG, not type.

**No family and no file is named in this project's CSS.** `app/styles.css`
imports the kit's own two sheets - `brand/template/fonts.css`, which declares
both faces and points at the files in `brand/font/`, and
`brand/template/tokens.css`, which carries `--font` and `--font-display`.
Writing either in `app/tokens.css` as well would be a second place that
decision lives, and the place it would be wrong. `app/brand/BRAND.md` asks for
exactly this.

The kit's token sheet carries more than type, so it is imported into a CSS
layer _underneath_ this project's own tokens: every value measured here - the
radii, the spacing step, the shadows - wins whatever the selector weight.
Without the layer the kit's `:root:not([data-theme="light"])` dark block would
outweigh our plain `:root` and silently replace the shadows.

A browser test pins the mapping, not just the tokens: a heading computes to
Jost, a label computes to Public Sans, and both `.woff` files reach
`document.fonts`. Swapping the two would satisfy any check that only looked at
the tokens, and would put a logo face in every sentence.

The scale is the standard's, from `brand/template/tokens.css`. This project
used to keep five steps of its own - 11, 12, 13, 15 and 20 - which is finer at
the small end than Material's, so the two smallest collapsed onto one when they
were mapped across on 2026-11-06.

| Token       | Size | Used for                                              |
| ----------- | ---- | ----------------------------------------------------- |
| `--fs-xs`   | 12px | Hints, metadata, labels, values, the scrubber's hours |
| `--fs-sm`   | 14px | Body, the default                                     |
| `--fs-md`   | 16px | Section headings                                      |
| `--fs-lg`   | 22px | Dialog titles                                         |
| `--lh-body` | 1.5  | The body line height                                  |

Headings are medium weight (500), not bold: the standard asks for it, and a
display face is already heavy enough to carry a heading at 500.

Numbers that change as a slider moves - a sun altitude, a time - use
`--font-mono` and tabular figures, so the layout does not jitter.

### Space, radius, shadow, motion

All of this is the standard's, and none of it is set here. The values are in
`brand/template/tokens.css`; what follows is what this product uses them for.

Spacing is a 4px scale, `--s-1` to `--s-8`. It happens to be the same scale
this project had already chosen, so nothing moved when it stopped being ours.

Radii come from Material's corner scale and nothing else: `--r-xs` 4 (fields),
`--r-sm` 8, `--r-md` 12 (cards, tiles, sections), `--r-lg` 16, `--r-xl` 28
(dialogs), `--r-pill` (buttons, the scrubber thumb). They were 4, 8 and 12
before, which is the scale shifted by one step - near enough to look like a
mistake and far enough to be one.

Shadows: `--shadow-1` to `--shadow-3`, two-layer and heavier on a dark
surface. **A card at rest has none** - it is outlined and flat, and elevation
is for things that float. That is why the look gallery's tiles lost their
inset ring.

Controls: `--control-h` 40 (a button, fully rounded), `--field-h` 56 (a field,
outlined, focus thickening the outline rather than adding a glow), `--target`
48 for anything pressed even where it is drawn smaller. The small buttons and
the hint dots carry that target as their own hit area, so the rows stay dense
without the targets shrinking.

State is a wash of the content colour over the container: `--state-hover` 8%,
`--state-press` 10%. Not a different background, and not a brightness filter,
which is what this product's buttons used to do.

Motion: `--t-fast` 100ms and `--t-med` 250ms on `--ease`
`cubic-bezier(.2,0,0,1)`, with `--ease-emphasized` for things that enter.
`prefers-reduced-motion: reduce` is honoured by the kit's own sheet, and the
setting also damps the wallpaper's own animation rates (NFR-6).

Layout: the sidebar is `--sidebar-w`, the standard's 280px drawer, where it was 360. Below 900px wide it becomes an overlay drawer rather than reflowing - the
window can be made small, but it is not a phone target.

## Components

Each one has every state designed: rest, hover, focus-visible, active,
disabled, and - where it loads or validates - pending, empty and error.

| Component                 | Notes                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section** (`<details>`) | A collapsible band of rows, as in Pixel Galaxy Studio. Remembers open state. One "collapse all" control in the top bar.                                                       |
| **Row**                   | Label on the left with its `i`, control on the right, optional value readout. `half: true` rows pair up. The schema's unit of layout.                                         |
| **Range**                 | Slider with a numeric readout; drag folds into one undo step (US-024). Shift for fine, double-click to reset to default.                                                      |
| **Select, Number, Check** | Native controls, restyled, keyboard-native.                                                                                                                                   |
| **Colour and swatches**   | A grade's colour stops. A swatch row is a small palette the user can extend.                                                                                                  |
| **Info dot (`i`)**        | The hint carrier. Hover, focus and touch all open it; `Escape` closes. The only place long text lives.                                                                        |
| **Time scrubber**         | The stage's main control. Described below.                                                                                                                                    |
| **Place picker**          | Time-zone guess, searchable city list, manual latitude and longitude, and an explicit "look it up" button that is the only thing in the application that touches the network. |
| **Monitor layout**        | Draggable screen rectangles, ported from Pixel Galaxy Studio's `ui/monitors.js`.                                                                                              |
| **Theme toggle**          | A sun/moon icon button in the top bar. Three states: light, dark, follow system.                                                                                              |
| **Dialog**                | Focus trapped, returns focus on close, `Escape` closes, scrim click closes unless there are unsaved edits.                                                                    |
| **Toast**                 | For things that happened without the user asking - a monitor arriving, a context lost and restored. Never for errors that need a decision.                                    |

### The time scrubber

The one component with no equivalent in Pixel Galaxy Studio, and the heart of
authoring, because a preset is authored across all of time (US-020).

It is a 24-hour horizontal track for the selected date and place, with the
day's actual shape drawn into it as bands: night, astronomical, nautical and
civil twilight, and day, each in the colour the sky will actually be at that
moment. Sunrise and sunset are marked. So the scrubber is simultaneously the
control and a summary of the day - a glance says "this is a late-December day
in Denver, and here is where the good light is".

Around it:

- A date picker, because the day's shape changes with the season.
- `Now` to snap back to real time, which is the default state.
- Play / pause, and a fast-forward that runs a whole day in about thirty
  seconds.
- A live readout: local time, sun altitude and azimuth, moon phase. Monospace,
  tabular, so nothing shifts.

The bands redraw when the date, the place or the preset changes. They are
rendered by the same engine that renders the sky - sampled at a few hundred
instants - so the scrubber cannot disagree with the preview.

## Layout and navigation

```
+-------------------+------------------------------------------+
| brand slot (empty)|  stage bar: scrubber, date, now, play,   |
+-------------------+  fast-forward, readout, zoom, screen,    |
| top bar           |  full screen, help                       |
| save load reset   +------------------------------------------+
| undo redo collapse|                                          |
| theme             |            live preview                  |
+-------------------+                                          |
|                   |                                          |
|  sections         |                                          |
|   Place           |                                          |
|   Sky             |                                          |
|   Sun and moon    |                                          |
|   Stars           |                                          |
|   Grade           |                                          |
|   Screens         |                                          |
|   Performance     |                                          |
|                   +------------------------------------------+
|                   |  notes / build state                     |
+-------------------+------------------------------------------+
| wallpaper on/off  |                                          |
| footer: wordmark  |                                          |
+-------------------+------------------------------------------+
```

There is no navigation to speak of: one screen, one stage, sections that
collapse. A dialog is only ever for Save, Load, Share, About, the guide, and
first run.

The one addition over Pixel Galaxy Studio's shell is the **wallpaper toggle**
pinned above the footer: a clear statement of whether this is currently on the
desktop, and on which screens, because that is the question a user will have
most often and it should never require hunting.

## Key flows

1. **First run.** Welcome dialog over a sky that is already running at the real
   local time. Three steps: confirm where you are, pick a preset, turn the
   wallpaper on. Nothing is mandatory; dismissing it leaves a working default.
2. **Authoring.** Pick a date and scrub to the hour in question, adjust, scrub
   on. Fast-forward a whole day before saving, which is the only way to catch a
   transition that is wrong.
3. **Setting the location.** Offered the time-zone guess first, since it is
   free and usually within a few hundred kilometres. The city picker is the
   usual path. The network lookup is a button nobody has to press.
4. **Turning it on.** One toggle. The editor then says which screens are
   covered and which host mode is active (WorkerW, or the degraded fallback).

## Writing guidelines

- **Labels** are nouns or short noun phrases, sentence case, no colon:
  "Haze", "Star glow", "Moon brightness".
- **Hints** are one or two sentences, ending in a full stop, and say what the
  control does and when a user would reach for it.
- **Errors** name what happened, then what to do: "No WorkerW window was found,
  so the wallpaper is running in front of the desktop wallpaper instead.
  Restarting Explorer usually fixes it."
- **Numbers** are formatted with `Intl`: degrees to one decimal, times in the
  user's locale and 12- or 24-hour preference, dates spelled out rather than
  numeric.
- **Never** "simply", "just", "easy", or "Oops".
