# Licences and notices

Everything legal about Day and Night lives in this folder, so nothing has to be
hunted for and nothing ships without it. The shape is the same as Pixel Galaxy
Studio's, deliberately: see [ADR 0006](../docs/adr/0006-proprietary-licence-and-nsis-installer.md)
for why, and for what was changed rather than copied.

| File                                             | What it is                                                                          | Who reads it                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [SOURCE-LICENSE.md](SOURCE-LICENSE.md)           | The terms this repository is under: all rights reserved, no permission to copy.     | Anyone who finds the repository.                              |
| [EULA.md](EULA.md)                               | The licence the person who installs a released build receives.                      | Every customer. The store shows it; the application shows it. |
| [DISCLAIMER.md](DISCLAIMER.md)                   | Warranty, the screen it runs on all day, the astronomy, and the desktop technique.  | Customers. Part of the EULA by reference.                     |
| [PRIVACY.md](PRIVACY.md)                         | What the application collects, which is nothing, and where your location is kept.   | Customers. The store page links to it.                        |
| [TRADEMARKS.md](TRADEMARKS.md)                   | Our names and marks, and other people's.                                            | Anyone using the brand, in or out of the company.             |
| [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) | Every piece of someone else's work in the product or its tooling, with its licence. | Customers (shipped with the build); contributors (keep true). |
| [third-party/](third-party/)                     | The full text of each third-party licence.                                          | Shipped with the build.                                       |

## Which applies where

- **The repository.** `SOURCE-LICENSE.md`. The root `LICENSE` file is a short
  pointer to it, kept at the root because that is where GitHub and package tools
  look.
- **A released build.** `EULA.md`, `DISCLAIMER.md`, `PRIVACY.md`,
  `THIRD-PARTY-NOTICES.md` and `third-party/` are copied into the build
  unchanged, by the `extraResources` rule in `electron-builder.yml`.
  `desktop/build/check-bundle.js` fails the build if any of them is missing, so
  a build without them cannot be produced, let alone released.
- **The brand** (the name, and the wordmarks when they exist): `TRADEMARKS.md`.
  The marks are not under any of the software licences above.
- **What a customer makes.** Preset files belong to the person who made them.
  The EULA says so in one sentence, on purpose.

## Before the first release

Four things in these documents are marked `[[ like this ]]` because only the
owner can decide or supply them:

1. The legal name and form of the publisher (sole trader, LLC, ...).
2. Governing law and venue.
3. The support address.
4. Whether any mark is registered.

Then a lawyer reads `EULA.md` and `DISCLAIMER.md` once. They are written in
plain language to be reviewed cheaply, not to replace the review. Nothing in
this folder is legal advice.

One more thing is deliberately absent until it is real:

- **No store is named.** The documents say "the store you got it from" because
  the distribution channel for v1 is a downloadable Windows installer and
  nothing else. A Steam release adds a paragraph to `EULA.md` section 1 for the
  Steam Subscriber Agreement, a Steam paragraph to `PRIVACY.md`, and the
  Steamworks SDK to `THIRD-PARTY-NOTICES.md`; Pixel Galaxy Studio's copies of
  all three are the model.

The brand assets are real now. `app/brand/` is a `brandkit bundle` - the mark,
the wordmarks, the icons and the typeface - so `TRADEMARKS.md` claims the drawn
marks as well as the words, and the font it brings with it is the only
third-party licence in the product that is not MIT. Re-running `bundle` after a
brand change can change the font: check `THIRD-PARTY-NOTICES.md` still names
the right one.

## Adding a third-party component

1. **Check the licence first.** Permissive licences (MIT, BSD, ISC, Apache-2.0,
   OFL, CC0, public domain) are fine. Copyleft licences (GPL, LGPL, AGPL,
   CC BY-SA, and MPL for any file we change) are not added without the owner's
   decision, because they can reach the proprietary code. A component with no
   licence at all is not used.
2. Keep the licence text next to the component and copy it into `third-party/`
   under `name.LICENCE-ID.txt`.
3. Add a row to `THIRD-PARTY-NOTICES.md`: shipped or development-only, version,
   licence, copyright holder.
4. If it ships, add it to `REQUIRED` in `desktop/build/check-bundle.js`, so a
   build that drops its licence text fails instead of shipping.
5. Say so in the pull request. The notices file is part of the review.

Development dependencies (`package.json`) are listed there too, in their own
table, so the difference between "in the product" and "used to build it" is
always visible.
