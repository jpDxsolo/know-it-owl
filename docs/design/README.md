# Design notes

Mockups for the screens, generated with Google Stitch from the owl logo, plus
the conventions the implementation follows. The `.html` files are the full
artefact — open them in a browser; the `.png` thumbnails are small.

| Screen | Mobile | Desktop |
| --- | --- | --- |
| Join | [`join-mobile`](join-mobile.png) (error state) | [`join-desktop`](join-desktop.png) |
| Lobby, filling up | [`lobby-waiting-mobile`](lobby-waiting-mobile.png) | [`lobby-waiting-desktop`](lobby-waiting-desktop.png) |
| Lobby, teams drawn | [`lobby-teams-set-mobile`](lobby-teams-set-mobile.png) | [`lobby-teams-set-desktop`](lobby-teams-set-desktop.png) |
| GM dashboard, before the quiz | [`gm-dashboard-mobile`](gm-dashboard-mobile.png) | [`gm-dashboard-desktop`](gm-dashboard-desktop.png) |
| GM running a round | [`gm-round-active-mobile`](gm-round-active-mobile.png) | [`gm-round-active-desktop`](gm-round-active-desktop.png) |
| Round builder | [`round-builder-mobile`](round-builder-mobile.png) | [`round-builder-desktop`](round-builder-desktop.png) |

The GM screens carry two extras the generated mocks invented and we do not have:
a left-hand app nav (Games / Library / Results) and a "Game Master" account
identity. There are no accounts in this product — a host is whoever holds the
GM token — so ignore both.

**The round builder is the exception to mobile-first.** A picture question is one
image beside a ten-slot answer key, which is inherently two columns, so it was
designed at desktop and folded down to a single column on a phone rather than
the other way round. Expect the same of grading, for the same reason: a grid of
every team's answers only makes sense with width. Reach for that order whenever
a screen's *content* is two-dimensional; everything else stays mobile-first.

## Every screen ships two views

**Mobile and desktop, both, every time.** The app is played on phones and run
from a browser — the host, who does the most work in it, is usually on a laptop.
A screen that only works at one size is not finished.

Desktop is not "the same thing, wider":

| Mobile | Desktop |
| --- | --- |
| One column | Lists become grids; related cards sit side by side |
| Primary action full width, in thumb reach at the bottom | Action sized to its label, no longer pinned |
| Host panel pinned as a bottom bar | Host controls become a row |
| Type sized for a screen held close | Type can grow — the screen is further away |

The breakpoint is **`40rem` (640px)**. Everything below it is the phone layout.

## Widths

Two, both declared in [`theme.css`](../../packages/frontend/src/styles/theme.css):

- `--kio-measure` (30rem) — form-shaped screens. Join keeps this at every size,
  because a login form 900px wide is horrible.
- `--kio-measure-wide` (64rem), via `.kio-page--wide` — list-shaped screens.
  The lobby uses it: fourteen people down a narrow column means scrolling to
  answer "is everyone in yet?".

## Palette

Taken from the logo, and dark on purpose — the app is used in a dim pub on a
phone held under a table, where a bright screen is glare for the holder and a
giveaway to the next table.

| Token | Hex | Use |
| --- | --- | --- |
| `--kio-navy-ground` | `#0E1A2F` | Page background |
| `--kio-navy-surface` | `#16294A` | Cards, list rows, inputs |
| `--kio-navy-raised` | `#1E3765` | Avatars, chips, stepper buttons |
| `--kio-gold` | `#F5A81C` | The one primary action per screen |
| `--kio-amber` | `#F0821E` | Emphasis, the DOUBLE affordance |
| `--kio-blue` | `#2F7FE0` | Secondary, informational |
| `--kio-cream` | `#F7EFE2` | Primary text |
| `--kio-muted` | `#9DB0CE` | Secondary text, labels |
| `--kio-green` / `--kio-red` | `#3FB27F` / `#E5484D` | Connected / errors |

**Gold is the brand: exactly one gold action per screen.** If everything is
gold, nothing is.

## Rules worth keeping

- **Join codes are read aloud across a noisy room.** They are the only type in
  the app sized to be legible at that distance, and they grow further on
  desktop rather than shrinking.
- **Errors mark the field, never the form.** A wrong join code must not make a
  perfectly good name look rejected.
- **Never blame the player.** Say what to do next — "That code didn't match a
  game — check with your host" — not what failed internally.
- **Live means visible.** Everything arrives by subscription, so a stale screen
  is indistinguishable from a quiet one unless the connection state is shown.
- **Touch targets stay at least 44px** (`--kio-touch`), and no pure black or
  pure white anywhere.

## The Stitch project

Project **Know It Owl**, design system *"Know It Owl — navy & gold"*: dark,
Outfit headlines, Plus Jakarta Sans body, gold seed `#F5A81C`, 12px rounding.
Its design-MD carries the palette and rules above, so generated screens start
consistent. Generate each screen for `MOBILE` and `DESKTOP`.

The generated mockups place a stand-in owl rather than `knowitowl.png`; the real
asset is what ships. Sizes are built by
[`build-icons.sh`](../../packages/frontend/scripts/build-icons.sh) from
`assets/knowitowl-source.png`, which is kept out of `public/` so it is never
served.
