// OPEN's recorded instruments: which recording plays a planned note, and at what speed.
// Recordings live in samples/ with their provenance in samples/manifest.json. No audio is loaded here.
import {nearestSample} from './compose.js';

// Casting: which instruments play each layer in each mood. A bed cast as parts gives each part of
// the string writing its own section, as an orchestrator would. First drafts, to be tuned by listening.
const SECTIONS = {bass:['cellos'], tenor:['violas','cellos'], alto:['violas','violins'], top:['violins']};
export const CASTING = {
  holding:   {bed:SECTIONS, voice:['piano']},
  surrender: {bed:SECTIONS, voice:['harp']},
  release:   {bed:SECTIONS, voice:['piano']},
  expanse:   {bed:['organ'], voice:['hand-chimes']},
  communion: {bed:SECTIONS, voice:['kalimba','harp']},
  renewal:   {bed:SECTIONS, voice:['marimba','harp']}
};
export const MAX_SHIFT = 4;   // semitones a recording may be sped up or slowed before it sounds unnatural
export const STRING_SHIFT = 2; // strings tolerate less: shifting changes the speed of their vibrato
const STRINGS = new Set(['violins','violas','cellos','strings','cello']);
// Orchestra seating, left to right: violins, violas, cellos.
export const SEATING = {violins:-.35, strings:-.2, violas:.05, cellos:.3, cello:.3};

function castFor(mood, layer, part) {
  const cast = CASTING[mood]?.[layer];
  if (!cast) return [];
  if (Array.isArray(cast)) return cast;
  return cast[part] ?? [...new Set(Object.values(cast).flat())];
}
// Choose, from the instruments cast for this mood, layer and part, the recording closest in pitch to
// the note. A string recording more than STRING_SHIFT away loses to any closer recording that is cast.
export function sampleFor(manifest, layer, midi, mood = 'holding', part) {
  let best = null;
  for (const instrument of castFor(mood, layer, part)) {
    const {sample, rate} = nearestSample(midi, manifest.instruments[instrument].notes), shift = Math.abs(midi - sample);
    const cost = shift + (STRINGS.has(instrument) && shift > STRING_SHIFT ? 10 : 0);
    if (!best || cost < best.cost) best = {instrument, sample, rate, shift, cost, url:`samples/${instrument}/${sample}.mp3`,
      level:manifest.instruments[instrument].loudness?.[sample] ?? manifest.instruments[instrument].referenceLevel};
  }
  if (!best) throw new Error(`No instruments cast for ${mood} ${layer}`);
  return best;
}

// Every distinct recording a plan needs, so they can all be loaded before a session starts.
export function samplesNeeded(manifest, plan) {
  const urls = new Set();
  for (const part of plan.parts ?? [plan]) for (const layer of ['bed','voice'])
    for (const note of part.layers[layer]) urls.add(sampleFor(manifest, layer, note.midi, CASTING[note.mood] ? note.mood : part.mood ?? part.from, note.part).url);
  return [...urls].sort();
}
