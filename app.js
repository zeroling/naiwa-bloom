const $=id=>document.getElementById(id),canvas=$('particles'),stage=$('stage'),text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
let data=null,meta=null,ready=false,paused=false,tool='erase',brush=.06,lastGesture=0;
const camera={x:0,y:0,extent:1.17,follow:true},pointers=new Map();let gesture=null,paintPending=false;
const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'}),ctx=gl?null:canvas.getContext('2d');
let program,buffer,uniforms,position,color,uploaded=null;
if(gl){
 const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec3 c;uniform vec2 center;uniform float extent;uniform float size;varying vec3 rgb;void main(){gl_Position=vec4((p-center)/extent,0.,1.);gl_PointSize=size;rgb=c;}'));
 gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'precision mediump float;varying vec3 rgb;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(rgb,1.-smoothstep(.35,.5,r));}'));gl.linkProgram(program);buffer=gl.createBuffer();position=gl.getAttribLocation(program,'p');color=gl.getAttribLocation(program,'c');uniforms=Object.fromEntries(['center','extent','size'].map(k=>[k,gl.getUniformLocation(program,k)]));
}
function draw(){if(paintPending)return;paintPending=true;requestAnimationFrame(()=>{paintPending=false;if(document.hidden)return;const rect=canvas.getBoundingClientRect(),dpi=Math.min(devicePixelRatio||1,2),w=Math.round(rect.width*dpi),h=Math.round(rect.height*dpi);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
 const points=data?.points,total=points?.length/5||0,size=Math.max(total<32?4*dpi:1.4,Math.min(7,(meta?.spacing||.014)*w/(camera.extent*2)*.84));
 if(gl){gl.viewport(0,0,w,h);gl.clearColor(18/255,43/255,38/255,1);gl.clear(gl.COLOR_BUFFER_BIT);if(!points?.length)return;gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);if(uploaded!==points){gl.bufferData(gl.ARRAY_BUFFER,points,gl.DYNAMIC_DRAW);uploaded=points;}gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,3,gl.FLOAT,false,20,8);gl.uniform2f(uniforms.center,camera.x,camera.y);gl.uniform1f(uniforms.extent,camera.extent);gl.uniform1f(uniforms.size,size);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.POINTS,0,total);
 }else{ctx.fillStyle='#122b26';ctx.fillRect(0,0,w,h);if(!points?.length)return;const scale=w/(camera.extent*2);for(let i=0;i<points.length;i+=5){const x=(points[i]-camera.x)*scale+w/2,y=-(points[i+1]-camera.y)*scale+h/2;if(x<0||x>w||y<0||y>h)continue;ctx.fillStyle=`rgb(${Math.round(points[i+2]*255)} ${Math.round(points[i+3]*255)} ${Math.round(points[i+4]*255)})`;ctx.fillRect(x-size/2,y-size/2,size,size);}}
 });}
