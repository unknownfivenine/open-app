// SPDX-License-Identifier: MPL-2.0
// Written for OPEN after fm1-amb's web/app/worklet.js (Copyright (C) 2026 Charles Vestal).
// Runs the AMB-1 engine (amb.wasm, unmodified) on the audio thread. OPEN sends a timed schedule of
// settings; each one is applied when the audio clock reaches it, so changes land on time even while the
// page is hidden or throttled. Level changes glide over several seconds. The engine renders at 44.1 kHz;
// at any other device rate its output is resampled here so pitch stays true.

const ENGINE_RATE = 44100, BLOCK = 128;

class OpenAmb extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ex = null; this.items = []; this.gain = 0; this.target = 0; this.stopAt = Infinity;
    this.ratio = ENGINE_RATE / sampleRate; this.pos = BLOCK; this.prevL = 0; this.prevR = 0;
    this.port.onmessage = event => this.receive(event.data);
  }

  async receive(m) {
    if (m.t === 'load') {
      const {instance} = await WebAssembly.instantiate(m.wasm, {});
      this.ex = instance.exports; this.ex.app_init();
      this.port.postMessage({t:'ready', sampleRate});
    } else if (m.t === 'schedule') {
      // Replace everything from m.from on; earlier items have already been applied.
      this.items = this.items.filter(item => item.time < m.from).concat(m.items).sort((a, b) => a.time - b.time);
      this.stopAt = Infinity;
    } else if (m.t === 'stopAt') {
      this.stopAt = m.time;
    } else if (m.t === 'halt' && this.ex) {
      this.items = []; this.ex.app_play(0); this.ex.app_panic(); this.gain = this.target = 0;
    }
  }

  apply(item) {
    const ex = this.ex;
    if (item.seed !== undefined) ex.app_seed(item.seed >>> 0);
    for (const [param, value] of item.set ?? []) ex.app_set(param, value);
    if (item.pool !== undefined) ex.app_pool(item.pool);
    if (item.next) ex.app_next();
    if (item.play !== undefined) ex.app_play(item.play ? 1 : 0);
    if (item.gain !== undefined) this.target = item.gain;
  }

  // The engine's next block of 128 frames, at its own rate.
  engineBlock() {
    const ex = this.ex;
    if (this.l) { this.prevL = this.l[BLOCK - 1]; this.prevR = this.r[BLOCK - 1]; }   // the views are overwritten next
    ex.app_render(BLOCK, 4096);
    if (this.mem !== ex.memory.buffer) {
      this.mem = ex.memory.buffer;
      this.l = new Float32Array(this.mem, ex.app_out_l(), BLOCK); this.r = new Float32Array(this.mem, ex.app_out_r(), BLOCK);
    }
    this.pos -= BLOCK;
  }

  process(inputs, outputs) {
    const out = outputs[0], left = out[0], right = out[1] ?? out[0], n = left.length;
    if (!this.ex) return true;
    while (this.items.length && this.items[0].time <= currentTime) this.apply(this.items.shift());
    if (currentTime >= this.stopAt) { this.ex.app_play(0); this.stopAt = Infinity; }
    // Levels glide: about four seconds to settle on a new one.
    const glide = 1 - Math.exp(-32 / (sampleRate * 1.5));
    for (let i = 0; i < n; i++) {
      if (this.pos >= BLOCK) this.engineBlock();
      const k = Math.floor(this.pos), f = this.pos - k;
      const l0 = k > 0 ? this.l[k - 1] : this.prevL, r0 = k > 0 ? this.r[k - 1] : this.prevR;
      // Linear interpolation between the engine's samples (exact when the rates match).
      left[i] = (l0 + (this.l[k] - l0) * f) * this.gain; right[i] = (r0 + (this.r[k] - r0) * f) * this.gain;
      this.pos += this.ratio;
      if (i % 32 === 0) this.gain += (this.target - this.gain) * glide;
    }
    return true;
  }
}

registerProcessor('open-amb', OpenAmb);
