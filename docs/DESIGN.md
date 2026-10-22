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
wordmark. **Filled on 2026-10-22** from the brand kit at
`C:\Users\Kpier\Documents\brand logos`, brand `daynnight`, built by brandkit
1.41.0. The slot had reserved its space, so nothing moved when they arrived.

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

**Not taken from the kit, yet:** its palette and its typeface. The editor keeps
the tokens in `app/tokens.css` and the system font stacks, and ships no font
file - which is why the third-party notices have no font row. Adopting the
kit's palette and Nunito would make every screen match the brand and change
every screen, so it is the owner's decision rather than something to arrive
with a logo. It is in the roadmap.

## Tokens

All tokens live in `app/tokens.css` and nowhere else. A one-off colour, radius
or duration in a component is a bug. Both themes define the same names, so no
component knows which theme it is in.

### Colour

| Token         | Dark (default) | Light     | Role                                |
| ------------- | -------------- | --------- | ----------------------------------- |
| `--bg`        | `#0a0d14`      | `#f4f6fa` | The window behind everything        |
| `--panel`     | `#111622`      | `#ffffff` | Sidebar, dialogs                    |
| `--panel-2`   | `#171d2b`      | `#eef1f7` | Raised rows, inputs, section bodies |
| `--line`      | `#273044`      | `#d9dfea` | Borders                             |
| `--line-soft` | `#1d2433`      | `#e7ebf3` | Dividers inside a section           |
| `--ink`       | `#e4e8f2`      | `#141821` | Body text                           |
| `--ink-dim`   | `#97a1b8`      | `#525b6d` | Labels, secondary text              |
| `--ink-faint` | `#5f6980`      | `#79839a` | Disabled, placeholder               |
| `--accent`    | `#ffb257`      | `#9a5a00` | Primary: sunrise amber              |
| `--accent-2`  | `#7c6cff`      | `#51389e` | Secondary: dusk violet              |
| `--warn`      | `#ffb454`      | `#8a5200` | Caution                             |
| `--bad`       | `#ff6b6b`      | `#b42020` | Error                               |
| `--ok`        | `#5fe0a8`      | `#0a6b48` | Success                             |

The light accents are the dark ones darkened until they pass 4.5:1 as text on
`--panel`. This is the trap Pixel Galaxy Studio's brand notes already call out:
an accent chosen on a dark background disappears on white, so it gets its own
value rather than a filter.

Every pair in the table is checked for WCAG 2.2 AA at the size it is used:
4.5:1 for body text, 3:1 for large text and for UI component boundaries. The
check is part of the browser test suite, not a one-time review.

### Type

System UI, as Pixel Galaxy Studio does - a wallpaper tool should look like the
operating system it sits on, and shipping a webfont for chrome is weight for
nothing.

```
--font: "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
--font-mono: "Cascadia Mono", ui-monospace, "Consolas", monospace;
```

| Token         | Size / line | Used for                                    |
| ------------- | ----------- | ------------------------------------------- |
| `--text-xs`   | 11px / 1.4  | Hints, metadata, the scrubber's hour labels |
| `--text-sm`   | 12px / 1.45 | Panel labels, values                        |
| `--text-base` | 13px / 1.45 | Body, the default                           |
| `--text-lg`   | 15px / 1.4  | Section headings                            |
| `--text-xl`   | 20px / 1.3  | Dialog titles                               |

Numbers that change as a slider moves - a sun altitude, a time - use
`--font-mono` and tabular figures, so the layout does not jitter.

### Space, radius, shadow, motion

Spacing is a 4px scale: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16,
`--s-5` 24, `--s-6` 32, `--s-7` 48.

Radii: `--r-sm` 4 (inputs, chips), `--r-md` 8 (cards, sections),
`--r-lg` 12 (dialogs), `--r-full` 999 (pills, the scrubber thumb).

Shadows: `--shadow-1` for a raised row, `--shadow-2` for a popover,
`--shadow-3` for a dialog. Dark-theme shadows are near-black and tight; light
theme uses a softer, wider spread, because the same shadow does not read on
both.

Motion: `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms, all on
`--ease` `cubic-bezier(.2,.7,.3,1)`. Every transition is wrapped so that
`prefers-reduced-motion: reduce` removes it, and the setting also damps the
wallpaper's own animation rates (NFR-6).

Breakpoints: the editor is a desktop application and the sidebar is fixed at
360px, as in Pixel Galaxy Studio. Below 900px wide the sidebar becomes a
drawer rather than reflowing - the window can be made small, but it is not a
phone target.

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
