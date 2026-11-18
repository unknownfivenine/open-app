// OPEN composition core: moods, harmony that cannot drift, layered note plans, bridges, sessions.
// Pure planning only: no audio, samples or model output. Deterministic for a given seed.
// Mood names and characters were chosen by the owner on 2026-11-16; musical settings are first drafts.
import {random} from './music.js';

const MODES = {ionian:[0,2,4,5,7,9,11], lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10], aeolian:[0,2,3,5,7,8,10]};
// Holding is home. Order here is the order moods take within a session.
export const HOME = 'holding';
export const MOODS = {
  holding:   {character:['safe','warm','contained'],       mode:'ionian',     degrees:[0,3,5],   chordSeconds:[24,40], phraseGap:[8,16],  noteSeconds:[3,6],   motif:3, velocity:.30},
  surrender: {character:['soft','yielding','trusting'],    mode:'mixolydian', degrees:[0,3,6],   chordSeconds:[20,34], phraseGap:[7,13],  noteSeconds:[3,5],   motif:3, velocity:.30},
  release:   {character:['tender','aching','cathartic'],   mode:'aeolian',    degrees:[0,3,5,6], chordSeconds:[14,24], phraseGap:[4,9],   noteSeconds:[2,4],   motif:4, velocity:.40},
  expanse:   {character:['vast','weightless','awed'],      mode:'lydian',     degrees:[0,1,4],   chordSeconds:[28,45], phraseGap:[10,18], noteSeconds:[4,7],   motif:3, velocity:.28},
  communion: {character:['connected','loving','grateful'], mode:'ionian',     degrees:[0,3,4,5], chordSeconds:[14,24], phraseGap:[4,8],   noteSeconds:[2,3.5], motif:4, velocity:.40},
  renewal:   {character:['clear','hopeful','alive'],       mode:'lydian',     degrees:[0,3,4,5], chordSeconds:[10,18], phraseGap:[2,6],   noteSeconds:[1,2.5], motif:4, velocity:.46}
};
export const LAYERS = ['bed','voice','texture'];
// How far a session travels also changes how much happens inside each mood.
export const DENSITY = {gentle:{gap:1.4, velocity:.9}, moderate:{gap:1, velocity:1}, full:{gap:.7, velocity:1.1}};
const BED = [36,62], VOICE = [62,86];
// The sustained bed is written as four parts, like a string section: each keeps to its own range.
export const BED_PARTS = {bass:[36,52], tenor:[45,62], alto:[53,69], top:[60,76]};
const PART_LEVEL = {bass:1, tenor:.75, alto:.7, top:.6};
const between = (r,[lo,hi]) => lo + r() * (hi - lo);
const fit = (pitch,[lo,hi]) => { while (pitch < lo) pitch += 12; while (pitch > hi) pitch -= 12; return pitch; };
export function scalePitch(tonic, mode, index) {
  return tonic + MODES[mode][((index % 7) + 7) % 7] + 12 * Math.floor(index / 7);
}
export function pitchClasses(mood, tonic) {
  return new Set(MODES[MOODS[mood].mode].map(step => (tonic + step) % 12));
}
function chordAt(chords, time) { return chords.findLast(chord => chord.at <= time) ?? chords[0]; }

