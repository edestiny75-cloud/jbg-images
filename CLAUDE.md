# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this repository is

`jbg-images` is a **digital-asset repository**, not a software project. It holds
finished JPG artwork for the **JBG "Faith Foundations Collection"** — a line of
Christian, kid-focused (ages ~4–9) educational posters/prints, plus the
marketing (lifestyle and pack-shot) imagery used to sell them.

There is **no source code, build system, package manager, tests, or CI**. The
deliverables *are* the image files at the repository root. Treat this repo the
way you would a shared asset library: the important work is naming, organizing,
curating, and versioning binary files — not compiling anything.

## Repository contents

All assets live flat in the repository root. Current inventory:

### Product design artwork (the posters themselves)
Portrait orientation, roughly 1086×1448 or 1103×1426 px. Each is a self-contained
poster in the "Faith Foundations Collection" visual system (green branding, cartoon
illustrations, a `KEEP THE FAITH` badge, and a `LEARN IT / PRAY IT / LIVE IT`
footer).

| File | Poster |
| --- | --- |
| `JBG-BIN-LAM-BibleHeroes.jpg` | 12 Bible Heroes |
| `JBG-BIN-LAM-GreatBibleStories.jpg` | 12 Great Bible Stories |
| `JBG-BIN-LAM-ChristianValues.jpg` | 12 Christian Values |
| `JBG-BIN-LAM-ChildrensPrayers.jpg` | 12 Children's Prayers |
| `JBG-BIN-LAM-BeLikeJesus.jpg` | 12 Ways to Be Like Jesus |

### Marketing / listing imagery
| File | Purpose |
| --- | --- |
| `JBG-BIN-LAM_FAITH-PACK.jpg` | Product pack shot (portrait, 1024×1536) |
| `JBG-BIN-LAM_FAITH-LIFESTYLE-1.jpg` | Lifestyle photo — set in use (landscape, 1536×1024) |
| `JBG-BIN-LAM_FAITH-LIFESTYLE-2.jpg` | Lifestyle photo (1402×1122) |
| `JBG-BIN-LAM_FAITH-LIFESTYLE-3.jpg` | Lifestyle photo (1402×1122) |
| `JBG-BIN-LAM_FAITH-LIFESTYLE-4.jpg` | Lifestyle photo (1402×1122) |

## Naming convention

Filenames are meaningful and consistent — preserve the scheme when adding assets.

```
JBG - BIN - LAM  [ - <ProductName>  |  _<LINE>-<ROLE>-<n> ]
 │     │     │
 │     │     └─ Format: LAM = laminated print
 │     └─────── Product type: BIN = binder / bound insert set
 └───────────── Brand prefix: JBG
```

Two sub-patterns are in use:

- **Product artwork** — hyphenated `PascalCase` theme name:
  `JBG-BIN-LAM-<ProductName>.jpg` (e.g. `JBG-BIN-LAM-BibleHeroes.jpg`).
- **Marketing assets** — underscore-delimited line + role, numbered where there
  is a series: `JBG-BIN-LAM_FAITH-<ROLE>[-<n>].jpg`
  (e.g. `JBG-BIN-LAM_FAITH-LIFESTYLE-2.jpg`, `JBG-BIN-LAM_FAITH-PACK.jpg`).

When adding files, match the closest existing pattern exactly (same prefix,
casing, separator, and extension). Do not introduce spaces or divergent casing.

## Conventions & guardrails

- **Format:** JPG (baseline, RGB), following the existing files. Keep new
  product artwork portrait and comparable in resolution (~1000–1500 px on the
  short edge) unless asked otherwise.
- **Branding consistency:** New posters should stay within the established
  "Faith Foundations Collection" look — green accent palette, `KEEP THE FAITH`
  badge, `LEARN IT / PRAY IT / LIVE IT` footer, "12 …" theme framing.
- **Flat layout:** Assets currently sit at the repo root. If a folder structure
  is ever introduced (e.g. `products/`, `marketing/`), move files deliberately
  and update this file.
- **Don't rename or delete** existing assets casually — filenames are likely
  referenced by external listings/print workflows. Confirm with the user first.
- **Binary diffs:** Git can't meaningfully diff JPGs. Reason about images by
  actually viewing them (read the file), not by inspecting bytes.

## Git workflow

- Active development branch for this work: `claude/claude-md-docs-9h098y`.
- Default branch: `main`.
- Commit adds/updates with clear messages describing which asset changed and why
  (e.g. `Add JBG-BIN-LAM-<Theme> poster`).
- Push with `git push -u origin <branch-name>`; retry on transient network
  errors. Do not open a pull request unless the user explicitly asks.

## Working with these assets

- To inspect an image, open/read it directly — the visual content is the source
  of truth for what each file contains.
- Image tooling (ImageMagick `identify`/`convert`) is **not** installed. Use
  `file <name>.jpg` for quick format/dimension info, or install tooling only if
  a task genuinely requires programmatic image processing.
- There is nothing to run, lint, or test. "Done" means the correct binary is
  committed under the correct name.
