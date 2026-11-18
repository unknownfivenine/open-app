import {plan, renderLoop, RATE, arc} from './music.js';
import {Sampler} from './sampler.js';
export function silentWav() {
  const bytes = new ArrayBuffer(8044), v = new DataView(bytes);
  const str = (o,s) => [...s].forEach((c,i) => v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF'); v.setUint32(4,8036,true); str(8,'WAVEfmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,8000,true); v.setUint32(28,8000,true);
  v.setUint16(32,1,true); v.setUint16(34,8,true); str(36,'data'); v.setUint32(40,8000,true);
  new Uint8Array(bytes,44).fill(128); return bytes;
}
export class ListeningAudio {
  constructor() { this.ctx = null; this.buffers = []; this.nodes = []; this.duration = 3600; this.endAt = null; this.soft = false; this.volume = .6; this.ready = false; this.bridgeError = false; }
  init() {
    if (this.ctx) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.arcGain = this.ctx.createGain(); this.arcGain.gain.value = 0;
    this.phraseGain = this.ctx.createGain(); this.phraseGain.gain.value = 1;
    this.level = this.ctx.createGain(); this.level.gain.value = this.volume;
    // A safety limiter on rare peaks only; the music's own dynamics pass through untouched.
    const guard = this.ctx.createDynamicsCompressor(); guard.threshold.value = -6; guard.knee.value = 0; guard.ratio.value = 20;
    guard.attack.value = .003; guard.release.value = .25;
    this.arcGain.connect(this.phraseGain); this.phraseGain.connect(this.level); this.level.connect(guard); guard.connect(this.ctx.destination);
    this.bridge = new Audio(URL.createObjectURL(new Blob([silentWav()], {type:'audio/wav'})));
    this.bridge.loop = true; this.bridge.setAttribute('playsinline','');
    this.bridge.addEventListener('playing',() => { if (!this.wanted) this.bridge.pause(); });
  }
  async prepare(seed, duration, breathing, session = null) {
    this.init(); this.ready = false; this.reset(); this.duration = duration; this.breathing = breathing;
    this.buffers = [];
    for (const layer of plan(seed)) {
      // Yield between layers so setup controls remain responsive.
      await new Promise(resolve => setTimeout(resolve,0));
      const pcm = renderLoop(layer), buffer = this.ctx.createBuffer(1,pcm.length,RATE);
      buffer.copyToChannel(pcm,0); this.buffers.push({buffer,pan:layer.pan});
    }
    // Recorded instruments play the session plan when they can be loaded; the loops above remain the fallback.
    this.sampler?.dispose(); this.sampler = null;
    if (session) try {
      const manifest = await (await fetch('samples/manifest.json')).json();
      const sampler = new Sampler(this.ctx, manifest, this.arcGain);
      await sampler.load(session); this.sampler = sampler;
    } catch { this.sampler = null; }
    this.ready = true;
  }
  tick() { if (this.nodes.length) this.sampler?.topUp(); }
  startGraph() {
    if (this.nodes.length) return;
    this.startAt = this.ctx.currentTime;
    if (this.sampler) { this.sampler.begin(this.startAt); this.nodes.push(this.sampler.marker); }
    else for (const {buffer,pan} of this.buffers) {
      const source = this.ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const panner = this.ctx.createStereoPanner(); panner.pan.value = pan;
      source.connect(panner); panner.connect(this.arcGain); source.start(this.startAt); this.nodes.push(source,panner);
    }
    // Audio-clock modulation continues without timers; it is musical phrasing, not breath instruction.
    if (this.breathing) {
      const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain();
      lfo.frequency.value = .1; depth.gain.value = .07;
      this.phraseGain.gain.value = .93;
      this.phraseGain.gain.setValueAtTime(.93,this.startAt); this.phraseGain.gain.linearRampToValueAtTime(1,this.startAt+180);
      depth.gain.setValueAtTime(.07,this.startAt); depth.gain.linearRampToValueAtTime(0,this.startAt+180);
      lfo.connect(depth); depth.connect(this.phraseGain.gain); lfo.start(); lfo.stop(this.startAt+181); this.nodes.push(lfo,depth);
    }
    this.scheduleArc();
  }
  scheduleArc() {
    const t = this.ctx.currentTime, elapsed = this.elapsed();
    this.arcGain.gain.cancelScheduledValues(t);
    this.arcGain.gain.setValueAtTime(arc(elapsed,this.duration),t);
    const times = [12,this.duration*.1,this.duration*.25,this.duration*.7,this.duration*.9,this.duration-45,this.duration];
    for (const sec of [...new Set(times)].sort((a,b) => a-b)) {
      if (sec > elapsed) this.arcGain.gain.linearRampToValueAtTime(arc(sec,this.duration),this.startAt+sec);
    }
    // Source stop is scheduled by the audio engine, not a hidden-page timer.
    for (const node of this.nodes) if (node instanceof AudioBufferSourceNode) node.stop(this.startAt+this.duration);
    this.sampler?.stopAll(this.startAt+this.duration);
  }
  async resume(stillWanted = () => true) {
    if (!this.ready) throw new Error('Prepare the sound first');
    this.wanted = true;
    // Both playback requests originate together; bridge failure must not block audible audio.
    const bridgePlay = this.bridge.play().then(() => { this.bridgeError = false; }, () => { this.bridgeError = true; });
    await this.ctx.resume();
    if (!stillWanted()) return;
    if (this.ctx.state !== 'running') throw new Error('Audio interrupted');
    this.startGraph(); this.setLevel();
    // Silence is controlled in the audio graph even when suspend/resume races.
    this.level.gain.setTargetAtTime(this.volume * (this.soft ? .54 : 1),this.ctx.currentTime,.25);
    // Do not await an unresolved media play() promise after a call.
    void bridgePlay;
  }
  running() { return this.ctx?.state === 'running'; }
  recoverBridge(now = Date.now()) {
    if (!this.wanted || !this.bridge?.paused || now < (this.bridgeRetryAt ?? 0)) return;
    this.bridgeRetryAt = now + 10000;
    void this.bridge.play().then(() => { this.bridgeError = false; },() => { this.bridgeError = true; });
  }
  silence() {
    this.wanted = false;
    if (!this.ctx) return;
    this.level.gain.cancelScheduledValues(this.ctx.currentTime); this.level.gain.setValueAtTime(0,this.ctx.currentTime);
    this.bridge.pause(); void this.ctx.suspend().catch(() => {});
  }
  setLevel() {
    if (!this.ctx) return;
    this.level.gain.cancelScheduledValues(this.ctx.currentTime);
    this.level.gain.setTargetAtTime(this.volume * (this.soft ? .54 : 1),this.ctx.currentTime,.4);
  }
  elapsed() { return this.nodes.length ? Math.max(0,this.ctx.currentTime-this.startAt) : 0; }
  endGently() {
    if (!this.nodes.length || this.endAt !== null) return;
    this.endAt = this.ctx.currentTime + 15;
    const p = this.arcGain.gain, now = this.ctx.currentTime;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now);
    else { const value = p.value; p.cancelScheduledValues(now); p.setValueAtTime(value,now); }
    p.linearRampToValueAtTime(0,this.endAt);
    for (const node of this.nodes) if (node instanceof AudioBufferSourceNode) node.stop(this.endAt);
    this.sampler?.stopAll(this.endAt);
  }
  complete() { return this.nodes.length > 0 && (this.ctx.currentTime >= (this.endAt ?? this.startAt + this.duration)); }
  reset() {
    this.silence(); this.sampler?.halt();
    for (const node of this.nodes) { try { node.stop?.(); } catch {} node.disconnect(); }
    this.nodes = []; this.endAt = null; this.startAt = null; this.soft = false;
    if (this.ctx) { this.phraseGain.gain.cancelScheduledValues(this.ctx.currentTime); this.phraseGain.gain.value = 1; }
  }
}