// One mood, one tonal centre, any length. Opens and closes on the home chord.
export function planSegment({mood, tonic = 62, seconds, seed = 1, intensity = 'moderate'}) {
  const base = MOODS[mood], d = DENSITY[intensity];
  if (!base) throw new Error(`Unknown mood: ${mood}`);
  if (!d) throw new Error(`Unknown intensity: ${intensity}`);
  const m = {...base, phraseGap:base.phraseGap.map(x => x * d.gap), velocity:Math.min(.5, base.velocity * d.velocity)};
  if (!(seconds >= 30)) throw new Error('A segment needs at least 30 seconds');
  const r = random(seed), chords = [];
  for (let t = 0, degree = 0; t < seconds;) {
    let dur = between(r, m.chordSeconds);
    if (seconds - t - dur < m.chordSeconds[0]) dur = seconds - t;
    chords.push({at:t, dur, degree}); t += dur;
    const options = m.degrees.filter(d => d !== degree); degree = options[Math.floor(r() * options.length)];
  }
  if (chords.length > 1) {
    chords.at(-1).degree = 0;
    if (chords.length > 2 && chords.at(-2).degree === 0) chords.at(-2).degree = m.degrees[1];
  }
  const bed = [], voice = [], texture = [];
  // Voice leading: the bass takes the chord root; the other parts move to the nearest chord tone, keep
  // to their ranges without crossing, and hold a note that the next chord shares instead of re-entering.
  const sounding = {}, previous = {bass:44, tenor:53, alto:61, top:68};
  for (const chord of chords) {
    const tones = [0,2,4].map(i => scalePitch(tonic, m.mode, chord.degree + i) % 12), colour = scalePitch(tonic, m.mode, chord.degree + 1) % 12;
    const chosen = {}, used = new Set(); let floor = 0;
    for (const part of ['bass','tenor','alto','top']) {
      const [lo, hi] = BED_PARTS[part]; let best = null, bestScore = Infinity;
      for (let p = Math.max(lo, floor + 1); p <= hi; p++) {
        const pc = ((p % 12) + 12) % 12;
        if (part === 'bass' ? pc !== tones[0] : !tones.includes(pc) && !(part === 'top' && pc === colour)) continue;
        const score = Math.abs(p - previous[part]) + (part !== 'bass' && used.has(pc) ? 3 : 0) + (pc === colour ? 1.5 : 0)
          + (part === 'alto' && !used.has(tones[1]) && pc !== tones[1] ? 1 : 0);
        if (score < bestScore) { best = p; bestScore = score; }
      }
      chosen[part] = best ?? fit(tones[0] + 48, BED_PARTS[part]); used.add(chosen[part] % 12); floor = chosen[part]; previous[part] = chosen[part];
    }
    for (const part of ['bass','tenor','alto','top']) {
      const held = sounding[part];
      if (held && held.midi === chosen[part]) { held.dur = Math.min(chord.at + chord.dur + 1.5, seconds) - held.at; continue; }
      const at = Math.min(chord.at + (held ? r() * 1.2 : r() * 2.5), seconds - 1);
      if (held) held.dur = Math.max(held.dur - (held.at + held.dur - at) + 1.5, 1);   // hand over with a short overlap
      const note = {at, dur:Math.min(chord.at + chord.dur + 1.5, seconds) - at, midi:chosen[part], part,
                    velocity:m.velocity * PART_LEVEL[part] * (.85 + .15 * r())};
      bed.push(note); sounding[part] = note;
    }
    texture.push({at:chord.at, dur:chord.dur, gain:.5 + .5 * r(),
                  pitchClasses:[0,2,4].map(i => scalePitch(tonic, m.mode, chord.degree + i) % 12)});
  }
  // A short motif recurs with small variations; phrases are separated by rests.
  const motif = [[0,2,4][Math.floor(r() * 3)]];
  while (motif.length < m.motif) motif.push(motif.at(-1) + [-2,-1,1,2][Math.floor(r() * 4)]);
  for (let t = 3 + between(r, m.phraseGap) / 2; ;) {
    const shape = motif.slice(); if (r() < .35) shape[1 + Math.floor(r() * (shape.length - 1))] += r() < .5 ? -1 : 1;
    const steps = shape.map(() => between(r, m.noteSeconds)), length = steps.reduce((a,b) => a + b, 0);
    if (t + length > seconds - 4) break;
    for (const [i, offset] of shape.entries()) {
      voice.push({at:t, dur:steps[i] * 1.6, midi:fit(scalePitch(tonic, m.mode, chordAt(chords, t).degree + offset), VOICE),
                  velocity:m.velocity * (i === 0 ? 1 : .75 + .2 * r())});
      t += steps[i];
    }
    t += between(r, m.phraseGap);
  }
  return {kind:'segment', mood, character:m.character, tonic, seconds, seed, intensity, chords, layers:{bed, voice, texture}};
}

// Move between two moods on the same tonal centre: leave, rest on a bare fifth, arrive.
export function planBridge({from, to, tonic = 62, seconds, seed = 1, intensity = 'moderate'}) {
  if (!MOODS[from] || !MOODS[to] || from === to) throw new Error('A bridge joins two different moods');
  if (!(seconds >= 90)) throw new Error('A bridge needs at least 90 seconds');
  const third = seconds / 3, leave = planSegment({mood:from, tonic, seconds:third, seed, intensity});
  const arrive = planSegment({mood:to, tonic, seconds:third, seed:seed + 1, intensity}), shift = 2 * third;
  const move = (events, by, mood) => events.map(event => ({...event, at:event.at + by, mood}));
  const rest = {at:third, dur:third, degree:0, open:true};
  const bed = [0, 7, 12].map((interval, i) => ({at:third + i * 2, dur:third - i * 2 + 4, midi:fit(tonic - 24 + interval, BED),
                                               velocity:.3 * [1,.8,.6][i], mood:'shared'}));
  return {kind:'bridge', from, to, tonic, seconds, seed, intensity,
    chords:[...leave.chords, rest, ...arrive.chords.map(chord => ({...chord, at:chord.at + shift}))],
    layers:{bed:[...move(leave.layers.bed,0,from), ...bed, ...move(arrive.layers.bed,shift,to)],
            voice:[...move(leave.layers.voice,0,from), ...move(arrive.layers.voice,shift,to)],
            texture:[...move(leave.layers.texture,0,from), {at:third, dur:third, gain:.4, pitchClasses:[tonic % 12, (tonic + 7) % 12], mood:'shared'},
                     ...move(arrive.layers.texture,shift,to)]},
    mix:[{at:0, from:1, to:0}, {at:third, from:.6, to:.2}, {at:shift, from:.2, to:.6}, {at:seconds, from:0, to:1}]};
}

