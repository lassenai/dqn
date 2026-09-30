import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, brickRect, random } from '../src/game';
import { DQN, DEFAULTS, Replay, bellman, initializeTF, validateBrain, validateSettings } from '../src/dqn';
import { en, ko, zh } from '../src/i18n';

test('game has 60 thin bricks and is reproducible with a fixed seed', () => {
  const a = new Game(42), b = new Game(42), rng = random(4);
  assert.equal(a.bricks.length, 60); assert.equal(RULES.brickHeight, 8); assert.equal(RULES.paddleHeight, 5);
  for (let i = 0; i < 800; i++) { const action = Math.floor(rng() * 3) as 0 | 1 | 2; assert.deepEqual(a.step(action), b.step(action)); assert.deepEqual(a.view(), b.view()); if (a.ended) break; }
});
test('wall, paddle, brick, life loss and timeout transitions', () => {
  const wall = new Game(1);wall.x = 3.1;wall.vx = -2;wall.vy = -1;wall.step(0);assert.ok(wall.vx > 0);assert.ok(wall.x >= 3);
  const paddle = new Game(1);paddle.x=150;paddle.y=369;paddle.vx=0;paddle.vy=2.8;paddle.step(0);assert.ok(paddle.vy<0);assert.equal(paddle.lives,3);
  const brick = new Game(1);const rect=brickRect(59);brick.x=rect.x+rect.w/2;brick.y=rect.y+rect.h+4;brick.vx=0;brick.vy=-2.8;const hit=brick.step(0);assert.equal(brick.score,1);assert.equal(hit.reward,1);assert.equal(brick.bricks[59],0);assert.ok(brick.vy>0);
  const missed = new Game(1);missed.y=405;missed.vy=2.8;const loss=missed.step(0);assert.equal(loss.reward,-1);assert.equal(loss.lifeLost,true);assert.equal(loss.done,false);assert.equal(missed.lives,2);
  missed.lives=1;missed.y=405;missed.vy=2.8;assert.equal(missed.step(0).terminal,true);
  const timeout=new Game(1);timeout.steps=RULES.maxSteps-1;const end=timeout.step(0);assert.equal(end.done,true);assert.equal(end.terminal,false);
});
test('Bellman masks terminal states but bootstraps time-limit transitions', () => {assert.equal(bellman(1,.99,10,true),1);assert.equal(bellman(1,.99,10,false),10.9);});
test('replay stores explicit next state across episode and ring boundaries', () => {
  const replay=new Replay(2);
  for(let i=0;i<5;i++)replay.add({state:new Array(8).fill(i),action:1,reward:i,next:new Array(8).fill(i+.5),terminal:i%2===0});
  assert.equal(replay.length,2);const batch=replay.sample(100,random(1));for(let i=0;i<100;i++){assert.ok(batch.states[i*8]===3||batch.states[i*8]===4);assert.equal(batch.next[i*8],batch.states[i*8]+.5);assert.equal(batch.terminals[i],batch.states[i*8]%2===0?1:0);}
});
test('language dictionaries cover the entire UI', () => {assert.deepEqual(Object.keys(en).sort(),Object.keys(ko).sort());assert.deepEqual(Object.keys(zh).sort(),Object.keys(ko).sort());});
test('DQN learns, copies target weights, roundtrips weights and bounds tensor memory', async () => {
  await initializeTF();const agent=new DQN({...DEFAULTS,seed:7});
  const state=[.5,.5,.8,0,-1,0,1,1];const original=agent.predict(state);
  for(let i=0;i<100;i++)agent.replay.add({state,action:2,reward:1,next:state,terminal:true});
  agent.train();const warmedMemory=agent.memory();
  for(let i=0;i<100;i++)agent.train();const learned=agent.predict(state);
  assert.ok(learned[2]>original[2]+.5);assert.ok(learned.every(Number.isFinite));assert.equal(agent.memory(),warmedMemory);
  agent.sync();assert.deepEqual(Array.from(agent.target[4].dataSync()),Array.from(agent.online[4].dataSync()));
  const brain=agent.export();validateBrain(brain);const restored=new DQN(brain.settings);restored.load(brain);assert.deepEqual(restored.predict(state),learned);
  const before=restored.export().weights;for(let i=0;i<100;i++)restored.choose(state,false);assert.deepEqual(restored.export().weights,before);
  assert.throws(()=>validateBrain({...brain,actions:['left','right','stay']}));assert.throws(()=>validateBrain({...brain,weights:[[NaN]]}));assert.throws(()=>validateSettings({...DEFAULTS,gamma:2}));
  agent.dispose();restored.dispose();
});
