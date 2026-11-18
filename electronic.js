// OPEN's electronic sound: the AMB-1 generative engine (amb/, MPL-2.0) steered by OPEN's session plan.
// ambSchedule turns a plan into timed settings (pure, testable); Electronic runs them on the audio thread
// with the same interface as the acoustic Sampler, so the player, Stay here and recovery work unchanged.
import {MOODS, moodAt} from './compose.js';

// AMB-1 parameter numbers (amb/src/amb.h) and its scale numbers.
export const P = {pad:0, bells:1, bass:2, pulse:3, density:4, evolve:5, drift:6, hits:7, echo:8, echoTime:9, reverb:10, size:11,
  bright:12, swell:13, bellTone:14, motion:15, tempo:18, root:19, mode:20, bellOct:21, padTone:22, glide:24, fifth:25, hats:27, midi:17};
export const AMB_MODE = {ionian:0, dorian:1, phrygian:2, lydian:3, mixolydian:4, aeolian:5};
// The notes the engine may use (bit i: root + i semitones). Setting the mode number alone does not change them.
export const AMB_POOL = {ionian:0b101010110101, dorian:0b11010101101, phrygian:0b10110101011, lydian:0b101011010101, mixolydian:0b11010110101, aeolian:0b10110101101};
// Each mood's settings. Drift: higher is slower chord changes (100: about five minutes). Pad tone 0 is a
// soft Rhodes, 1 is voices. Percussion only in Renewal, and never at gentle intensity. First drafts.
export const RECIPES = {
  holding:   {pad:70, bells:35, bass:40, pulse:0,  density:25, evolve:25, drift:45, hits:0,  echo:35, echoTime:3, reverb:70, size:85, bright:30, swell:65, bellTone:40, motion:25, tempo:60, padTone:0, glide:30, fifth:25, bellOct:0},
  surrender: {pad:75, bells:30, bass:35, pulse:0,  density:25, evolve:30, drift:55, hits:0,  echo:45, echoTime:3, reverb:80, size:90, bright:30, swell:75, bellTone:30, motion:35, tempo:56, padTone:1, glide:45, fifth:25, bellOct:0},
  release:   {pad:70, bells:45, bass:45, pulse:0,  density:35, evolve:40, drift:40, hits:0,  echo:50, echoTime:3, reverb:70, size:85, bright:25, swell:70, bellTone:25, motion:45, tempo:60, padTone:1, glide:30, fifth:30, bellOct:0},
  expanse:   {pad:80, bells:50, bass:30, pulse:0,  density:30, evolve:45, drift:65, hits:0,  echo:70, echoTime:4, reverb:85, size:95, bright:45, swell:80, bellTone:70, motion:60, tempo:64, padTone:1, glide:40, fifth:20, bellOct:1},
  communion: {pad:65, bells:60, bass:40, pulse:0,  density:45, evolve:40, drift:35, hits:0,  echo:45, echoTime:3, reverb:65, size:80, bright:50, swell:55, bellTone:50, motion:45, tempo:72, padTone:0, glide:20, fifth:35, bellOct:0},
  renewal:   {pad:55, bells:70, bass:40, pulse:15, density:55, evolve:50, drift:30, hits:25, echo:50, echoTime:2, reverb:60, size:75, bright:60, swell:50, bellTone:60, motion:55, tempo:80, padTone:0, glide:15, fifth:40, bellOct:0, hats:30}
};
// Output level per mood, matched so each sits near the acoustic sound's loudness (measured offline).
// Measured unity-gain loudness per mood (dB RMS): holding -15.6, surrender -12.2, release -15.2, expanse -10.8,
// communion -18.0, renewal -20.5; scaled to -23 dB, between the acoustic Holding (-24) and Release (-21).
export const LEVEL = {holding:0.427, surrender:0.288, release:0.407, expanse:0.245, communion:0.562, renewal:0.75};
const SCALE = {gentle:.75, moderate:1, full:1.25};

// The engine's settings for a mood at an intensity, on the plan's tonal centre.
export function settingsFor(mood, intensity = 'moderate', tonic = 62) {
  const recipe = RECIPES[mood], k = SCALE[intensity];
  if (!recipe) throw new Error(`Unknown mood: ${mood}`);
  if (!k) throw new Error(`Unknown intensity: ${intensity}`);
  const v = {...recipe};
  for (const key of ['density','evolve','motion']) v[key] = Math.round(Math.min(100, Math.max(0, v[key] * k)));
  if (intensity === 'gentle') { v.pulse = 0; v.hits = 0; }
  v.root = ((tonic % 12) + 12) % 12; v.mode = AMB_MODE[MOODS[mood].mode]; v.midi = 0;
  return Object.entries(v).map(([key, value]) => [P[key], value]);
}

// Timed settings for a plan from `from` seconds: the mood playing at `from`, then each later mood
// change, taken at the middle of its bridge with a move to the next chord.
export function ambSchedule(plan, from = 0) {
  const at = mood => ({set:settingsFor(mood, plan.intensity, plan.tonic), pool:AMB_POOL[MOODS[mood].mode], gain:LEVEL[mood]});
  const items = [{at:from, ...at(moodAt(plan, from))}];
  for (const part of plan.parts) {
    if (part.kind !== 'bridge') continue;
    const middle = part.start + part.seconds / 2;
    if (middle > from && middle < plan.seconds) items.push({at:middle, ...at(part.to), next:true});
  }
  return items;
}

export class Electronic {
  constructor(ctx, destination) { this.ctx = ctx; this.destination = destination; this.marker = ctx.createGain(); this.instruments = ['Electronic garden']; }
  async load(plan) {
    this.plan = plan;
    await this.ctx.audioWorklet.addModule('amb/worklet.js');
    const response = await fetch('amb/amb.wasm');
    if (!response.ok) throw new Error('Missing electronic engine');
    const wasm = await response.arrayBuffer();
    this.node = new AudioWorkletNode(this.ctx, 'open-amb', {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2]});
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Electronic engine did not start')), 8000);
      this.node.port.onmessage = event => { if (event.data.t === 'ready') { clearTimeout(timer); resolve(); } };
    });
    this.node.port.postMessage({t:'load', wasm});
    await ready;
    this.node.connect(this.destination);
  }
  send(plan, from, extra = {}) {
    const items = ambSchedule(plan, from).map(item => ({...item, time:this.startAt + item.at}));
    Object.assign(items[0], extra);
    this.node.port.postMessage({t:'schedule', from:this.startAt + from, items});
  }
  begin(startAt) { this.startAt = startAt; this.send(this.plan, 0, {seed:this.plan.seed, play:true}); }
  topUp() {}
  async replace(plan, from) { this.plan = plan; this.send(plan, from, {seed:(plan.seed + Math.floor(from)) >>> 0}); }
  // The garden stops growing at `at`; its tails ring on under the session's own fade.
  stopAll(at) { this.node?.port.postMessage({t:'stopAt', time:at}); }
  halt() { this.node?.port.postMessage({t:'halt'}); this.startAt = null; }
  dispose() { this.halt(); this.node?.disconnect(); this.node = null; }
}
