// OPEN adaptation of Lull's instrumental, incommensurate prepared-loop approach.
// Original synthesis only: no recordings, remote services or copied repertoire.
export const RATE = 24000;
export function random(seed) {
  let x = seed >>> 0;
  return () => { x += 0x6D2B79F5; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function plan(seed = 42) {
  const r = random(seed), chord = [48, 55, 60, 64, 67, 72];
  return [31, 43, 59, 71].map((seconds, layer) => ({seconds, pan: [-.55,.4,-.2,.2][layer],
    notes: Array.from({length: layer === 3 ? 2 : 4}, (_, i) => ({
      at: (i + .1 + r() * .45) * seconds / (layer === 3 ? 2 : 4),
      midi: chord[Math.floor(r() * (layer === 3 ? 3 : chord.length))],
      velocity: .3 + r() * .2, bed: layer === 3
    }))}));
}
export function renderLoop(layer, rate = RATE) {
  const pcm = new Float32Array(Math.round(layer.seconds * rate));
  for (const note of layer.notes) {
    const f = 440 * 2 ** ((note.midi - 69) / 12), duration = note.bed ? 22 : 12;
    for (let i = 0; i < duration * rate; i++) {
      const t = i / rate, attack = 1 - Math.exp(-t / (note.bed ? 3 : .08));
      const env = note.bed ? Math.sin(Math.PI * t / duration) ** 2 : attack * Math.exp(-t / 2.5) * Math.min(1, (duration - t) / .7);
      // Lull-like stretched, slightly detuned fundamentals; folded tails keep loop edges continuous.
      const body = Math.sin(2*Math.PI*f*t) + .45*Math.sin(2*Math.PI*f*1.001*t)
        + .15*Math.sin(2*Math.PI*f*2.0008*t)*Math.exp(-t) + .04*Math.sin(2*Math.PI*f*3.005*t)*Math.exp(-t*2);
      pcm[(Math.round(note.at * rate) + i) % pcm.length] += body * env * note.velocity * (note.bed ? .06 : .12);
    }
  }
  return pcm;
}
export function phase(elapsed, duration) {
  const x = elapsed / duration;
  return x >= 1 ? 'Complete' : x < .08 ? 'Arrival' : x < .2 ? 'Onset' : x < .4 ? 'Ascent' : x < .7 ? 'Peak' : x < .9 ? 'Return' : 'Integration';
}
export function arc(elapsed, duration) {
  if (elapsed >= duration) return 0;
  const x = elapsed / duration;
  return Math.min(1, elapsed / 12, (duration - elapsed) / Math.min(45, duration * .1)) * (x < .25 ? .8 + .2*x/.25 : x < .7 ? 1 : 1 - .35*(x-.7)/.3);
}
