import {createGPU} from './gpu.js';
let engine,meta,modelBytes,prestate=null,opening=null,introPending=false,playbackIndex=0,playbackElapsed=0,playbackLast=0,gpu=null,mode='auto',paused=false,visible=true,ready=false,running=false,commands=[],selected='cpu',reason='',serial=0,profileAt=0,useGPU=false,fastUntil=8192;
const PLAYBACK_DURATION=6000;
const math={env:{log1p:Math.log1p,log:Math.log,exp:Math.exp,tanh:Math.tanh,sin:Math.sin,cos:Math.cos}};
const floats=(ptr,n)=>new Float32Array(engine.memory.buffer,ptr,n);
async function loadEngine(){for(const file of ['engine.wasm','engine-scalar.wasm']){try{const response=await fetch(new URL(file,import.meta.url));const binary=await response.arrayBuffer();return (await WebAssembly.instantiate(binary,math)).instance.exports;}catch(e){if(file==='engine-scalar.wasm')throw e;}}}
async function loadPrestate(){try{
 const response=await fetch(new URL('assets/prestate.bin',import.meta.url));if(!response.ok)return null;
 const bytes=await response.arrayBuffer(),h=new Uint32Array(bytes,0,12);
 if(h[0]!==0x3153504e||h[1]!==1||h[2]!==meta.epoch||h[3]<1||h[3]>32768||bytes.byteLength!==48+h[3]*140)return null;
 return {h,x:new Float32Array(bytes,48,h[3]*2),s:new Float32Array(bytes,48+h[3]*8,h[3]*32),ids:new Uint32Array(bytes,48+h[3]*136,h[3])};
 }catch(e){return null;}}
