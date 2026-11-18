// Turn a free-text intention and a few selections into a route of moods for planSession.
// Runs entirely on this device from a fixed word list: nothing is saved, sent or diagnosed.
// The route is a suggestion the listener can always edit.
import {MOODS, HOME} from './compose.js';

export const INTENSITIES = {gentle:{moods:1, returnHome:true}, moderate:{moods:2, returnHome:true}, full:{moods:3, returnHome:false}};
export const QUICK_PICKS = [
  {label:'Feel safe', mood:'holding'}, {label:'Let go', mood:'surrender'}, {label:'Grieve', mood:'release'},
  {label:'See the bigger picture', mood:'expanse'}, {label:'Feel connected', mood:'communion'}, {label:'Feel hopeful', mood:'renewal'}
];
// Word beginnings that point toward a mood. Deliberately small and readable.
const WORDS = {
  holding:   ['safe','comfort','gentle','ground','stead','held','overwhelm','protect','rest'],
  surrender: ['let go','letting go','trust','accept','allow','control','stop fighting','resist','relax','calm','anxi','fear','afraid','worr','stress','peace','surrender'],
  release:   ['grief','griev','loss','lost','sad','cry','tears','hurt','pain','heavy','carry','burden','mourn','miss','heartbr','anger','angry','shame','guilt','release'],
  expanse:   ['perspective','bigger','wonder','awe','clarity','space','open','curio','explor','understand','meaning','insight','stuck','vast'],
  communion: ['connect','love','loving','family','friend','partner','relationship','forgiv','gratitude','grateful','compassion','lonel','alone','belong','kind'],
  renewal:   ['hope','lighter','fresh','start','begin','energy','alive','joy','future','forward','new','motivat','heal','better','renew']
};
const ORDER = Object.keys(MOODS);

// Find which moods the text points to, strongest first, with the words that pointed there.
export function readIntention(text) {
  const lower = String(text ?? '').toLowerCase().slice(0, 2000), found = [];
  for (const mood of ORDER) {
    const matches = WORDS[mood].filter(word => new RegExp(`\\b${word.replace(/ /g, '\\s+')}`).test(lower));
    if (matches.length) found.push({mood, matches});
  }
  return found.sort((a, b) => b.matches.length - a.matches.length || ORDER.indexOf(a.mood) - ORDER.indexOf(b.mood));
}

// Build a route from chosen moods: home first and last; gentler sessions return home between moods.
export function buildRoute(moods, intensity = 'gentle') {
  const level = INTENSITIES[intensity];
  if (!level) throw new Error(`Unknown intensity: ${intensity}`);
  const away = [...new Set(moods)].filter(mood => MOODS[mood] && mood !== HOME).slice(0, level.moods)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const route = [HOME];
  for (const [i, mood] of away.entries()) { if (i && level.returnHome) route.push(HOME); route.push(mood); }
  if (away.length) route.push(HOME);
  return route;
}

// Free text plus selections -> suggested route with plain reasons. Selections win over text.
export function suggestRoute({text = '', picks = [], intensity = 'gentle'} = {}) {
  const read = readIntention(text), chosen = picks.filter(mood => MOODS[mood]);
  const moods = [...chosen, ...read.map(item => item.mood)];
  const understood = moods.length > 0, route = buildRoute(understood ? moods : ['surrender'], intensity);
  const reasons = route.filter((mood, i) => mood !== HOME || route.length === 1 && i === 0).map(mood => ({mood,
    because: chosen.includes(mood) ? 'you selected it' : read.find(item => item.mood === mood)?.matches.slice(0, 3).join(', ') ?? 'a gentle default'}));
  return {route, intensity, understood, reasons, characters:Object.fromEntries(route.map(mood => [mood, MOODS[mood].character]))};
}
