import './style.css';
import { dictionaries, type Key, type Language } from './i18n';
import { DEFAULTS, validateSettings, type Brain, type Settings } from './model';
import { ACTIONS, STATES, Game, brickRect, RULES, type Action } from './game';
import type { Command, Mode, Snapshot, WorkerMessage } from './protocol';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const readLocal = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, value: string) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
const savedLanguage = readLocal('lassen-language');
let language: Language = savedLanguage === 'en' || savedLanguage === 'zh' ? savedLanguage : 'ko';
const t = (key: Key) => dictionaries[language][key];
let snapshot: Snapshot | null = null, ready = false, toastTimer = 0, lastAutosave = -1, savePurpose: 'download' | 'local' = 'download', exportInFlight = false;
let dialogAction: 'reset' | 'settings' = 'reset', draftSettings: Settings = { ...DEFAULTS };
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const post = (command: Command) => worker.postMessage(command);
const fmt = (n: number) => n.toLocaleString(language === 'ko' ? 'ko-KR' : language === 'en' ? 'en-US' : 'zh-CN');
const button = (id: string, label: Key, cls = '') => `<button id="${id}" class="${cls}" data-t="${label}">${t(label)}</button>`;
const arrow = (direction: 'left' | 'right') => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction === 'left' ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'}"/></svg>`;
function render() {
  const open = new Set([...document.querySelectorAll('details[open]')].map(d => d.id));
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
  document.title = `L@SSEN AI · ${t('title')}`;
  $('#app').innerHTML = `
  <main class="workspace">
    <header class="brand-header"><div class="brand"><img src="${import.meta.env.BASE_URL}lassen-logo.svg" alt="L@SSEN AI"><span class="brand-tagline"><i></i>Link · AI · Solution<i></i></span></div><nav class="languages" aria-label="${t('language')}">${(['ko','en','zh'] as Language[]).map((l,i) => `<button data-lang="${l}" aria-pressed="${language===l}" lang="${l}" class="${language===l?'active':''}">${['한국어','English','中文'][i]}</button>`).join('')}</nav></header>
    <section class="intro"><div><h1>${t('title')}</h1><p>${t('subtitle')}</p></div><span class="local-badge"><span></span>${t('browser')}</span></section>
    <nav class="modes" aria-label="${t('title')}">${(['train','random','human','evaluate'] as Mode[]).map(m=>`<button data-mode="${m}" aria-pressed="${(snapshot?.mode??'train')===m}">${t(m)}</button>`).join('')}</nav>
    <p id="mode-description" class="mode-description"></p>
    <div class="lab-grid">
      <section class="game-panel panel"><header class="game-heading"><div><span>${t('score')}</span><strong id="score">0 <small>/ 60</small></strong></div><div class="game-meta"><span>${t('remaining')} <b id="bricks-count">60</b></span><span>${t('lives')} <b id="lives">3</b></span><span id="status" class="status">${t('initializing')}</span></div></header>
        <div class="game-wrap"><canvas id="game" aria-label="${t('game')}"></canvas><div id="game-overlay" class="game-overlay" hidden><strong id="end-title"></strong><p id="end-score"></p>${button('restart','restart')}</div></div>
        <div class="game-controls"><div class="run-controls">${button('run','start','primary')}${button('step','oneStep')}</div><div class="speed-controls"><span>${t('speed')}</span>${[1,5,50,300].map(n=>`<button data-speed="${n}" aria-pressed="${(snapshot?.speed??1)===n}">×${n}</button>`).join('')}</div></div>
        <div id="touch-controls" class="touch-controls" hidden><button data-action="1" aria-label="${t('left')}">${arrow('left')}<span>${t('left')}</span></button><button data-action="2" aria-label="${t('right')}"><span>${t('right')}</span>${arrow('right')}</button></div>
        <p class="panel-note" id="game-note">${t('gameHint')}</p>
      </section>
      <aside class="inspector"><details class="panel" id="state-panel" open><summary>${t('state')}<span class="chevron"></span></summary><div class="detail-body"><p class="micro">${t('normHint')}</p><div class="state-list">${STATES.map((key,i)=>`<div class="state-row"><span>${t(key === 'lives' ? 'lives' : key)}</span><span class="state-track"><i id="state-bar-${i}"></i></span><output id="state-${i}">—</output></div>`).join('')}</div><p class="micro">${t('stateHint')}</p></div></details>
        <section class="panel decision-panel"><h2>${t('decision')}</h2><div class="detail-body"><div class="q-list">${ACTIONS.map((a,i)=>`<div class="q-row" id="q-row-${i}"><span>${t(a)}</span><div class="q-track"><span class="zero-axis" id="q-zero-${i}"></span><i id="q-bar-${i}"></i></div><output id="q-${i}">—</output></div>`).join('')}</div><div class="decision-footer"><span>${t('choice')} <strong id="choice">—</strong></span><span>${t('reward')} <strong id="reward">0</strong></span></div><span id="selection-type" class="selection-tag">${t('exploit')}</span><p class="micro">${t('decisionHint')}</p></div></section>
      </aside>
      <section class="panel chart-panel"><header class="section-heading"><h2>${t('chart')}</h2><div class="legend"><span class="blue-key">${t('singleScore')}</span><span class="olive-key">${t('meanScore')}</span></div></header><div class="chart-area"><canvas id="chart" role="img" aria-label="${t('chartAccessible')}"></canvas><div id="chart-empty" class="chart-empty"><strong>${t('noChart')}</strong><p>${t('noChartHint')}</p></div></div><div class="chart-footer"><span>${t('episodes')} <b id="episodes">0</b></span><span>${t('average')} <b id="average">—</b></span></div><p class="panel-note">${t('chartHint')}</p></section>
      <section class="panel stats-panel"><h2>${t('stats')}</h2><dl class="stats-list"><div><dt>${t('epsilon')}</dt><dd><strong id="epsilon">100%</strong><meter id="epsilon-meter" min="0" max="1" value="1"></meter></dd></div><div><dt>${t('replay')}</dt><dd><strong id="memory">0 / 50,000</strong><meter id="memory-meter" min="0" max="50000" value="0"></meter></dd></div><div><dt>${t('target')}</dt><dd><strong id="target">1,000</strong> <small>${t('unitSteps')}</small></dd></div><div><dt>${t('steps')}</dt><dd id="steps">0</dd></div><div><dt>${t('updates')}</dt><dd id="updates">0</dd></div><div><dt>${t('loss')}</dt><dd id="loss">—</dd></div><div><dt>${t('actual')}</dt><dd><span id="throughput">0</span> <small>${t('perSecond')}</small></dd></div></dl><p id="warmup" class="micro"></p></section>
    </div>
    <section class="panel brain-panel"><div><h2>${t('brain')}</h2><p>${t('exportHint')}</p></div><div class="brain-buttons">${button('save','save','primary')}${button('load','load')}${button('restore','restore')}${button('reset','reset','text-button')}</div><input type="file" id="file" accept="application/json,.json" hidden><p class="micro full-width">${t('autosaveHint')} ${t('resumeHint')}</p></section>
    <section class="panel evaluation-panel" id="evaluation-panel" hidden><header class="section-heading"><h2>${t('evaluation')}</h2><span id="eval-progress"></span></header><p class="panel-note">${t('evalHint')}</p><progress id="eval-meter" max="20" value="0"></progress><div id="eval-results"></div><p id="eval-empty" class="micro">${t('evalEmpty')}</p></section>
    <div class="extras-grid"><details class="panel" id="logs-panel"><summary>${t('log')}<span class="chevron"></span></summary><div class="detail-body"><p class="micro">${t('logHint')}</p><ol id="logs" class="logs"></ol></div></details><details class="panel" id="settings-panel"><summary>${t('settings')}<span class="chevron"></span></summary><div class="detail-body"><p class="micro">${t('settingsHint')}</p><form id="settings-form"><div class="settings-grid">${(['learningRate','gamma','epsilonSteps','bufferSize','targetEvery','seed'] as (keyof Settings)[]).map(key=>{const bounds={learningRate:[0.00001,0.01,0.00001],gamma:[0,0.999,0.001],epsilonSteps:[1000,1000000,1000],bufferSize:[1000,100000,1000],targetEvery:[100,10000,100],seed:[0,4294967295,1]}[key]; return `<label>${t(key)}<input type="number" name="${key}" value="${snapshot?.settings[key]??DEFAULTS[key]}" min="${bounds[0]}" max="${bounds[1]}" step="${bounds[2]}" required></label>`}).join('')}</div><button class="primary" type="submit">${t('apply')}</button></form></div></details></div>
    <details class="education panel" id="education"><summary>${t('learn')}<span class="chevron"></span></summary><div class="detail-body"><p class="learning-flow">${t('learnIntro')}</p><div class="education-grid">${(['exploration','replay','target'] as const).map((item,i)=>`<article><span class="number">${i+1}</span><h3>${t(`${item}Title`)}</h3><p>${t(`${item}Text`)}</p></article>`).join('')}</div><div class="equation">${t('equation')}</div><h3>${t('notebook')}</h3><p class="micro">${t('notebookText')}</p><a href="${import.meta.env.BASE_URL}reference-dqn.ipynb" download>${t('notebookDownload')}</a></div></details>
    <footer><strong>L@SSEN AI</strong><span>${t('footer')}</span><p>${t('local')} ${t('help')}</p></footer>
  </main><div id="toast" class="toast" role="status" hidden></div>
  <dialog id="confirm-dialog"><h2>${t('resetTitle')}</h2><p id="dialog-description">${t('resetHint')}</p><div class="dialog-actions">${button('cancel-reset','cancel')}${button('confirm-reset','confirmReset','primary')}</div></dialog>`;
  for (const id of open) { const element = document.getElementById(id); if (element instanceof HTMLDetailsElement) element.open = true; }
  bind(); update(); draw();
}
function toast(key: Key) { window.clearTimeout(toastTimer); const el=$('#toast'); el.textContent=t(key); el.hidden=false; toastTimer=window.setTimeout(()=>el.hidden=true,7000); }
function save(purpose: 'download' | 'local') { if (!ready || exportInFlight) return; savePurpose=purpose; exportInFlight=true; post({type:'save'}); }
function pause() { post({type:'run',running:false}); if(snapshot?.mode==='train') save('local'); }
function bind() {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b=>b.onclick=()=>{language=b.dataset.lang as Language; writeLocal('lassen-language',language); render();});
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.onclick=()=>{ if(snapshot?.running) pause(); post({type:'mode',mode:b.dataset.mode as Mode}); });
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>b.onclick=()=>post({type:'speed',value:Number(b.dataset.speed)}));
  $('#run').onclick=()=>{if(snapshot?.running) pause(); else post({type:'run',running:true});};
  $('#step').onclick=()=>post({type:'step'});
  $('#restart').onclick=()=>{post({type:'run',running:true});};
  $('#save').onclick=()=>save('download');
  $('#load').onclick=()=>$('#file').click();
  $('#restore').onclick=()=>{try{post({type:'load',brain:JSON.parse(readLocal('lassen-brain')??'null')});}catch{toast('invalid');}};
  $('#reset').onclick=()=>{dialogAction='reset'; $('#dialog-description').textContent=t('resetHint'); $<HTMLDialogElement>('#confirm-dialog').showModal();};
  $('#cancel-reset').onclick=()=>$<HTMLDialogElement>('#confirm-dialog').close();
  $('#confirm-reset').onclick=()=>{post({type:'reset',settings:dialogAction==='settings'?draftSettings:{...(snapshot?.settings??DEFAULTS)}}); $<HTMLDialogElement>('#confirm-dialog').close();};
  $('#file').onchange=async(event)=>{const input=event.target as HTMLInputElement,file=input.files?.[0]; if(!file)return; if(file.size>2*1024*1024){toast('fileLarge');input.value='';return;} try{const brain=JSON.parse(await file.text());post({type:'load',brain});}catch{toast('invalid');}input.value='';};
  $('#settings-form').onsubmit=(event)=>{event.preventDefault();const entries=new FormData(event.target as HTMLFormElement); try{draftSettings=validateSettings(Object.fromEntries([...entries.entries()].map(([k,v])=>[k,Number(v)]))); dialogAction='settings';$('#dialog-description').textContent=t('settingsHint');$<HTMLDialogElement>('#confirm-dialog').showModal();}catch{toast('settingsError');}};
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);post({type:'input',action:Number(b.dataset.action) as Action});};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>post({type:'input',action:0});});
  const canvas=$<HTMLCanvasElement>('#game');
  const move=(e:PointerEvent)=>{if(snapshot?.mode!=='human')return;const r=canvas.getBoundingClientRect();post({type:'input',action:0,drag:(e.clientX-r.left)/r.width*300});};
  canvas.onpointerdown=e=>{if(snapshot?.mode!=='human')return;e.preventDefault();canvas.setPointerCapture(e.pointerId);move(e);};
  canvas.onpointermove=e=>{if(canvas.hasPointerCapture(e.pointerId))move(e);};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>post({type:'input',action:0});
}
function update() {
  const s=snapshot, mode=s?.mode??'train';
  const descriptionKey: Key=({train:'modeTrain',random:'modeRandom',human:'modeHuman',evaluate:'modeEvaluate'} as const)[mode];
  $('#mode-description').textContent=t(descriptionKey);
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));b.disabled=!ready;});
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>{const active=Number(b.dataset.speed)===(s?.speed??1);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));b.disabled=!ready||mode==='human';});
  $('#run').textContent=t(s?.running?'pause':mode==='train'?'start':mode==='evaluate'?'evalStart':'startOther');
  $('#step').toggleAttribute('disabled',!ready||Boolean(s?.running)||Boolean(s?.evaluation?.done));
  for(const id of ['run','save','load','reset','confirm-reset'])$(`#${id}`).toggleAttribute('disabled',!ready);
  $('#restore').toggleAttribute('disabled',!ready||!readLocal('lassen-brain'));
  $('#touch-controls').hidden=mode!=='human';
  $('#game').classList.toggle('interactive',mode==='human');
  $('#status').textContent=t(!ready?'initializing':s?.running?'running':(s?.game.steps??0)>0?'paused':'ready');
  $('#status').classList.toggle('is-running',Boolean(s?.running));
  $('#game-note').textContent=t(mode==='human'?'modeHuman':(s?.speed??1)>=50?'speedHint':'gameHint');
  $('#evaluation-panel').hidden=mode!=='evaluate';
  if(!s)return;
  $('#score').innerHTML=`${s.game.score} <small>/ 60</small>`;$('#lives').textContent=String(s.game.lives);$('#bricks-count').textContent=String(60-s.game.score);
  s.state.forEach((v,i)=>{ $(`#state-${i}`).textContent=v.toFixed(2);const signed=i>=3&&i<=5;const bar=$(`#state-bar-${i}`);bar.style.width=`${Math.abs(v)*(signed?50:100)}%`;bar.style.left=`${signed?(v<0?50+v*50:50):0}%`;bar.parentElement!.classList.toggle('signed',signed); });
  const low=Math.min(0,...s.q),high=Math.max(0.01,...s.q),range=high-low;
  s.q.forEach((v,i)=>{ $(`#q-${i}`).textContent=v.toFixed(2);$(`#q-row-${i}`).classList.toggle('selected',s.game.steps>0&&i===s.action);$(`#q-bar-${i}`).style.left=`${(Math.min(v,0)-low)/range*100}%`;$(`#q-bar-${i}`).style.width=`${Math.max(0.8,Math.abs(v)/range*100)}%`;$(`#q-zero-${i}`).style.left=`${-low/range*100}%`; });
  $('#choice').textContent=s.game.steps?t(ACTIONS[s.action]):'—';$('#reward').textContent=`${s.reward>0?'+':''}${s.reward}`;$('#reward').classList.toggle('positive',s.reward>0);
  $('#selection-type').textContent=t(mode==='human'?'notAI':s.exploring?'explore':'exploit');$('#selection-type').classList.toggle('exploration',s.exploring);
  $('#epsilon').textContent=`${(s.epsilon*100).toFixed(1)}%`;($<HTMLMeterElement>('#epsilon-meter')).value=s.epsilon;
  $('#memory').textContent=`${fmt(s.memory)} / ${fmt(s.capacity)}`; const meter=$<HTMLMeterElement>('#memory-meter');meter.max=s.capacity;meter.value=s.memory;
  $('#target').textContent=fmt(s.targetRemaining);$('#steps').textContent=fmt(s.steps);$('#updates').textContent=fmt(s.updates);$('#loss').textContent=s.updates?s.loss.toFixed(5):'—';$('#throughput').textContent=fmt(Math.round(s.running?s.actualSpeed:0));
  $('#warmup').textContent=s.updates?`${t('copies')} ${fmt(s.copies)} ${t('unitTimes')}`:`${t('warmup')} ${fmt(Math.min(s.memory,2000))} / 2,000`;
  $('#episodes').textContent=fmt(s.episodes);const recent=s.scores.slice(-20);$('#average').textContent=recent.length?(recent.reduce((a,b)=>a+b,0)/recent.length).toFixed(1):'—';
  $('#chart-empty').hidden=s.scores.length>0;
  $('#game-overlay').hidden=!(s.game.ended&&mode==='human');$('#end-title').textContent=t(s.game.score===60?'cleared':'gameEnded');$('#end-score').textContent=`${t('score')} ${s.game.score} / 60`;
  $('#logs').innerHTML=s.logs.length?s.logs.map(l=>`<li><span>${fmt(l.step)} ${t('unitSteps')}</span><span>Q [${l.q.map(n=>n.toFixed(2)).join(', ')}]</span><strong>${t(ACTIONS[l.action])}${l.exploring?` · ${t('explore')}`:''}</strong><span>${t('reward')} ${l.reward>0?'+':''}${l.reward}</span></li>`).join(''):`<li class="micro">${t('logEmpty')}</li>`;
  if(s.evaluation){ const e=s.evaluation;$('#eval-progress').textContent=`${t(e.done?'evalComplete':'evalProgress')} ${e.completed} / ${e.total}`;$<HTMLProgressElement>('#eval-meter').value=e.completed;$('#eval-empty').hidden=e.completed>0;$('#eval-results').innerHTML=[{name:'ai' as Key,scores:e.ai},{name:'random' as Key,scores:e.random}].filter(r=>r.scores.length).map(r=>{const mean=r.scores.reduce((a,b)=>a+b,0)/r.scores.length;const std=Math.sqrt(r.scores.reduce((a,b)=>a+(b-mean)**2,0)/r.scores.length);return `<div class="eval-result"><strong>${t(r.name)}</strong><span>${t('average')} <b>${mean.toFixed(1)}</b></span><span>${t('best')} <b>${Math.max(...r.scores)}</b></span><span>${t('std')} <b>${std.toFixed(1)}</b></span><span>${t('clearRate')} <b>${(r.scores.filter(n=>n===60).length/r.scores.length*100).toFixed(0)}%</b></span><small>${r.scores.length} / 10</small></div>`;}).join(''); }
}
function setupCanvas(canvas: HTMLCanvasElement) { const rect=canvas.getBoundingClientRect(), dpr=Math.min(2,window.devicePixelRatio||1);const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}const ctx=canvas.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height}; }
const rowColors=['#ee7771','#efa64c','#e5c45d','#6bbfa9','#61afd0','#a49bd2'];
function drawGame() {
  const canvas=$<HTMLCanvasElement>('#game');if(!canvas)return;
  const {ctx,w,h}=setupCanvas(canvas),sx=w/300,sy=h/400, game=snapshot?.game??new Game(1).view();
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#f0f6fa';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#e3edf3';ctx.lineWidth=1;
  for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(i*w/6,0);ctx.lineTo(i*w/6,h);ctx.stroke();}
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4);ctx.stroke();}
  game.bricks.forEach((alive,i)=>{if(!alive)return;const b=brickRect(i);ctx.fillStyle=rowColors[Math.floor(i/10)];ctx.fillRect(b.x*sx,b.y*sy,b.w*sx,b.h*sy);});
  ctx.fillStyle='#2563eb';ctx.fillRect((game.paddle-25)*sx,RULES.paddleY*sy,50*sx,5*sy);
  ctx.beginPath();ctx.arc(game.x*sx,game.y*sy,Math.max(3,Math.min(sx,sy)*3.6),0,Math.PI*2);ctx.fill();
}
let chartFingerprint='';
function drawChart(force=false) {
  const canvas=$<HTMLCanvasElement>('#chart');if(!canvas)return;const s=snapshot;
  const fingerprint=`${s?.episodes??0}|${language}|${canvas.getBoundingClientRect().width}`;if(!force&&fingerprint===chartFingerprint)return;chartFingerprint=fingerprint;
  const {ctx,w,h}=setupCanvas(canvas);ctx.clearRect(0,0,w,h); if(!s?.scores.length)return;
  const pad={left:42,right:14,top:16,bottom:38},width=w-pad.left-pad.right,height=h-pad.top-pad.bottom;
  ctx.font='11px Arial';ctx.fillStyle='#65727c';ctx.textAlign='right';
  for(let y=0;y<=60;y+=20){const py=pad.top+height-y/60*height;ctx.strokeStyle='#e5eaee';ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(w-pad.right,py);ctx.stroke();ctx.fillText(String(y),pad.left-8,py+4);}
  const scores=s.scores, count=scores.length, start=s.scoreOffset+1;ctx.textAlign='center';
  for(let i=0;i<=4;i++){const x=pad.left+i/4*width;ctx.fillText(fmt(start+Math.round((count-1)*i/4)),x,h-21);}
  ctx.fillText(t('episodes'),pad.left+width/2,h-4);ctx.save();ctx.translate(12,pad.top+height/2);ctx.rotate(-Math.PI/2);ctx.fillText(t('score'),0,0);ctx.restore();
  const line=(values:number[],color:string,lineWidth:number)=>{ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.beginPath();values.forEach((v,i)=>{const x=pad.left+(count>1?i/(count-1)*width:0),y=pad.top+height-v/60*height;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();if(count===1){ctx.beginPath();ctx.arc(pad.left,pad.top+height-values[0]/60*height,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}};
  line(scores,'#759bf0',1);const means=scores.map((_,i)=>{const values=scores.slice(Math.max(0,i-19),i+1);return values.reduce((a,b)=>a+b,0)/values.length;});line(means,'#55602d',2);
}
function draw() { drawGame();drawChart(true); }
worker.onmessage=(event:MessageEvent<WorkerMessage>)=>{
  const msg=event.data;
  if(msg.type==='ready'){ready=true;update();}
  if(msg.type==='snapshot'){snapshot=msg.value;update();drawGame();drawChart();const bucket=Math.floor(snapshot.steps/5000);if(snapshot.mode==='train'&&snapshot.running&&bucket>0&&bucket!==lastAutosave){lastAutosave=bucket;save('local');}}
  if(msg.type==='saved'){exportInFlight=false;const text=JSON.stringify(msg.brain);if(savePurpose==='download'){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='brain.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('saved');}if(!writeLocal('lassen-brain',text))toast('storageError');update();}
  if(msg.type==='loaded'){lastAutosave=-1;render();toast('loaded');save('local');}
  if(msg.type==='reset'){lastAutosave=-1;toast('resetDone');save('local');}
  if(msg.type==='error'){exportInFlight=false;toast(msg.code==='startup'?'startupError':msg.code==='training'?'trainingError':'invalid');}
};
worker.onerror=()=>toast('startupError');
const pressed=new Set<string>();
function keyboard(event:KeyboardEvent,down:boolean){if(snapshot?.mode!=='human'||!(event.key==='ArrowLeft'||event.key==='ArrowRight')||event.target instanceof HTMLInputElement||$<HTMLDialogElement>('dialog').open)return;event.preventDefault();if(down)pressed.add(event.key);else pressed.delete(event.key);post({type:'input',action:pressed.has('ArrowLeft')?1:pressed.has('ArrowRight')?2:0});}
window.addEventListener('keydown',e=>keyboard(e,true));window.addEventListener('keyup',e=>keyboard(e,false));window.addEventListener('blur',()=>{pressed.clear();post({type:'input',action:0});});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&snapshot?.running){pause();toast('hidden');}});
window.addEventListener('resize',()=>draw());
render();

