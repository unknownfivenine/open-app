// How a session plan is drawn and named on the page. Pure functions; no DOM.
export const LOOK = {
  holding:{color:'#d9a066', height:0}, surrender:{color:'#9fb7a4', height:.3}, release:{color:'#7f9bc4', height:.55},
  communion:{color:'#e39aa0', height:.5}, expanse:{color:'#b79ad6', height:1}, renewal:{color:'#e6d37a', height:.75}
};
export const title = mood => mood[0].toUpperCase() + mood.slice(1);
export const routeSentence = route => route.map(title).join(', then ');
const round = n => Math.round(n * 10) / 10;

// Bands (one per mood segment or bridge) and one line that rises with distance from Holding.
export function routeShape(plan, {width = 1000, top = 24, base = 118} = {}) {
  const x = seconds => round(seconds / plan.seconds * width), y = mood => round(base - (base - top) * LOOK[mood].height);
  const bands = []; let d = '';
  for (const part of plan.parts) {
    const x0 = x(part.start), x1 = x(part.start + part.seconds);
    if (part.kind === 'bridge') {
      const mid = round((x0 + x1) / 2);
      bands.push({kind:'bridge', x:x0, width:round(x1 - x0), label:`${title(part.from)} to ${title(part.to)}`});
      d += ` C${mid} ${y(part.from)} ${mid} ${y(part.to)} ${x1} ${y(part.to)}`;
    } else {
      bands.push({kind:'segment', x:x0, width:round(x1 - x0), mood:part.mood, color:LOOK[part.mood].color, y:y(part.mood), label:title(part.mood)});
      d += d ? ` L${x1} ${y(part.mood)}` : `M${x0} ${y(part.mood)} L${x1} ${y(part.mood)}`;
    }
  }
  return {bands, d};
}
export function partAt(plan, seconds) {
  const part = plan.parts.findLast(p => p.start <= seconds) ?? plan.parts[0];
  return part.kind === 'bridge' ? `${title(part.from)} to ${title(part.to)}` : title(part.mood);
}
export function reasonSentence(reasons) {
  return reasons.map(({mood, because}) => because === 'you selected it' ? `${title(mood)} because you chose it`
    : because === 'a gentle default' ? `${title(mood)} as a gentle default` : `${title(mood)} from “${because}”`).join('. ') + '.';
}