// Lay a route of moods over `seconds`, starting at `offset`, with a bridge at every change.
function layRoute({moods, seconds, offset = 0, tonic, seed, intensity, bridgeSeconds}) {
  const changes = moods.slice(1).filter((mood, i) => mood !== moods[i]).length;
  const bridge = bridgeSeconds ?? Math.min(600, Math.max(90, seconds * .07)), each = (seconds - changes * bridge) / moods.length;
  if (!(each >= 30)) throw new Error('Too short for this many moods');
  const parts = []; let start = offset;
  for (const [i, mood] of moods.entries()) {
    if (i && mood !== moods[i - 1]) {
      parts.push({start, routeIndex:i, ...planBridge({from:moods[i - 1], to:mood, tonic, seconds:bridge, seed:seed + 100 * i + 50, intensity})});
      start += bridge;
    }
    parts.push({start, routeIndex:i, ...planSegment({mood, tonic, seconds:each, seed:seed + 100 * i, intensity})}); start += each;
  }
  return parts;
}

// A whole session: listed moods in order, home mood first and last, a bridge at every change.
export function planSession({moods, minutes, tonic = 62, seed = 1, intensity = 'moderate'}) {
  if (!Array.isArray(moods) || !moods.length || moods.some(mood => !MOODS[mood])) throw new Error('Choose known moods');
  if (moods[0] !== moods.at(-1)) throw new Error('A session opens and closes in the same home mood');
  const total = minutes * 60;
  return {seconds:total, tonic, seed, intensity, moods, parts:layRoute({moods, seconds:total, tonic, seed, intensity})};
}

// The part playing at `at` seconds, and the mood the listener is in there.
export function partAt(plan, at) { return plan.parts.findLast(part => part.start <= at) ?? plan.parts[0]; }
export function moodAt(plan, at) {
  const part = partAt(plan, at);
  return part.kind === 'bridge' ? (at - part.start < part.seconds / 2 ? part.from : part.to) : part.mood;
}
// The moods still ahead from `at`, starting with the current one.
export function remainingRoute(plan, at) {
  const part = partAt(plan, at), ahead = plan.moods.slice(part.routeIndex ?? 0);
  return [moodAt(plan, at), ...ahead].filter((mood, i, all) => i === 0 || mood !== all[i - 1]);
}

// Change the rest of a session from `at`: 'hold' stays in the current mood to the end, 'home' moves to
// Holding over a short bridge and stays, 'continue' resumes `route` (as saved by remainingRoute when holding).
// Earlier music is kept as it was. Returns null when too little time is left to change anything.
export function replan(plan, at, mode, route) {
  const left = plan.seconds - at, current = moodAt(plan, at);
  if (!(left >= 30)) return null;
  const wanted = mode === 'hold' ? [current] : mode === 'home' ? [current, HOME] : mode === 'continue' ? route : null;
  if (!wanted?.length || wanted.some(mood => !MOODS[mood])) throw new Error(`Unknown change: ${mode}`);
  const moods = wanted.filter((mood, i) => i === 0 || mood !== wanted[i - 1]);
  // Shorter routes are tried in turn when time runs short; the destination mood is always kept.
  const options = [moods, [moods[0], moods.at(-1)], [moods.at(-1)]].map(r => r.filter((m, i) => i === 0 || m !== r[i - 1]));
  for (const route of options) {
    try {
      const parts = layRoute({moods:route, seconds:left, offset:at, tonic:plan.tonic, seed:plan.seed + 1000 + Math.floor(at),
        intensity:plan.intensity, bridgeSeconds:mode === 'home' ? 90 : undefined});
      const past = plan.parts.filter(part => part.start < at).map(part => part.start + part.seconds > at ? {...part, seconds:at - part.start, cut:true} : part);
      return {...plan, moods:route, parts:[...past, ...parts], changedAt:at, mode};
    } catch {}
  }
  return null;
}

// Map a note to the closest recorded pitch of an instrument and the playback rate that reaches it.
export function nearestSample(midi, available) {
  if (!available?.length) throw new Error('Instrument has no samples');
  const sample = available.reduce((best, n) => Math.abs(n - midi) < Math.abs(best - midi) ? n : best);
  return {sample, rate:2 ** ((midi - sample) / 12)};
}
