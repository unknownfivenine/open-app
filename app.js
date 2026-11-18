import {ListeningAudio} from './audio.js';
import {Transport} from './transport.js';
import {phase} from './music.js';
import {planSession, replan, remainingRoute, moodAt, MOODS} from './compose.js';
import {suggestRoute, QUICK_PICKS} from './intention.js';
import {routeShape, partAt, routeSentence, reasonSentence, LOOK, title} from './route.js';
const $ = id => document.getElementById(id), audio = new ListeningAudio();
let preparing = false, finished = false, plan = null, playhead = null, held = null, changing = false;
const picks = new Set(), SVG = 'http://www.w3.org/2000/svg';
function svg(name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
// Intention text and selections -> suggested route -> session plan -> drawing.
function drawRoute() {
  // A prepared sound belongs to the route it was prepared for.
  if (audio.ready && !audio.nodes.length) { audio.ready = false; $('prepareStatus').textContent = 'The route changed. Prepare the sound again.'; }
  const suggestion = suggestRoute({text:$('intention').value, picks:[...picks],
    intensity:document.querySelector('input[name=intensity]:checked').value});
  $('routeTitle').textContent = routeSentence(suggestion.route);
  $('because').textContent = reasonSentence(suggestion.reasons);
  for (const button of $('picks').querySelectorAll('button')) button.setAttribute('aria-pressed', String(picks.has(button.dataset.mood)));
  const drawing = $('path'); drawing.replaceChildren(); playhead = null;
  try { plan = planSession({moods:suggestion.route, minutes:Number($('duration').value) / 60, seed:Number($('seed').value) >>> 0, intensity:suggestion.intensity}); }
  catch { plan = null; $('path').replaceChildren(); $('because').textContent = 'This listening time is too short for that many moods. Choose a longer time or travel less far.'; return; }
  drawPlan(suggestion.route);
}
function drawPlan(moods) {
  const drawing = $('path'); drawing.replaceChildren();
  const shape = routeShape(plan);
  for (const band of shape.bands) if (band.kind === 'segment')
    drawing.append(svg('rect', {x:band.x, y:0, width:band.width, height:140, fill:band.color, opacity:.16}));
  drawing.append(svg('path', {d:shape.d, class:'line'}));
  playhead = svg('line', {x1:0, x2:0, y1:0, y2:140, class:'playhead', visibility:'hidden'}); drawing.append(playhead);
  const legend = $('legend'); legend.replaceChildren();
  for (const mood of [...new Set(moods)]) {
    const item = document.createElement('li'); item.style.setProperty('--c', LOOK[mood].color);
    item.textContent = `${title(mood)}: ${MOODS[mood].character.join(', ')}`; legend.append(item);
  }
}
const transport = new Transport(audio, render);
function render() {
  const elapsed = audio.elapsed(), active = transport.intent;
  $('play').disabled = !audio.ready || preparing || (active && transport.state !== 'interrupted') || finished;
  $('pause').disabled = !active;
  $('stop').disabled = !audio.ready || preparing;
  $('soften').disabled = !active; $('gentle').disabled = !active;
  const steerable = active && !!audio.sampler && audio.endAt === null && !changing && audio.duration - elapsed > 40;
  $('hold').disabled = !steerable; $('home').disabled = !steerable || (!held && plan?.mode === 'home');
  $('hold').textContent = held ? 'Continue the route' : 'Stay here'; $('hold').setAttribute('aria-pressed', String(!!held));
  $('prepare').disabled = preparing || active;
  const underway = audio.nodes.length > 0 && !finished;
  for (const id of ['seed','duration','breathing','intention','picks','intensity']) $(id).disabled = preparing || active || underway;
  if (playhead) {
    const x = Math.min(1000, elapsed / audio.duration * 1000);
    playhead.setAttribute('x1', x); playhead.setAttribute('x2', x); playhead.setAttribute('visibility', underway ? 'visible' : 'hidden');
  }
  $('play').textContent = ['paused','interrupted'].includes(transport.state) ? 'Resume listening' : 'Begin listening';
  $('soften').setAttribute('aria-pressed',String(audio.soft));
  $('phase').textContent = finished ? 'Complete' : audio.nodes.length ? phase(elapsed,audio.duration) + (plan ? `, in ${partAt(plan, elapsed * plan.seconds / audio.duration)}` : '') : 'Ready when you are';
  $('clock').textContent = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`;
  $('headline').textContent = finished ? 'Take your time.' : active ? 'You can simply listen.' : transport.state === 'paused' ? 'A moment of quiet.' : 'Make a little room.';
  const messages = {ready:'Prepare your sound, then begin.',playing:'Playing · automatic recovery is on.',recovering:'Reconnecting your sound…',interrupted:'Interrupted · attempting to resume automatically. If the browser blocks it, tap Resume.',paused:'Paused by you · automatic recovery is off.',stopped:'Quiet · prepare or begin again when you wish.'};
  $('status').textContent = finished ? 'The music has ended. Follow your care team’s guidance.' : audio.endAt !== null && active ? 'Returning gently to quiet…' : messages[transport.state];
  $('diagnostics').textContent = `Audio: ${audio.ctx?.state ?? 'not created'} · intent: ${active ? 'listen' : 'quiet'} · recovery attempts: ${transport.failures} · media bridge: ${audio.bridgeError ? 'blocked (lock-screen behavior uncertain)' : audio.bridge?.paused === false ? 'playing' : 'idle'}.`;
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = active ? 'playing' : 'paused'; } catch {}
}
$('prepare').onclick = async () => {
  if (preparing) return;
  transport.stop(); preparing = true; finished = false; render();
  $('prepareStatus').textContent = 'Loading the instruments for this route…';
  try {
    await audio.prepare(Number($('seed').value) >>> 0,Number($('duration').value),$('breathing').checked,plan);
    $('prepareStatus').textContent = audio.sampler ? `Ready: ${audio.sampler.instruments.join(', ').toLowerCase()}. Begin when you are comfortable.`
      : 'The recordings could not be loaded, so this session uses the simpler built-in sound. Begin when you are comfortable.';
  } catch (error) { $('prepareStatus').textContent = `Could not prepare sound: ${error.message}`; }
  finally { preparing = false; render(); }
};
for (const pick of QUICK_PICKS) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = pick.label;
  button.dataset.mood = pick.mood; button.style.setProperty('--c', LOOK[pick.mood].color);
  button.onclick = () => { picks.has(pick.mood) ? picks.delete(pick.mood) : picks.add(pick.mood); drawRoute(); };
  $('picks').append(button);
}
// Settings that say nothing about how the listener feels are remembered on this device.
// The intention and the direction chips are never stored.
const PREFS = 'open-preferences-v1';
function savePreferences() {
  try { localStorage.setItem(PREFS, JSON.stringify({intensity:document.querySelector('input[name=intensity]:checked').value,
    duration:$('duration').value, volume:$('volume').value, breathing:$('breathing').checked})); } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
  const radio = document.querySelector(`input[name=intensity][value="${CSS.escape(String(saved.intensity ?? ''))}"]`);
  if (radio) radio.checked = true;
  if ([...$('duration').options].some(o => o.value === saved.duration)) $('duration').value = saved.duration;
  if (Number(saved.volume) >= 0 && Number(saved.volume) <= 1) { $('volume').value = saved.volume; audio.volume = Number(saved.volume); }
  if (typeof saved.breathing === 'boolean') $('breathing').checked = saved.breathing;
} catch {}
for (const id of ['intensity','duration','volume','breathing']) $(id).addEventListener('change', savePreferences);
$('intention').oninput = drawRoute;
// A new piece each visit; the seed stays visible under More options so a session can be repeated.
try { $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0] % 100000; } catch {}
for (const id of ['duration','seed','intensity']) $(id).addEventListener('change', drawRoute);
drawRoute();
// Change the rest of the session from a moment a few seconds ahead; earlier music stays as it was.
async function steer(mode) {
  if (!plan || changing) return;
  const at = Math.min(audio.duration - 31, audio.elapsed() + 3);
  const route = mode === 'hold' ? remainingRoute(plan, at) : null;
  const next = replan(plan, at, mode, mode === 'continue' ? held : undefined);
  if (!next) { $('status').textContent = 'Too little time is left to change the route.'; return; }
  changing = true; render();
  try {
    await audio.sampler.replace(next, at); plan = next;
    held = mode === 'hold' ? route : null;
    const here = title(moodAt(plan, at));
    $('because').textContent = mode === 'hold' ? `Staying in ${here} until you continue.`
      : mode === 'home' ? 'Returning to Holding over about a minute and a half, then staying there.'
      : `Continuing: ${routeSentence(plan.moods)}.`;
    $('routeTitle').textContent = routeSentence([...new Set(plan.parts.filter(p => p.kind === 'segment').map(p => p.mood))]);
    drawPlan(plan.moods);
  } finally { changing = false; render(); }
}
$('hold').onclick = () => steer(held ? 'continue' : 'hold');
$('home').onclick = () => steer('home');
$('play').onclick = () => transport.play();
$('pause').onclick = () => transport.pause();
$('stop').onclick = () => { transport.stop(); audio.reset(); finished = false; held = null; if (plan?.changedAt != null) drawRoute(); render(); };
$('soften').onclick = () => { audio.soft = !audio.soft; audio.setLevel(); render(); };
$('gentle').onclick = () => { audio.endGently(); $('status').textContent = 'A gentle return to quiet over 15 seconds.'; };
$('volume').oninput = () => { audio.volume = Number($('volume').value); if (transport.intent) audio.setLevel(); };
function tick() {
  if (audio.complete() && !finished) { finished = true; transport.stop(); }
  else if (transport.intent) { void transport.tick(); audio.recoverBridge(); audio.tick(); }
  render();
}
for (const event of ['pageshow','focus']) window.addEventListener(event,tick);
document.addEventListener('visibilitychange',tick);
// Lull's background-worker heartbeat is a recovery opportunity, never the music clock.
try {
  const url = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000)'],{type:'text/javascript'}));
  const worker = new Worker(url); URL.revokeObjectURL(url); worker.onmessage = tick;
} catch {}
setInterval(tick,1000);
try {
  if (navigator.audioSession) navigator.audioSession.addEventListener('statechange',tick);
  navigator.mediaSession.metadata = new MediaMetadata({title:'OPEN · A space to listen',artist:'OPEN',album:'Personal instrumental listening'});
  navigator.mediaSession.setActionHandler('play',() => { if (audio.ready && !finished && !preparing) void transport.play(); });
  navigator.mediaSession.setActionHandler('pause',() => transport.pause());
  navigator.mediaSession.setActionHandler('stop',() => { transport.stop(); audio.reset(); render(); });
} catch {}
if ('serviceWorker' in navigator) {
  // When a newer version takes over, reload to use it, unless a session is prepared or playing.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (!audio.ready && !preparing && !audio.nodes.length) location.reload();
    else $('offline').textContent = 'Update ready: it applies the next time you open OPEN';
  });
  navigator.serviceWorker.register('./sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    $('offline').textContent = 'Offline files ready';
  }).catch(() => { $('offline').textContent = 'Offline setup unavailable'; });
} else $('offline').textContent = 'Offline setup unavailable';
render();
// For automated browser tests only: ?test exposes the player objects.
if (new URLSearchParams(location.search).has('test')) window.__open = {audio, transport, get plan() { return plan; }};
