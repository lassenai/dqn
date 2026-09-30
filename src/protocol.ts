import type { Brain, Settings } from './dqn';
import type { Action, GameView } from './game';
export type Mode = 'train' | 'random' | 'human' | 'evaluate';
export interface Evaluation { ai: number[]; random: number[]; completed: number; total: number; done: boolean }
export interface LogEntry { step: number; action: Action; reward: number; exploring: boolean; q: number[] }
export interface Snapshot { game: GameView; state: number[]; q: number[]; action: Action; exploring: boolean; reward: number; mode: Mode; running: boolean; speed: number; steps: number; episodes: number; scores: number[]; scoreOffset: number; epsilon: number; updates: number; loss: number; memory: number; capacity: number; copies: number; targetRemaining: number; actualSpeed: number; settings: Settings; evaluation: Evaluation | null; logs: LogEntry[]; tensors: number }
export type Command = { type: 'run'; running: boolean } | { type: 'mode'; mode: Mode } | { type: 'speed'; value: number } | { type: 'input'; action: Action; drag?: number } | { type: 'step' } | { type: 'reset'; settings: Settings } | { type: 'save' } | { type: 'load'; brain: unknown };
export type WorkerMessage = { type: 'snapshot'; value: Snapshot } | { type: 'ready' } | { type: 'saved'; brain: Brain } | { type: 'loaded' } | { type: 'reset' } | { type: 'error'; code: string };
