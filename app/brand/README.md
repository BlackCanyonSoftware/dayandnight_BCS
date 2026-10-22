# Brand assets

Copied from the brand kit, not drawn here. The kit at
`C:\Users\Kpier\Documents\brand logos` is the source of truth; these files came
from `dist/daynnight/`, built by **brandkit 1.41.0 on 2026-10-21** from
`brands/daynnight/brand.toml`.

Do not edit them. A change belongs in the brand definition, followed by
`python -m brandkit build` and a fresh copy, because the kit's `BRAND.md` is
generated from the same build that writes the files and is the only thing that
can be trusted to name them correctly.

| File                      | Used for                                                  |
| ------------------------- | --------------------------------------------------------- |
| `mark.svg`                | The symbol, top-left of the sidebar                       |
| `wordmark-light.svg`      | The name beside it, on a light background                 |
| `wordmark-dark.svg`       | The name beside it, on a dark background                  |
| `wordmark-mono-white.svg` | A single-colour cut, for anywhere colour will not survive |

The wordmark is a shipped SVG rather than type set in CSS, so the application
and the brand kit cannot drift apart. The kit says the same thing about its
font: load its stylesheet rather than naming the family, because the face a
brand is set in is a decision recorded in its definition.

The Windows application icon is the same brand's `icon/favicon.ico` and
`icon/icon-logo-1024.png`, copied to `desktop/build/` where
`electron-builder.yml` expects them.

## The name

The brand is drawn as **DAYnNIGHT**: the kit divides it `DAY` + `n` + `NIGHT`,
and the two-tone cut sets DAY in the sunset orange and NIGHT in the midnight
blue, which is the product's whole idea in two colours.

Everything written in prose - this repository, the licence, the EULA, the
installer's product name, the window title - says **Day and Night**. The
stylisation is the wordmark's; the name is the words. `licenses/TRADEMARKS.md`
names both, so there is one place that says they are the same thing.

## What is not taken from the kit

The kit also ships a palette, a font (Nunito) and a UI icon set. The editor
currently uses its own tokens in `app/tokens.css` and the system font stacks,
and ships no font file at all - which is why
`licenses/THIRD-PARTY-NOTICES.md` has no font row.

Adopting the kit's palette and type is a real improvement and a visible change
to every screen, so it is a decision for the owner rather than something to
slide in with a logo. It is in the roadmap.
