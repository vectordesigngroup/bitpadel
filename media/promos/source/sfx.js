const fs=require('fs');const SR=44100;
function wav(name,data){const b=Buffer.alloc(44+data.length*2);b.write('RIFF',0);b.writeUInt32LE(36+data.length*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length*2,40);data.forEach((v,i)=>b.writeInt16LE(Math.max(-1,Math.min(1,v))*32767|0,44+i*2));fs.writeFileSync('public/'+name,b);}
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647*2-1};
// whoosh: bandpassed noise, rising then falling
{const n=SR*0.45|0,d=new Float32Array(n);let lp=0,lp2=0;for(let i=0;i<n;i++){const t=i/n;const env=Math.sin(Math.PI*Math.pow(t,0.7))**2;const a=0.02+0.25*Math.sin(Math.PI*t);lp+=a*(rnd()-lp);lp2+=a*0.6*(lp-lp2);d[i]=(lp-lp2)*env*2.2;}wav('whoosh.wav',[...d]);}
// pop: pitch-dropping sine
{const n=SR*0.18|0,d=[];let ph=0;for(let i=0;i<n;i++){const t=i/SR;const f=900*Math.exp(-t*25)+180;ph+=2*Math.PI*f/SR;d.push(Math.sin(ph)*Math.exp(-t*28)*0.7);}wav('pop.wav',d);}
// tick
{const n=SR*0.05|0,d=[];for(let i=0;i<n;i++){const t=i/SR;d.push(Math.sin(2*Math.PI*2400*t)*Math.exp(-t*120)*0.5);}wav('tick.wav',d);}
// chime: success
{const n=SR*0.9|0,d=[];for(let i=0;i<n;i++){const t=i/SR;let v=0;[[880,0],[1318.5,0.08],[1760,0.16]].forEach(([f,o])=>{if(t>o)v+=Math.sin(2*Math.PI*f*(t-o))*Math.exp(-(t-o)*5)*0.25;});d.push(v);}wav('chime.wav',d);}
// bass hit
{const n=SR*0.7|0,d=[];let ph=0;for(let i=0;i<n;i++){const t=i/SR;const f=110*Math.exp(-t*8)+42;ph+=2*Math.PI*f/SR;d.push(Math.tanh(Math.sin(ph)*1.6)*Math.exp(-t*5)*0.8);}wav('hit.wav',d);}
console.log('ok');
