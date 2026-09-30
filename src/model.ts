import { ACTIONS, RULES, STATES } from './game';
import type { Action } from './game';
export interface Settings { learningRate: number; gamma: number; epsilonSteps: number; bufferSize: number; targetEvery: number; seed: number }
export const DEFAULTS: Settings = { learningRate: 0.001, gamma: 0.99, epsilonSteps: 80000, bufferSize: 50000, targetEvery: 1000, seed: 1 };
export interface Experience { state: number[]; action: Action; reward: number; next: number[]; terminal: boolean }
export interface Brain { format: 'lassen-dqn'; version: 1; rules: typeof RULES; states: typeof STATES; actions: typeof ACTIONS; shape: number[]; settings: Settings; steps: number; scores: number[]; scoreOffset: number; weights: number[][]; createdAt: string }
export const SHAPE = [8, 64, 64, 3];
export const TENSOR_SHAPES = [[8, 64], [64], [64, 64], [64], [64, 3], [3]];
export const WARMUP = 2000;
export function bellman(reward: number, gamma: number, nextQ: number, terminal: boolean) { return reward + (terminal ? 0 : gamma * nextQ); }
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('settings');
  const s = value as Settings;
  const bounds: [keyof Settings, number, number, boolean][] = [['learningRate', 0.00001, 0.01, false], ['gamma', 0, 0.999, false], ['epsilonSteps', 1000, 1000000, true], ['bufferSize', 1000, 100000, true], ['targetEvery', 100, 10000, true], ['seed', 0, 4294967295, true]];
  for (const [key, min, max, integer] of bounds) if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max || integer && !Number.isInteger(s[key])) throw new Error('settings');
  return { learningRate: s.learningRate, gamma: s.gamma, epsilonSteps: s.epsilonSteps, bufferSize: s.bufferSize, targetEvery: s.targetEvery, seed: s.seed };
}
export function validateBrain(value: unknown): Brain {
  if (!value || typeof value !== 'object') throw new Error('format');
  const b = value as Brain;
  if (b.format !== 'lassen-dqn' || b.version !== 1 || JSON.stringify(b.rules) !== JSON.stringify(RULES) || JSON.stringify(b.states) !== JSON.stringify(STATES) || JSON.stringify(b.actions) !== JSON.stringify(ACTIONS) || JSON.stringify(b.shape) !== JSON.stringify(SHAPE)) throw new Error('format');
  validateSettings(b.settings);
  if (!Number.isSafeInteger(b.steps) || b.steps < 0 || !Number.isSafeInteger(b.scoreOffset) || b.scoreOffset < 0 || !Array.isArray(b.scores) || b.scores.length > 2000 || b.scores.some(n => !Number.isInteger(n) || n < 0 || n > 60)) throw new Error('format');
  if (!Array.isArray(b.weights) || b.weights.length !== 6 || b.weights.some((w, i) => !Array.isArray(w) || w.length !== TENSOR_SHAPES[i].reduce((a, c) => a * c, 1) || w.some(n => !Number.isFinite(n) || Math.abs(n) > 10000))) throw new Error('weights');
  return b;
}
