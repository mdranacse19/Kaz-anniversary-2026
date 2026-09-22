# DESIGN.md — KAZ Anniversary Tour 2026

## World

Editorial travel story on warm paper. Photography carries color; teal is the only UI accent. Dark hero and dark closing bookend a light scrolling middle.

## Palette

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#f3f1ec` | Page ground |
| `--ink` | `#111111` | Text / primary CTA (logo black) |
| `--gold` | `#e8a348` | Brand swoosh accent |
| `--gold-deep` | `#c9842a` | Hover / emphasis |

Brand reference: [kaz.com.bd](https://www.kaz.com.bd/) — charcoal wordmark + gold swoosh on light UI. Logo asset: `assets/kaz-logo.png` (transparent, for white backgrounds).

## Type

- Display: Noto Serif Bengali
- Body / UI: Hind Siliguri
- Scale: large Bangla headlines, short body, compact meta

## Layout

Single continuous scroll: Hero → Destinations (asymmetric editorial stack) → Vote → Published results → Closing. Sticky top bar with brand + vote anchor only.

## Motion

Entrance fades/slides for destinations and result bars. Image scale on viewport entry. Respects `prefers-reduced-motion`.

## Interaction

- Destination “দেখি” opens a sheet with short facts
- Poll: one selection, localStorage record, no live count bump
- Results always show published JSON counts