const worker=new Worker(new URL('./worker.js?v=legs-20261103-1',import.meta.url),{type:'module'});
worker.onmessage=({data:message})=>{
 if(message.type==='frame'){
  data=message;paused=message.paused;if(meta&&message.serial!==stage._serial){stage._serial=message.serial;camera.x=meta.seed[0];camera.y=meta.seed[1];camera.extent=1.17;camera.follow=true;
  }
  if(camera.follow&&performance.now()-lastGesture>800&&message.points.length){let x=0,y=0;for(let i=0;i<message.points.length;i+=5){x+=message.points[i];y+=message.points[i+1];}camera.x+=(x/message.n-camera.x)*.12;camera.y+=(y/message.n-camera.y)*.12;}
  for(const id of ['erase','pan'])$(id).disabled=message.intro;
  text('growth-label',paused?'奶蛙歇一会儿':message.intro?'一小粒开心，慢慢盛开':message.n>=message.target*.95?'花花正在盛开':message.erased?'把小小缺口，慢慢补回来':'正在一点点长大');text('pause-icon',paused?'▷':'Ⅱ');$('pause').setAttribute('aria-label',paused?'继续演化':'暂停演化');draw();
 }else if(message.type==='ready'){
  meta=message.meta;ready=true;camera.x=meta.seed[0];camera.y=meta.seed[1];$('loading').hidden=true;for(const id of ['pause','restart'])$(id).disabled=false;
 }else if(message.type==='error'||message.type==='notice'){$('notice').hidden=false;text('notice',message.type==='error'?'这朵花暂时歇了一下：'+message.message:message.message);}
};
worker.onerror=e=>{$('notice').hidden=false;text('notice','小奶蛙没有准备好，请刷新页面再试。');console.error(e);};
const mode=new URLSearchParams(location.search).get('mode')==='cpu'?'cpu':'auto';worker.postMessage({type:'init',mode,seed:crypto.getRandomValues(new Uint32Array(1))[0]});
function setTool(value){tool=value;for(const id of ['erase','pan'])$(id).setAttribute('aria-pressed',String(id===value));text('hint',value==='erase'?'轻轻擦掉一点，它还会继续长大。':'单指移动，双指缩放。换个角度看看小奶蛙。');$('brush').hidden=true;}
$('erase').onclick=()=>setTool('erase');$('pan').onclick=()=>setTool('pan');$('pause').onclick=()=>worker.postMessage({type:'pause',paused:!paused});
$('restart').onclick=()=>{worker.postMessage({type:'reset'});$('notice').hidden=true;camera.follow=true;};
$('brush-size').oninput=e=>brush=Number(e.target.value);
$('center').onclick=()=>{camera.follow=true;if(data?.points.length){let x=0,y=0;for(let i=0;i<data.points.length;i+=5){x+=data.points[i];y+=data.points[i+1];}camera.x=x/data.n;camera.y=y/data.n;}camera.extent=1.17;draw();};
function world(point){const r=canvas.getBoundingClientRect();return [(point.x-r.left-r.width/2)*2*camera.extent/r.width+camera.x,-(point.y-r.top-r.height/2)*2*camera.extent/r.height+camera.y];}
function showBrush(point){if(tool!=='erase')return;const r=canvas.getBoundingClientRect(),b=$('brush');b.hidden=false;b.style.left=(point.x-r.left)+'px';b.style.top=(point.y-r.top)+'px';b.style.width=b.style.height=(brush/camera.extent*r.width)+'px';}
canvas.onpointerdown=e=>{if(!ready||data?.intro||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const point={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,point);lastGesture=performance.now();
 if(tool==='erase'&&pointers.size===1){const p=world(point);worker.postMessage({type:'erase',start:p,end:p,radius:brush});showBrush(point);}else if(tool==='pan'&&pointers.size===2){const [a,b]=[...pointers.values()];gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),extent:camera.extent};}
};
canvas.onpointermove=e=>{const before=pointers.get(e.pointerId),point={x:e.clientX,y:e.clientY};if(!before)return;e.preventDefault();lastGesture=performance.now();
 if(tool==='erase'&&pointers.size===1){worker.postMessage({type:'erase',start:world(before),end:world(point),radius:brush});showBrush(point);}
 else if(tool==='pan'){camera.follow=false;if(pointers.size===1){const r=canvas.getBoundingClientRect();camera.x-=(point.x-before.x)*2*camera.extent/r.width;camera.y+=(point.y-before.y)*2*camera.extent/r.height;}else if(gesture){const values=[...pointers.entries()].map(([id,p])=>id===e.pointerId?point:p);camera.extent=Math.max(.2,Math.min(6,gesture.extent*gesture.distance/Math.max(1,Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y))));}draw();}
 pointers.set(e.pointerId,point);
};
function endPointer(e){pointers.delete(e.pointerId);gesture=null;$('brush').hidden=true;lastGesture=performance.now();}
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=endPointer;
canvas.addEventListener('wheel',e=>{e.preventDefault();camera.follow=false;camera.extent=Math.max(.2,Math.min(6,camera.extent*Math.exp(e.deltaY*.001)));draw();},{passive:false});
new ResizeObserver(draw).observe(stage);document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('page-hidden',document.hidden);worker.postMessage({type:'visibility',visible:!document.hidden});if(!document.hidden)draw();});
window.addEventListener('pagehide',()=>worker.postMessage({type:'visibility',visible:false}));window.addEventListener('pageshow',()=>worker.postMessage({type:'visibility',visible:!document.hidden}));draw();
