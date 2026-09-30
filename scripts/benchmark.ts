import { writeFileSync } from 'node:fs';
import { DQN, DEFAULTS, initializeTF } from '../src/dqn';
import { Game, random, type Action } from '../src/game';
const steps=Number(process.env.BENCHMARK_STEPS??20000),seeds=(process.env.BENCHMARK_SEEDS??'1,2,3').split(',').map(Number);
await initializeTF();
const results=[];
for(const seed of seeds){
  const agent=new DQN({...DEFAULTS,seed}),started=Date.now();let index=0,game=new Game(seed);
  function evaluate(){const ai:number[]=[],baseline:number[]=[];for(let i=0;i<10;i++){for(const isRandom of [false,true]){const env=new Game(9001+i),rng=random(19001+i);while(!env.ended){const a=isRandom?Math.floor(rng()*3) as Action:agent.choose(env.state(),false).action;env.step(a);} (isRandom?baseline:ai).push(env.score);}}return{ai,random:baseline,aiMean:ai.reduce((a,b)=>a+b,0)/10,randomMean:baseline.reduce((a,b)=>a+b,0)/10};}
  const before=evaluate();
  for(let step=0;step<steps;step++){const state=game.state(),chosen=agent.choose(state),result=game.step(chosen.action);agent.observe({state,action:chosen.action,reward:result.reward,next:game.state(),terminal:result.terminal||result.lifeLost});if(result.done){agent.record(game.score);game=new Game(seed+ ++index);}}
  const after=evaluate();const result={seed,steps,seconds:(Date.now()-started)/1000,episodes:agent.scores.length,loss:agent.loss,tensors:agent.memory(),before,after};results.push(result);console.log(JSON.stringify(result));agent.dispose();
}
writeFileSync('benchmark-results.json',JSON.stringify(results,null,2));
