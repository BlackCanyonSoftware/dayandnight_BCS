# Brand assets

**This folder is deliberately empty.** The owner is supplying the mark and
wordmark.

The editor's sidebar reserves the top-left brand slot and holds its space, so
the layout will not move when the assets arrive. See the "Brand slot" section
of [`../../docs/DESIGN.md`](../../docs/DESIGN.md).

## What belongs here

Following Pixel Galaxy Studio's arrangement:

| File                       | Used for                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `mark-256.png`             | The square mark, top-left of the sidebar                           |
| `wordmark.svg`             | The full wordmark beside the mark                                  |
| `wordmark-plain.svg`       | A flat, single-colour wordmark for the footer and the About window |
| `blackcanyon-wordmark.svg` | The company wordmark, for the footer                               |
| `favicon.png`              | The window icon                                                    |

The wordmark is loaded as a shipped SVG rather than set as type in CSS, so that
the application and the brand kit cannot drift apart.

## Where they come from

The brand kit at `C:\Users\Kpier\Documents\brand logos` is the source of truth.
These assets should be generated from a `dayandnight-bcs` brand definition
there (`brands/dayandnight-bcs/brand.toml`) with `python -m brandkit build`,
and copied in - not drawn by hand in this repository.

That brand does not exist in the kit yet.
