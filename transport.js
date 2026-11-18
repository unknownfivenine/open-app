// Listener intent and actual browser state are deliberately distinct.
export class Transport {
  constructor(adapter, changed = () => {}, timeoutMs = 4000) {
    this.audio = adapter; this.changed = changed; this.intent = false; this.state = 'ready';
    this.epoch = 0; this.pending = null; this.retryAt = 0; this.failures = 0; this.timeoutMs = timeoutMs;
  }
  async play() {
    if (!this.intent) { this.intent = true; this.epoch++; }
    this.retryAt = 0;
    return this.recover();
  }
  async recover(now = Date.now()) {
    if (!this.intent || this.pending || now < this.retryAt) return;
    const epoch = this.epoch;
    this.state = 'recovering'; this.changed();
    // Promise starts in this gesture's task; no wait before requesting playback.
    let valid = true, timer;
    const operation = Promise.race([
      Promise.resolve().then(() => this.audio.resume(() => valid && epoch === this.epoch && this.intent)),
      new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Resume timeout')),this.timeoutMs); })
    ]);
    this.pending = operation;
    try {
      await operation;
      if (epoch !== this.epoch || !this.intent) { if (!this.intent) this.audio.silence(); return; }
      if (!this.audio.running()) throw new Error('Audio has not resumed');
      this.state = 'playing'; this.failures = 0;
    } catch {
      if (epoch === this.epoch && this.intent) {
        this.state = 'interrupted'; this.failures++;
        this.retryAt = now + Math.min(15000, 500 * 2 ** Math.min(this.failures, 5));
      }
    } finally {
      valid = false; clearTimeout(timer); this.pending = null; this.changed();
    }
  }
  pause() { this.intent = false; this.epoch++; this.state = 'paused'; this.audio.silence(); this.changed(); }
  stop() { this.pause(); this.state = 'stopped'; this.changed(); }
  tick(now = Date.now()) {
    if (this.intent && !this.audio.running()) return this.recover(now);
  }
}
