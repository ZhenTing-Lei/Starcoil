# Starcoil

*Encircle the dark. Return the stars.*

An arcade roguelite for the browser. You are a serpent of starlight; shades are
swallowing the night sky. You have no weapon — only your own body. Loop around
the shades, cross your own tail, and everything inside the coil is banished and
becomes a star.

## Play

Open `index.html` in any modern browser. There is nothing to install or build.

| | |
|---|---|
| **Steer** | Move the mouse (or drag a finger). WASD / arrow keys also work. |
| **Coil** | Cross your own body to close a loop. Everything inside is caught. |
| **Dash** | Click or Space (second finger on touch). You can't be hurt mid-dash. |
| **Pause** | Esc or P |
| **Sound / Fullscreen** | M / F |

## How it works

- **Coils score by size.** A coil is worth *(sum of shades) × (number caught) × chain*.
  Herd shades into a clump, then close one big loop.
- **Chains.** Each coil that catches something raises your chain; it fades if you
  go too long without a catch.
- **Nights.** Each night brings new kinds of shade: darters that lunge along a
  shown line, gnawers that bite off your tail, spitters, armoured brutes, and
  thorns — which shatter any coil that encloses them.
- **Boons.** Survive a night and choose one of three upgrades. They stack.
- **The Eclipse.** Every fifth night is a boss. Coil around it to break its seals.
- Every shade you banish stays in the sky as a star, and big coils leave
  constellations behind.

## Code

Plain JavaScript and HTML5 Canvas — no dependencies, no build step, no asset
files. All art is drawn in code and all sound is synthesised with WebAudio.

| File | What it holds |
|---|---|
| `js/core.js` | Tuning constants (`CFG`), math, geometry, storage, canvas sizing |
| `js/serpent.js` | Steering, the body path, coil detection, drawing the serpent |
| `js/enemies.js` | Every shade's behaviour and drawing, the boss, bolts, rifts, pickups |
| `js/waves.js` | What each night contains and when it arrives |
| `js/boons.js` | The upgrades |
| `js/fx.js` | Particles, glow, lightning, floating text, the sky |
| `js/audio.js` | Sound effects and the generative score |
| `js/ui.js` | Menus, HUD, banners |
| `js/game.js` | Game state, the rules of a coil, input, the main loop |

To change the feel, start with `CFG` in `js/core.js` (speed, turn rate, body
length, dash) and `ETYPE` in `js/enemies.js` (each shade's size, speed, value).

`window.STARCOIL` exposes a few hooks from the browser console, e.g.
`STARCOIL.god(true)` (no damage) or `STARCOIL.bot(true)` (let the demo AI play).

The `.claude` folder holds two optional helpers the game does not need to run:
`serve.py`, a local server for previewing over http, and `bundle.py`, which
packs everything into the single self-contained page used for the published,
shareable copy.
