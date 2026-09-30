import * as tf from '@tensorflow/tfjs';
import { ACTIONS, RULES, STATES, random, type Action } from './game';
import { DEFAULTS, TENSOR_SHAPES, SHAPE, WARMUP, validateBrain, type Settings, type Brain, type Experience } from './model';
export * from './model';
export class Replay {
  private states: Float32Array; private next: Float32Array; private actions: Uint8Array; private rewards: Float32Array; private terminals: Uint8Array;
  length = 0; cursor = 0;
  constructor(public capacity: number) { this.states = new Float32Array(capacity * 8); this.next = new Float32Array(capacity * 8); this.actions = new Uint8Array(capacity); this.rewards = new Float32Array(capacity); this.terminals = new Uint8Array(capacity); }
  add(e: Experience) { const i = this.cursor; this.states.set(e.state, i * 8); this.next.set(e.next, i * 8); this.actions[i] = e.action; this.rewards[i] = e.reward; this.terminals[i] = Number(e.terminal); this.cursor = (i + 1) % this.capacity; this.length = Math.min(this.capacity, this.length + 1); }
  sample(count: number, rng: () => number) {
    if (!this.length) throw new Error('empty replay');
    const states = new Float32Array(count * 8), next = new Float32Array(count * 8), actions = new Int32Array(count), rewards = new Float32Array(count), terminals = new Float32Array(count);
    for (let n = 0; n < count; n++) { const i = Math.floor(rng() * this.length); states.set(this.states.subarray(i * 8, i * 8 + 8), n * 8); next.set(this.next.subarray(i * 8, i * 8 + 8), n * 8); actions[n] = this.actions[i]; rewards[n] = this.rewards[i]; terminals[n] = this.terminals[i]; }
    return { states, next, actions, rewards, terminals };
  }
}
export async function initializeTF() { await tf.setBackend('cpu'); await tf.ready(); }
export class DQN {
  online: tf.Variable[]; target: tf.Variable[]; optimizer: tf.Optimizer; replay: Replay; steps = 0; updates = 0; copies = 0; loss = 0; scores: number[] = []; scoreOffset = 0; rng: () => number; collected = 0;
  constructor(public settings: Settings = DEFAULTS) {
    this.rng = random(settings.seed ^ 0xabcdef); this.replay = new Replay(settings.bufferSize);
    this.online = tf.tidy(() => TENSOR_SHAPES.map((shape, i) => tf.variable(shape.length === 1 ? tf.zeros(shape) : tf.randomNormal(shape, 0, Math.sqrt(2 / shape[0]) * (i === 4 ? 0.1 : 1), 'float32', settings.seed + i))));
    this.target = tf.tidy(() => this.online.map(v => tf.variable(v.clone(), false)));
    this.optimizer = tf.train.adam(settings.learningRate);
  }
  forward(input: tf.Tensor2D, variables = this.online): tf.Tensor2D {
    const a = tf.relu(tf.add(tf.matMul(input, variables[0]), variables[1]));
    const b = tf.relu(tf.add(tf.matMul(a, variables[2]), variables[3]));
    return tf.add(tf.matMul(b, variables[4]), variables[5]) as tf.Tensor2D;
  }
  predict(state: number[]): number[] { return tf.tidy(() => Array.from(this.forward(tf.tensor2d(state, [1, 8])).dataSync())); }
  epsilon() { return Math.max(0.05, 1 - 0.95 * this.steps / this.settings.epsilonSteps); }
  choose(state: number[], explore = true) { const q = this.predict(state); const exploring = explore && this.rng() < this.epsilon(); const action = (exploring ? Math.floor(this.rng() * 3) : q.indexOf(Math.max(...q))) as Action; return { q, action, exploring }; }
  observe(e: Experience) {
    this.replay.add(e); this.steps++; this.collected++;
    if (this.collected >= WARMUP && this.steps % 4 === 0 && this.replay.length >= 32) this.train();
    if (this.steps % this.settings.targetEvery === 0) { this.sync(); this.copies++; }
  }
  train() {
    const n = 32, batch = this.replay.sample(n, this.rng);
    tf.tidy(() => {
      const states = tf.tensor2d(batch.states, [n, 8]);
      const next = tf.tensor2d(batch.next, [n, 8]);
      const targets = tf.add(tf.tensor1d(batch.rewards), tf.mul(tf.mul(tf.max(this.forward(next, this.target), 1), this.settings.gamma), tf.sub(1, tf.tensor1d(batch.terminals))));
      const mask = tf.oneHot(tf.tensor1d(batch.actions, 'int32'), 3);
      const cost = this.optimizer.minimize(() => {
        const selected = tf.sum(tf.mul(this.forward(states), mask), 1);
        const error = tf.sub(selected, targets), abs = tf.abs(error), quadratic = tf.minimum(abs, 1);
        return tf.mean(tf.add(tf.mul(tf.square(quadratic), 0.5), tf.sub(abs, quadratic))) as tf.Scalar;
      }, true, this.online);
      this.loss = cost!.dataSync()[0];
    });
    if (!Number.isFinite(this.loss)) throw new Error('nonfinite');
    this.updates++;
  }
  sync() { this.target.forEach((v, i) => v.assign(this.online[i])); }
  record(score: number) { this.scores.push(score); if (this.scores.length > 2000) { this.scores.shift(); this.scoreOffset++; } }
  export(): Brain { return { format: 'lassen-dqn', version: 1, rules: RULES, states: STATES, actions: ACTIONS, shape: SHAPE, settings: { ...this.settings }, steps: this.steps, scores: [...this.scores], scoreOffset: this.scoreOffset, weights: this.online.map(v => Array.from(v.dataSync())), createdAt: new Date().toISOString() }; }
  load(brain: Brain) { validateBrain(brain); tf.tidy(() => this.online.forEach((v, i) => v.assign(tf.tensor(brain.weights[i], v.shape)))); this.sync(); this.steps = brain.steps; this.scores = [...brain.scores]; this.scoreOffset = brain.scoreOffset; }
  dispose() { this.online.forEach(v => v.dispose()); this.target.forEach(v => v.dispose()); this.optimizer.dispose(); }
  memory() { return tf.memory().numTensors; }
}
