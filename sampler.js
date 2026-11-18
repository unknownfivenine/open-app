// Plays a session plan with OPEN's recorded instruments.
// planEvents is pure (plan -> timed sound events). Sampler loads recordings and schedules those
// events on the audio clock, a few minutes ahead at a time, so a throttled page keeps playing.
import {MOODS} from './compose.js';
import {sampleFor, SEATING} from './instruments.js';

// Levels are matched to each recording's measured loudness (samples/manifest.json). TARGET and the layer
// gains were set from offline renders so a full mix peaks near 0.5 before the listening-level control.
const TARGET = .5, LAYER_GAIN = {bed:.5, voice:.6};
// Sustained notes: the recording's own attack is heard once; longer notes continue from its steady part
// (after BOW seconds) with equal-power crossfades, so a held note never sounds re-bowed. The last
// TAIL seconds of each recording are its trimmed fade and are not used for holding.
const BOW = 1.5, CROSS = 1.5, TAIL = 2;

// Long bed notes are held by overlapping, slowly swelling repeats of the same recording.
export function planEvents(plan, manifest, secondsOf = () => 10) {
  const events = [];
  for (const part of plan.parts ?? [{start:0, ...plan}]) {
    for (const layer of ['bed','voice']) for (const note of part.layers[layer]) {
      if (note.at >= part.seconds) continue;   // a part cut short by a change of route keeps only what it reached
      const mood = MOODS[note.mood] ? note.mood : part.mood ?? part.from;
      const s = sampleFor(manifest, layer, note.midi, mood, note.part), length = secondsOf(s.url), real = length / s.rate;
      const gain = Math.min(12, note.velocity * TARGET / s.level) * LAYER_GAIN[layer];
      const base = {url:s.url, rate:s.rate, layer, gain, peak:gain * s.level,   // expected loudness (RMS) of this event at full envelope
                    pan:SEATING[s.instrument] ?? ((note.midi * 37) % 5 - 2) * (layer === 'bed' ? .22 : .11)};
      const at = part.start + note.at;
      if (layer === 'voice') events.push({...base, at, dur:Math.min(real, Math.max(note.dur, 4) + 2), attack:.02, release:Math.min(2, real * .3)});
      else {
        // Buffer seconds usable for holding, measured in real time at this playback rate.
        const bow = Math.min(BOW, Math.max(.3, (length - TAIL) / 3)), first = Math.max(2, (length - TAIL) / s.rate);
        const body = Math.max(2, (length - TAIL - bow) / s.rate), release = Math.min(1.5, note.dur / 3), want = note.dur + release;
        let t = 0, offset = 0, span = first, attack = Math.min(.6, note.dur / 3), shape = 'linear';
        for (;;) {
          const last = t + span >= want;
          // A final piece is long enough to finish its crossfade before releasing.
          const dur = last ? Math.min(span, Math.max(want - t, attack + .8)) : span;
          events.push({...base, at:at + t, dur, offset, attack, release:last ? Math.min(release, dur - attack) : CROSS, shape, joined:!last});
          if (last) break;
          t += span - CROSS; offset = bow; span = body; attack = CROSS; shape = 'equal';
        }
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

const curves = new Map();
function curve(level, rising) {
  const key = `${level}:${rising}`;
  if (!curves.has(key)) curves.set(key, Float32Array.from({length:32}, (_, i) => level * Math.sin((rising ? i : 31 - i) / 31 * Math.PI / 2)));
  return curves.get(key);
}

export class Sampler {
  constructor(ctx, manifest, destination) {
    this.ctx = ctx; this.manifest = manifest; this.destination = destination;
    this.buffers = new Map(); this.pans = new Map(); this.live = new Set(); this.events = []; this.next = 0;
    this.until = Infinity; this.startAt = null; this.marker = ctx.createGain();
  }
  // Fetch and decode every recording the plan needs. Throws if any is missing, so the caller can fall back.
  async fetchAll(urls) {
    await Promise.all(urls.filter(url => !this.buffers.has(url)).map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Missing recording: ${url}`);
      this.buffers.set(url, await this.ctx.decodeAudioData(await response.arrayBuffer()));
    }));
  }
  async load(plan) {
    await this.fetchAll([...new Set(planEvents(plan, this.manifest).map(event => event.url))]);
    this.events = planEvents(plan, this.manifest, url => this.buffers.get(url).duration);
    this.instruments = [...new Set(this.events.map(event => this.manifest.instruments[event.url.split('/')[1]].label.split(',')[0]))];
  }
  // Swap in a changed plan from session time `from`. Notes already sounding finish naturally; notes
  // scheduled but not yet started are cancelled. A recording that cannot load is skipped, never fatal.
  async replace(plan, from) {
    const wanted = planEvents(plan, this.manifest).filter(event => event.at >= from).map(event => event.url);
    await Promise.allSettled([...new Set(wanted)].map(url => this.fetchAll([url])));
    const now = this.ctx.currentTime;
    for (const source of [...this.live]) if (source.startTime > now + .05) this.cancel(source);
    this.events = planEvents(plan, this.manifest, url => this.buffers.get(url)?.duration ?? 10)
      .filter(event => event.at >= from && this.buffers.has(event.url));
    this.next = 0; this.until = Infinity; this.topUp();
  }
  cancel(source) {
    source.onended = null;
    try { source.stop(); } catch {}
    source.disconnect(); source.gainNode?.disconnect(); this.live.delete(source);
  }
  begin(startAt) { this.startAt = startAt; this.next = 0; this.until = Infinity; this.topUp(); }
  // Schedule everything that starts within the next `horizon` seconds of session time.
  topUp(horizon = 600) {
    if (this.startAt === null) return;
    const limit = Math.min(this.ctx.currentTime - this.startAt + horizon, this.until);
    while (this.next < this.events.length && this.events[this.next].at < limit) this.play(this.events[this.next++]);
  }
  play(event) {
    if (!this.buffers.has(event.url)) return;
    const ctx = this.ctx, due = this.startAt + event.at, start = Math.max(due, ctx.currentTime), late = start - due;
    if (late >= event.dur - .1) return;
    const end = due + event.dur, attack = late > 0 ? .05 : event.attack;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = this.buffers.get(event.url); source.playbackRate.value = event.rate;
    if (event.shape === 'equal' || event.joined) {
      // Equal-power curves keep the level steady through a crossfade between two parts of one note.
      gain.gain.setValueAtTime(0, start);
      if (event.shape === 'equal') gain.gain.setValueCurveAtTime(curve(event.gain, true), start, attack);
      else gain.gain.linearRampToValueAtTime(event.gain, start + attack);
      const fadeAt = Math.max(start + attack, end - event.release);
      gain.gain.setValueAtTime(event.gain, fadeAt);
      if (event.joined) gain.gain.setValueCurveAtTime(curve(event.gain, false), fadeAt, end - fadeAt);
      else gain.gain.linearRampToValueAtTime(0, end);
    } else {
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(event.gain, start + attack);
      gain.gain.setValueAtTime(event.gain, Math.max(start + attack, end - event.release)); gain.gain.linearRampToValueAtTime(0, end);
    }
    if (!this.pans.has(event.pan)) {
      const panner = ctx.createStereoPanner(); panner.pan.value = event.pan; panner.connect(this.destination); this.pans.set(event.pan, panner);
    }
    source.connect(gain); gain.connect(this.pans.get(event.pan));
    source.onended = () => { gain.disconnect(); this.live.delete(source); };
    source.startTime = start; source.gainNode = gain;
    source.start(start, (event.offset ?? 0) + late * event.rate); source.stop(end + .05); this.live.add(source);
  }
  // Nothing new after `at`; whatever is sounding stops there.
  stopAll(at) {
    this.until = at - this.startAt;
    for (const source of this.live) { try { source.stop(at); } catch {} }
  }
  halt() {
    for (const source of [...this.live]) this.cancel(source);
    this.live.clear(); this.startAt = null; this.next = 0;
  }
  dispose() { this.halt(); for (const panner of this.pans.values()) panner.disconnect(); this.pans.clear(); this.buffers.clear(); }
}
