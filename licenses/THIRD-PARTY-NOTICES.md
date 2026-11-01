# Third-party notices

Day and Night contains, or is built with, the work of others. This file lists
all of it. The full licence texts are in `third-party/`.

This file ships with every released build, and
`desktop/build/check-bundle.js` fails the build if it or any of the licence
texts is missing. If a component is added or removed, this file changes in the
same commit (`README.md` in this folder says how).

## Shipped in the product

These are in the running application and reach every customer.

| Component                | Where                                          | Version       | Licence                                                                                                                                | Copyright                                                                |
| ------------------------ | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| koffi                    | `desktop/host-win32.js` calls into it          | 3.3.3         | MIT ([text](third-party/koffi.MIT.txt))                                                                                                | Copyright (C) 2026 Niels Martignène                                      |
| @koromix/koffi-win32-x64 | koffi's prebuilt native binary for Windows     | 3.3.3         | MIT ([text](third-party/koffi.MIT.txt))                                                                                                | Copyright (C) 2026 Niels Martignène                                      |
| Electron                 | `desktop/` - the shell the application runs in | 44.9.0        | MIT ([text](third-party/Electron.MIT.txt)); Chromium and Node.js under their own licences, in `LICENSES.chromium.html` next to the app | Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc. |
| Jost                     | `app/brand/font/jost.woff` - the editor's type | 1.49.0 bundle | SIL Open Font License 1.1 ([text](third-party/Jost.OFL.txt))                                                                           | Copyright 2020 The Jost Project Authors                                  |

Notes:

- **koffi** is the only third-party code the application itself runs. It is an
  FFI, used for exactly five Win32 calls, all of them inside
  `desktop/host-win32.js` (architecture invariant 8). ADR 0002 records why it
  was chosen and what it is allowed to do.
- **@koromix/koffi-win32-x64** is the same author's prebuilt binary for this
  platform, pulled in as an optional dependency of koffi and selected by
  platform, so `npm install` needs no compiler. It is a Node-API addon, which is
  why it works under both Node and Electron without rebuilding. The packaging
  step unpacks it from the asar archive (`asarUnpack` in
  `electron-builder.yml`), because a native module cannot be loaded from inside
  one.
- **Electron** carries Chromium and Node.js. Every build ships the complete
  Chromium licence file (`LICENSES.chromium.html`) next to the application; the
  packaging step fails without it.
- **Jost** is the face this brand is set in, and the one font file in the
  product. It arrives as part of the brand kit's bundle rather than on its own
  (`app/brand/`, built by `brandkit bundle`), which is why its version is the
  bundle's: the font and the stylesheet that declares it are generated
  together and `brandkit check` compares both against the brand definition.
  The OFL has two clauses that matter to a product sold under the EULA in this
  folder. The font may be sold **as part of a larger package but not by
  itself**, which this is - nobody buys Day and Night for its typeface, and no
  build offers the file separately. And the copyright notice and licence must
  travel with the font: they do, both inside the application
  (`app/brand/font/Jost-LICENCE.txt`, as the kit shipped it) and beside the
  other notices here, where `check-bundle.js` fails the build without it.
  Jost is not modified; "Jost" is not a Reserved Font Name in its own notice,
  and the question does not arise while the file is passed through untouched.
  The monospace stack is still whatever Windows already has, named by the
  brand's `--mono` and aliased in `app/tokens.css`, so there is no second font
  file.

## Credited, not licensed

Published algorithms, methods and data used in the engine, written from the
published description rather than copied from anyone's code. No licence
attaches; they are named here so the credit is on record, and because knowing
where a formula came from is how the next person checks it.

- **Jean Meeus, _Astronomical Algorithms_.** Chapter 25 for the Sun, 47 and 48
  for the Moon, 12 for sidereal time, 22 for obliquity and nutation, and 16 for
  refraction. The Moon's periodic terms in `engine/astro/lunar.js` are the
  principal terms of **ELP-2000/82** (Chapront-Touzé and Chapront), and the
  Sun's follow the reduction of **VSOP87** (Bretagnon and Francou), in both
  cases published scientific data reproduced as the numerical facts they are.
  The ΔT polynomial is the fit by **Espenak and Meeus**.
- **Oklab**: Björn Ottosson, 2020. The matrices in `engine/sky/oklab.js` and in
  the composite shader are his, from his published description, which he placed
  in the public domain.
- **Extended Reinhard tone mapping**: Reinhard, Stark, Shirley and Ferwerda,
  "Photographic Tone Reproduction for Digital Images", 2002.
- **Interleaved gradient noise**, used as the output dither: Jorge Jimenez,
  "Next Generation Post Processing in Call of Duty: Advanced Warfare",
  SIGGRAPH 2014.
- **Single-scattering atmosphere** with Rayleigh, Mie and ozone terms: the
  standard model in the graphics literature, with the coefficients from the
  published measurements it cites. `engine/sky/atmosphere.js` records why
  Preetham and Hošek-Wilkie were not used instead.
- **mulberry32**, the seeded random number generator used to place the stars:
  Tommy Ettinger, released to the public domain.

## Used to develop and test, not shipped

Installed by `npm ci` for contributors and CI. None of it is in a build or
reaches a customer. Versions are pinned in `package-lock.json`.

| Package          | Purpose                             | Licence                                                           |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------- |
| electron         | Runs the application in development | MIT                                                               |
| electron-builder | Makes the Windows installer         | MIT                                                               |
| eslint           | Static checks                       | MIT                                                               |
| @eslint/js       | ESLint's recommended rules          | MIT                                                               |
| globals          | Global names for ESLint             | MIT                                                               |
| prettier         | Formatting                          | MIT                                                               |
| typescript       | Type checking over JSDoc            | Apache-2.0                                                        |
| @types/node      | Type definitions for Node           | MIT                                                               |
| @playwright/test | Browser, image and desktop tests    | Apache-2.0                                                        |
| Node.js          | Runs the tools and tests            | MIT (and the licences of its bundled components, see its LICENSE) |

`electron` appears in both lists on purpose: it is a development dependency in
`package.json`, and electron-builder puts its runtime into the build, where it
reaches every customer.

## The city list

`app/ui/cities.js` is about a hundred cities with their coordinates and time
zones, typed by hand from general knowledge to roughly a tenth of a degree. It
is not extracted from a gazetteer, a database or any other licensed dataset, and
the tests check every entry against its own time zone rather than trusting it.
If the list is ever replaced with a real dataset - GeoNames, for instance - that
dataset's licence and attribution go in the table above, and the roadmap's tech
debt table records the swap as a decision.
