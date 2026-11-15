'use strict';
/* ==========================================================================
   STARCOIL — boons: the gifts chosen between nights
   `apply` holds one-off effects; everything else is read with boonLevel().
   Icons are 48×48 line art, stroked in the card's colour.
   ========================================================================== */

const BOONS = [
  {
    id: 'length', name: "World-Serpent's Scale", max: 6,
    desc: 'Your body grows 22% longer. A longer body closes wider coils.',
    icon: '<path d="M7 39c2-11 13-7 15-17s11-7 13-14"/><circle cx="37" cy="7" r="3" fill="currentColor" stroke="none"/>',
    apply(S) {
      const add = CFG.serpent.length * 0.22;
      S.maxLen += add;
      S.curLen += add;
      S.regrowMult = S.maxLen / CFG.serpent.length;     // a longer tail regrows just as quickly, in proportion
    },
  },
  {
    id: 'swift', name: 'Feathered Flight', max: 4,
    desc: 'Move 8% faster — and turn just as tightly as before.',
    icon: '<path d="M9 39C13 22 24 11 40 8c-1 15-11 24-25 27"/><path d="M9 39 30 18"/>',
    apply(S) { S.speed *= 1.08; S.turnRate *= 1.08; },
  },
  {
    id: 'supple', name: 'Supple Spine', max: 4,
    desc: 'Turn 14% sharper. Tighter coils close sooner.',
    icon: '<path d="M24 24a2 2 0 0 1 4 0a4 4 0 0 1-8 0a6 6 0 0 1 12 0a8 8 0 0 1-16 0a10 10 0 0 1 20 0"/>',
    apply(S) { S.turnRate *= 1.14; },
  },
  {
    id: 'heart', name: "Hydra's Heart", max: 3,
    desc: 'Gain a heart, and mend one.',
    icon: '<path d="M24 40C9 30 7 19 12 13c4-5 10-3 12 2 2-5 8-7 12-2 5 6 3 17-12 27z"/>',
    apply() {
      G.maxHearts++;
      G.hearts = Math.min(G.maxHearts, G.hearts + 1);
    },
  },
  {
    id: 'mend', name: 'Rod of Asclepius', max: 99,
    desc: 'Mend every heart, here and now.',
    icon: '<path d="M24 6v36"/><path d="M17 13c12 0 12 8 7 9s-7 8 0 9 6 6 2 7"/>',
    when() { return G.hearts === 1 || G.hearts <= G.maxHearts - 2; },
    apply() { G.hearts = G.maxHearts; },
  },
  {
    id: 'strike', name: 'Viper Strike', max: 3,
    desc: 'Your dash recharges 25% sooner.',
    icon: '<path d="M11 13l12 11-12 11M25 13l12 11-12 11"/>',
    apply(S) { S.dashCdMax *= 0.75; },
  },
  {
    id: 'fang', name: 'Venom Fangs', max: 1,
    desc: 'Dash through wisps, motes and bolts to destroy them outright.',
    icon: '<path d="M13 9c0 12 3 22 6 30 3-8 5-18 5-30zM25 9c0 12 2 22 5 30 3-8 6-18 6-30z"/>',
  },
  {
    id: 'nova', name: 'Shedding Nova', max: 3,
    desc: 'Every coil that catches something bursts outward, hurling shades back and erasing their bolts.',
    icon: '<circle cx="24" cy="24" r="6"/><path d="M24 5v7M24 36v7M5 24h7M36 24h7M10.5 10.5l5 5M32.5 32.5l5 5M37.5 10.5l-5 5M15.5 32.5l-5 5"/>',
  },
  {
    id: 'echo', name: 'Ouroboros Echo', max: 2,
    desc: 'A closed coil lingers as a seal, banishing whatever strays inside it.',
    icon: '<circle cx="24" cy="24" r="5"/><circle cx="24" cy="24" r="11" opacity=".7"/><circle cx="24" cy="24" r="17" opacity=".4"/>',
  },
  {
    id: 'gaze', name: 'Basilisk Gaze', max: 3,
    desc: 'Shades close to your head are slowed.',
    icon: '<path d="M5 24c8-11 30-11 38 0-8 11-30 11-38 0z"/><path d="M24 15c-4 5-4 13 0 18 4-5 4-13 0-18z" fill="currentColor"/>',
  },
  {
    id: 'girth', name: "Leviathan's Reach", max: 3,
    desc: 'Coils also catch shades just outside their edge.',
    icon: '<circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="17" stroke-dasharray="4 5"/>',
  },
  {
    id: 'storm', name: 'Storm Coil', max: 3,
    desc: 'A coil that catches two or more arcs lightning to the nearest shade outside it.',
    icon: '<path d="M27 5 12 27h10l-3 16 16-23H25z"/>',
  },
  {
    id: 'scales', name: 'Adamant Scales', max: 1,
    desc: 'Gnawers break their teeth on you. Your tail can no longer be severed.',
    icon: '<path d="M24 5l14 6v12c0 9-6 15-14 20-8-5-14-11-14-20V11z"/><path d="M17 20a7 7 0 0 0 14 0M17 28a7 7 0 0 0 14 0" opacity=".7"/>',
    when() { return G.wave >= 3; },
  },
  {
    id: 'circle', name: 'Unbroken Circle', max: 2,
    desc: 'Your chain lasts 50% longer before it fades.',
    icon: '<path d="M38 20a15 15 0 1 1-6-9"/><circle cx="35" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'second', name: 'Second Head', max: 1,
    desc: 'Once, when you would fall, rise again with two hearts.',
    icon: '<path d="M24 43V28M24 28c0-9-9-8-9-17M24 28c0-9 9-8 9-17"/><circle cx="15" cy="9" r="3" fill="currentColor" stroke="none"/><circle cx="33" cy="9" r="3" fill="currentColor" stroke="none"/>',
    when() { return G.wave >= 2; },
  },
];

const BOON_BY_ID = {};
for (const b of BOONS) BOON_BY_ID[b.id] = b;

function boonLevel(id) {
  return G.boons[id] || 0;
}

function boonIcon(b) {
  return '<svg class="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b.icon + '</svg>';
}

/** Up to `n` distinct boons the serpent can still take. */
function rollBoons(n) {
  const pool = BOONS.filter((b) => boonLevel(b.id) < b.max && (!b.when || b.when()));
  return shuffle(pool).slice(0, n);
}

function applyBoon(id) {
  const b = BOON_BY_ID[id];
  if (!b) return;
  G.boons[id] = boonLevel(id) + 1;
  if (b.apply) b.apply(G.serpent);
}

/* Values the rest of the game reads off the boon levels. */
const chainWindow = () => CFG.chainWindow * (1 + 0.5 * boonLevel('circle'));
const coilReach = () => boonLevel('girth') * 24;
const echoTime = () => [0, 1.5, 2.6][boonLevel('echo')];
const novaRadius = () => { const l = boonLevel('nova'); return l ? 130 + 55 * l : 0; };
