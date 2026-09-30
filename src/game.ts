export const RULES = { width: 300, height: 400, columns: 10, rows: 6, brickHeight: 8, gap: 2, margin: 12, brickTop: 54, paddleWidth: 50, paddleHeight: 5, paddleY: 374, ballRadius: 3, ballSpeed: 2.8, framesPerAction: 4, maxSteps: 4500 } as const;
export const STATES = ['paddleX', 'ballX', 'ballY', 'ballVX', 'ballVY', 'offset', 'bricks', 'lives'] as const;
export const ACTIONS = ['stay', 'left', 'right'] as const;
export type Action = 0 | 1 | 2;
export function random(seed: number) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = Math.imul(value ^ value >>> 15, 1 | value); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const brickWidth = (RULES.width - 2 * RULES.margin - (RULES.columns - 1) * RULES.gap) / RULES.columns;
export function brickRect(i: number) { return { x: RULES.margin + (i % RULES.columns) * (brickWidth + RULES.gap), y: RULES.brickTop + Math.floor(i / RULES.columns) * (RULES.brickHeight + RULES.gap), w: brickWidth, h: RULES.brickHeight }; }
export interface GameView { paddle: number; x: number; y: number; vx: number; vy: number; bricks: number[]; score: number; lives: number; steps: number; ended: boolean }
export class Game {
  paddle = 150; x = 150; y = 362; vx = 0; vy = 0; bricks = new Uint8Array(60).fill(1); score = 0; lives = 3; steps = 0; ended = false;
  rng: () => number;
  constructor(seed = 1) { this.rng = random(seed); this.launch(); }
  launch() {
    this.x = this.paddle; this.y = RULES.paddleY - 12;
    const angle = (this.rng() - 0.5) * 1.1;
    this.vx = Math.sin(angle) * RULES.ballSpeed; this.vy = -Math.cos(angle) * RULES.ballSpeed;
  }
  state(): number[] { return [this.paddle / 300, this.x / 300, Math.max(0, Math.min(1, this.y / 400)), this.vx / RULES.ballSpeed, this.vy / RULES.ballSpeed, (this.x - this.paddle) / 300, (60 - this.score) / 60, this.lives / 3]; }
  view(): GameView { return { paddle: this.paddle, x: this.x, y: this.y, vx: this.vx, vy: this.vy, bricks: Array.from(this.bricks), score: this.score, lives: this.lives, steps: this.steps, ended: this.ended }; }
  step(action: Action, drag?: number) {
    if (this.ended) return { reward: 0, done: true, terminal: this.lives === 0 || this.score === 60, lifeLost: false };
    let reward = 0, lifeLost = false;
    this.steps++;
    for (let frame = 0; frame < RULES.framesPerAction; frame++) {
      this.paddle = Math.max(25, Math.min(275, drag === undefined ? this.paddle + (action === 1 ? -2.5 : action === 2 ? 2.5 : 0) : drag));
      const oldX = this.x, oldY = this.y;
      this.x += this.vx; this.y += this.vy;
      const r = RULES.ballRadius;
      if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx); }
      if (this.x > 300 - r) { this.x = 300 - r; this.vx = -Math.abs(this.vx); }
      if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy); }
      if (this.vy > 0 && oldY + r <= RULES.paddleY && this.y + r >= RULES.paddleY && this.x + r >= this.paddle - 25 && this.x - r <= this.paddle + 25) {
        this.y = RULES.paddleY - r;
        const offset = Math.max(-1, Math.min(1, (this.x - this.paddle) / 25));
        const angle = offset * 1.05;
        this.vx = Math.sin(angle) * RULES.ballSpeed;
        // Avoid a vertical orbit while keeping the bounce deterministic.
        if (Math.abs(this.vx) < 0.15) this.vx = (this.vx < 0 ? -1 : 1) * 0.15;
        this.vy = -Math.sqrt(RULES.ballSpeed ** 2 - this.vx ** 2);
      }
      for (let i = 0; i < 60; i++) {
        if (!this.bricks[i]) continue;
        const b = brickRect(i);
        const closestX = Math.max(b.x, Math.min(this.x, b.x + b.w));
        const closestY = Math.max(b.y, Math.min(this.y, b.y + b.h));
        if ((this.x - closestX) ** 2 + (this.y - closestY) ** 2 > r ** 2) continue;
        this.bricks[i] = 0; this.score++; reward += 1;
        if (oldY + r <= b.y) { this.y = b.y - r; this.vy = -Math.abs(this.vy); }
        else if (oldY - r >= b.y + b.h) { this.y = b.y + b.h + r; this.vy = Math.abs(this.vy); }
        else if (oldX < b.x) { this.x = b.x - r; this.vx = -Math.abs(this.vx); }
        else { this.x = b.x + b.w + r; this.vx = Math.abs(this.vx); }
        break;
      }
      if (this.y - r > 400) { this.lives--; reward -= 1; lifeLost = true; if (this.lives > 0) this.launch(); break; }
      if (this.score === 60) break;
    }
    const terminal = this.lives === 0 || this.score === 60;
    this.ended = terminal || this.steps >= RULES.maxSteps;
    return { reward, done: this.ended, terminal, lifeLost };
  }
}