async function loadOpening(){try{
 let bytes;if(typeof DecompressionStream==='function'){const response=await fetch(new URL('assets/opening.bin.gz',import.meta.url));if(!response.ok)return null;bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
 else{const response=await fetch(new URL('assets/opening.bin',import.meta.url));if(!response.ok)return null;bytes=await response.arrayBuffer();}
 const head=new Uint32Array(bytes,0,5);if(head[0]!==0x3152504e||head[1]!==1||head[2]!==meta.epoch)return null;
 const frames=[];let offset=20;
 for(let i=0;i<head[3];i++){const h=new Uint32Array(bytes,offset,2),q=new Float32Array(bytes,offset+8,4),n=h[1];frames.push({step:h[0],n,ox:q[0],oy:q[1],sx:q[2],sy:q[3],xy:new Uint16Array(bytes,offset+24,n*2),rgb:new Uint8Array(bytes,offset+24+n*4,n*3)});offset=(offset+24+n*7+3)&~3;}
 return frames;
 }catch(e){return null;}}
function begin(seed){
 engine.reset(seed);introPending=!!(prestate&&opening);playbackIndex=0;playbackElapsed=0;playbackLast=0;
 if(prestate){const {h,x,s,ids}=prestate;floats(engine.positions_ptr(),x.length).set(x);floats(engine.states_ptr(),s.length).set(s);new Uint32Array(engine.memory.buffer,engine.ids_ptr(),ids.length).set(ids);
  engine.restore_state(h[3],h[4],h[5],h[6],h[7],h[8],h[9],h[10]);}
 fastUntil=prestate?engine.clock_steps():8192;
}
function frame(){if(!engine)return;let n=engine.count(),steps=engine.clock_steps(),points;
 if(introPending){const f=opening[playbackIndex];n=f.n;steps=f.step;points=new Float32Array(n*5);for(let i=0;i<n;i++){points[i*5]=f.ox+f.xy[i*2]*f.sx;points[i*5+1]=f.oy+f.xy[i*2+1]*f.sy;for(let c=0;c<3;c++)points[i*5+2+c]=f.rgb[i*3+c]/255;}}
 else points=floats(engine.draw_ptr(),n*5).slice();
 postMessage({type:'frame',points,n,steps,births:introPending?undefined:engine.birth_count(),deaths:introPending?undefined:engine.death_count(),erased:engine.erase_count(),backend:selected,reason,paused,intro:introPending,recorded:introPending,target:meta.target,epoch:meta.epoch,serial},[points.buffer]);}
async function evaluate(name){const n=engine.count(),life=name==='life',inputs=meta.tensors[name].inputs;
 if(gpu&&mode==='auto'&&n>=1024){
  try{
   let cpuTime=0;if(profileAt===0||n>=profileAt*1.8){const begin=performance.now();engine.mlp(life?1:0);cpuTime=performance.now()-begin;}
   if(cpuTime||useGPU){const begin=performance.now(),result=await gpu.infer(name,floats(engine.features_ptr(),n*inputs),n),gpuTime=performance.now()-begin;
    if(cpuTime){profileAt=n;useGPU=gpuTime<=cpuTime*1.2;}
    if(useGPU){floats(engine.outputs_ptr(),n*20).set(result);selected='gpu';reason='GPU神经网络加速，CPU处理局部感知与生死';return;}
    selected='cpu';reason='已自动选择当前更快的CPU';return;
   }
  }catch(e){gpu.destroy();gpu=null;useGPU=false;reason='GPU不可用，已保留粒子并切换CPU';}
 }
 engine.mlp(life?1:0);selected='cpu';
}
async function applyCommands(){for(const c of commands.splice(0)){
 if(c.type==='reset'){begin(c.seed||crypto.getRandomValues(new Uint32Array(1))[0]);serial++;profileAt=0;paused=false;}
 if(c.type==='erase'&&!introPending){if(engine.erase(...c.start,...c.end,c.radius))fastUntil=engine.clock_steps()+1024;}
 if(c.type==='backend'){mode=c.mode;profileAt=0;useGPU=false;if(mode==='cpu'&&gpu){gpu.destroy();gpu=null;}else if(mode==='auto'&&!gpu)try{gpu=await createGPU(meta,modelBytes);}catch(e){gpu=null;}}
 }if(commands.length)await applyCommands();}
async function loop(){if(running||!ready)return;running=true;
 if(!visible||(paused&&!commands.length)){playbackLast=0;running=false;setTimeout(loop,180);return;}
 try{await applyCommands();const begin=performance.now(),settled=engine.clock_steps()>=fastUntil&&engine.count()>=meta.target*.96;let count=0;
  if(introPending&&!paused){if(playbackLast)playbackElapsed+=begin-playbackLast;playbackLast=begin;if(playbackElapsed>=PLAYBACK_DURATION&&playbackIndex===opening.length-1)introPending=false;else playbackIndex=Math.min(opening.length-1,Math.floor(playbackElapsed/PLAYBACK_DURATION*(opening.length-1)));frame();return;}
  while(!paused&&!introPending&&visible&&performance.now()-begin<(settled?6:18)&&count<256){
   engine.prepare_shape();await evaluate('shape');if(engine.commit_shape()){
    engine.prepare_life();await evaluate('life');if(engine.commit_life()<0){paused=true;postMessage({type:'notice',message:'粒子超出当前设备的内存容量，已保留状态并暂停。'});}
   }count++;if(commands.length)break;
  }
  await applyCommands();frame();
 }catch(e){paused=true;postMessage({type:'error',message:String(e.message||e)});frame();}
  finally{running=false;const settled=engine.clock_steps()>=fastUntil&&engine.count()>=meta.target*.96;setTimeout(loop,paused||!visible?180:introPending?32:settled?80:8);}
}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{meta=await(await fetch(new URL('assets/model.json',import.meta.url))).json();const [bytes,loaded,snapshot,recording]=await Promise.all([fetch(new URL('assets/model.bin',import.meta.url)).then(r=>r.arrayBuffer()),loadEngine(),loadPrestate(),loadOpening()]);modelBytes=bytes;engine=loaded;
   if(snapshot&&recording?.length&&recording.at(-1).step===snapshot.h[4]&&recording.at(-1).n===snapshot.h[3]){prestate=snapshot;opening=recording;}
   new Uint8Array(engine.memory.buffer,engine.weights_ptr(),bytes.byteLength).set(new Uint8Array(bytes));
   engine.configure(meta.epsilon,meta.spacing,meta.birthRadius,meta.alpha,meta.updateProbability,...meta.grid,meta.target,...meta.seed);begin(data.seed||42);mode=data.mode||'auto';
   ready=true;postMessage({type:'ready',meta,preloaded:!!prestate});frame();loop();
   if(mode==='auto'){let candidate=null;try{let expired=false;const pending=createGPU(meta,bytes);candidate=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>{expired=true;resolve(null);},2500))]);if(expired)pending.then(late=>late?.destroy()).catch(()=>{});if(candidate)await candidate.infer('shape',new Float32Array(66),1);gpu=candidate;}catch(e){candidate?.destroy();gpu=null;reason='使用CPU实时计算';}}
  }catch(e){postMessage({type:'error',message:String(e.message||e)});}
 }else if(data.type==='pause'){paused=data.paused;playbackLast=0;frame();}
 else if(data.type==='visibility'){visible=data.visible;playbackLast=0;}
 else commands.push(data);
};
