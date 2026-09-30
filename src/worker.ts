import { DQN, DEFAULTS, initializeTF, validateBrain, validateSettings } from './dqn';
import { Game, random, type Action } from './game';
import type { Command, Evaluation, LogEntry, Mode, Snapshot, WorkerMessage } from './protocol';
const send = (message: WorkerMessage) => postMessage(message);
let agent: DQN, game: Game, mode: Mode = 'train', running = false, speed = 1, input: Action = 0, drag: number | undefined;
let q = [0, 0, 0], action: Action = 0, reward = 0, exploring = false, logs: LogEntry[] = [], evaluation: Evaluation | null = null;
let episodeSeed = 0, evalIndex = 0, evalRandom = false, evalRng = random(9001), actualSpeed = 0, periodSteps = 0, measuredAt = performance.now(), lastPublish = 0;
let previous = performance.now(), credit = 0;
function newGame() { game = new Game(agent.settings.seed + episodeSeed++); }
function startEvaluation() { evaluation = { ai: [], random: [], completed: 0, total: 20, done: false }; evalIndex = 0; evalRandom = false; game = new Game(9001); evalRng = random(19001); }
function publish() {
  if (!agent) return;
  const now = performance.now();
  if (now - measuredAt >= 500) { actualSpeed = periodSteps / ((now - measuredAt) / 1000); measuredAt = now; periodSteps = 0; }
  const value: Snapshot = { game: game.view(), state: game.state(), q, action, reward, exploring, mode, running, speed, steps: agent.steps, episodes: agent.scoreOffset + agent.scores.length, scores: agent.scores, scoreOffset: agent.scoreOffset, epsilon: mode === 'random' ? 1 : mode === 'evaluate' || mode === 'human' ? 0 : agent.epsilon(), updates: agent.updates, loss: agent.loss, memory: agent.replay.length, capacity: agent.replay.capacity, copies: agent.copies, targetRemaining: agent.settings.targetEvery - agent.steps % agent.settings.targetEvery, actualSpeed, settings: agent.settings, evaluation, logs, tensors: agent.memory() };
  send({ type: 'snapshot', value }); lastPublish = now;
}
function tick() {
  if (game.ended) newGame();
  const state = game.state();
  if (mode !== 'train') q = agent.predict(state); exploring = false;
  if (mode === 'human') action = input;
  else if (mode === 'random' || mode === 'evaluate' && evalRandom) { action = Math.floor((mode === 'evaluate' ? evalRng() : agent.rng()) * 3) as Action; exploring = true; }
  else if (mode === 'train') { const selected = agent.choose(state); action = selected.action; q = selected.q; exploring = selected.exploring; }
  else action = q.indexOf(Math.max(...q)) as Action;
  const result = game.step(action, mode === 'human' ? drag : undefined); reward = result.reward; periodSteps++;
  if (mode === 'train') agent.observe({ state, action, reward, next: game.state(), terminal: result.terminal || result.lifeLost });
  if (speed <= 5 && (game.steps % 15 === 0 || reward !== 0)) { logs.unshift({ step: game.steps, action, reward, exploring, q: [...q] }); logs = logs.slice(0, 8); }
  if (result.done) {
    if (mode === 'train') agent.record(game.score);
    if (mode === 'evaluate' && evaluation && !evaluation.done) {
      (evalRandom ? evaluation.random : evaluation.ai).push(game.score); evaluation.completed++;
      if (!evalRandom) evalRandom = true;
      else { evalRandom = false; evalIndex++; }
      if (evalIndex >= 10) { evaluation.done = true; running = false; }
      else { game = new Game(9001 + evalIndex); evalRng = random(19001 + evalIndex); }
    }
    else if (mode === 'human') running = false;
    else newGame();
  }
}
function loop() {
  const now = performance.now(), elapsed = Math.min(100, now - previous); previous = now;
  if (running) {
    credit = Math.min(1000, credit + elapsed * 15 * speed / 1000);
    const deadline = now + 18;
    try { while (credit >= 1 && running && performance.now() < deadline) { tick(); credit--; } }
    catch { running = false; send({ type: 'error', code: 'training' }); }
  } else credit = 0;
  if (now - lastPublish >= (speed <= 5 ? 32 : 100)) publish();
  setTimeout(loop, running ? 4 : 100);
}
async function boot() {
  await initializeTF(); agent = new DQN({ ...DEFAULTS }); newGame(); q = agent.predict(game.state());
  onmessage = (event: MessageEvent<Command>) => {
    try {
      const c = event.data;
      if (c.type === 'run') { if (c.running && mode === 'evaluate' && evaluation?.done) startEvaluation(); running = c.running; }
      if (c.type === 'mode') { mode = c.mode; running = false; drag = undefined; input = 0; logs = []; reward = 0; if (mode === 'evaluate') startEvaluation(); else { evaluation = null; newGame(); } if (mode === 'human') speed = 1; q = agent.predict(game.state()); }
      if (c.type === 'speed') { speed = mode === 'human' ? 1 : [1, 5, 50, 300].includes(c.value) ? c.value : 1; }
      if (c.type === 'input') { input = c.action; drag = c.drag; }
      if (c.type === 'step' && !running && !(mode === 'evaluate' && evaluation?.done)) tick();
      if (c.type === 'reset') { const settings = validateSettings(c.settings); running = false; agent.dispose(); agent = new DQN(settings); episodeSeed = 0; mode = 'train'; evaluation = null; logs = []; reward = 0; newGame(); q = agent.predict(game.state()); send({ type: 'reset' }); }
      if (c.type === 'save') send({ type: 'saved', brain: agent.export() });
      if (c.type === 'load') { const brain = validateBrain(c.brain); running = false; agent.dispose(); agent = new DQN(brain.settings); agent.load(brain); mode = 'train'; evaluation = null; episodeSeed = 0; logs = []; reward = 0; newGame(); q = agent.predict(game.state()); publish(); send({ type: 'loaded' }); }
      publish();
    } catch { send({ type: 'error', code: 'invalid' }); }
  };
  send({ type: 'ready' }); publish(); loop();
}
boot().catch(() => send({ type: 'error', code: 'startup' }));
