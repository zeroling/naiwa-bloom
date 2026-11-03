/* Only the two MLPs run on WebGPU. SPH/life commits share the CPU engine. */
const shader=`
struct Params { rows:u32, inputs:u32, outputs:u32, padding:u32 }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read_write> hidden:array<f32>;
@group(0) @binding(3) var<storage,read_write> y:array<f32>;
@group(0) @binding(4) var<storage,read> w1:array<f32>;
@group(0) @binding(5) var<storage,read> b1:array<f32>;
@group(0) @binding(6) var<storage,read> w2:array<f32>;
@group(0) @binding(7) var<storage,read> b2:array<f32>;
@compute @workgroup_size(64) fn first(@builtin(global_invocation_id) id:vec3<u32>){
 let row=id.y;let h=id.x;if(row>=p.rows||h>=128u){return;}var v=b1[h];
 for(var k=0u;k<p.inputs;k++){v+=x[row*p.inputs+k]*w1[k*128u+h];}hidden[row*128u+h]=max(v,0.0);
}
@compute @workgroup_size(64) fn second(@builtin(global_invocation_id) id:vec3<u32>){
 let row=id.y;let o=id.x;if(row>=p.rows||o>=p.outputs){return;}var v=b2[o];
 for(var h=0u;h<128u;h++){v+=hidden[row*128u+h]*w2[h*p.outputs+o];}y[row*p.outputs+o]=v;
}`;

export async function createGPU(meta,bytes,{allowSoftware=false}={}){
 if(!navigator.gpu)return null;const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});if(!adapter)return null;
 const info=adapter.info||{};if(!allowSoftware&&(adapter.isFallbackAdapter||info.isFallbackAdapter||/swiftshader|llvmpipe|software/i.test([info.architecture,info.description,info.device].join(' '))))return null;
 if(adapter.limits.maxStorageBuffersPerShaderStage<7)return null;
 const device=await adapter.requestDevice();let lost=false;device.lost.then(()=>lost=true);
 const module=device.createShaderModule({code:shader}),layout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
  ...[1,2,3,4,5,6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===2||binding===3?'storage':'read-only-storage'}}))]});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const [first,second]=await Promise.all(['first','second'].map(entryPoint=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})));
 const models={};let capacity=0,buffers=[];
 function buffer(size,usage,data){const b=device.createBuffer({size:Math.max(16,size),usage,mappedAtCreation:!!data});if(data){new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));b.unmap();}return b;}
 for(const name of ['shape','life']){models[name]=meta.tensors[name].parts.map(part=>buffer(part.length*4,GPUBufferUsage.STORAGE,new Uint8Array(bytes,part.offset,part.length*4)));}
 function reserve(rows){if(rows<=capacity)return;for(const b of buffers)b.destroy();capacity=2**Math.ceil(Math.log2(Math.max(16,rows)));
  buffers=[buffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),buffer(capacity*66*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),
   buffer(capacity*128*4,GPUBufferUsage.STORAGE),buffer(capacity*20*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),buffer(capacity*20*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST)];
 }
 return {
  async infer(name,features,rows){if(lost)throw Error('GPU device lost');reserve(rows);const [params,input,hidden,output,readback]=buffers;
   device.queue.writeBuffer(params,0,new Uint32Array([rows,meta.tensors[name].inputs,20,0]));device.queue.writeBuffer(input,0,features);
   const all=[params,input,hidden,output,...models[name]],group=device.createBindGroup({layout,entries:all.map((buffer,binding)=>({binding,resource:{buffer}}))});
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setBindGroup(0,group);pass.setPipeline(first);pass.dispatchWorkgroups(2,rows);pass.setPipeline(second);pass.dispatchWorkgroups(1,rows);pass.end();
   encoder.copyBufferToBuffer(output,0,readback,0,rows*20*4);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ,0,rows*20*4);
   const result=new Float32Array(readback.getMappedRange(0,rows*20*4)).slice();readback.unmap();return result;
  },
  destroy(){for(const b of buffers)b.destroy();for(const m of Object.values(models))for(const b of m)b.destroy();device.destroy();}
 };
}
