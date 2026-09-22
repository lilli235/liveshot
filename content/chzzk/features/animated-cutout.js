/* First-frame segmentation with block-motion mask propagation. */
globalThis.LiveShotAnimatedCutout = class {
  constructor(point, cancelled, progress, mode = 'ai') {
    this.mode = mode;
    this.point = point; this.cancelled = cancelled; this.progress = progress;
    this.small = document.createElement('canvas'); this.small.width = 128; this.small.height = 128;
    this.ctx = this.small.getContext('2d', {willReadFrequently:true});
    this.mask = document.createElement('canvas'); this.mask.width = 128; this.mask.height = 128;
    this.lastAi = -Infinity;
  }
  async infer(source) {
    if (!this.host) {
      this.host = document.createElement('iframe'); this.host.style.cssText = 'position:fixed;left:-10000px;width:1px;height:1px';
      const ready = new Promise((resolve,reject) => { this.host.onload=resolve; this.host.onerror=()=>reject(new Error('배경 제거 실행기 로드 실패')); });
      this.host.src=chrome.runtime.getURL('vendor/ai-runtime/ai-host.html'); document.documentElement.append(this.host); await ready;
    }
    const input=document.createElement('canvas'); input.width=input.height=1024; const context=input.getContext('2d'); context.drawImage(source,0,0,1024,1024);
    const data=context.getImageData(0,0,1024,1024).data; const values=new Float32Array(3*1024*1024); const means=[.485,.456,.406],std=[.229,.224,.225];
    for(let p=0;p<1024*1024;p++) for(let c=0;c<3;c++) values[c*1024*1024+p]=(data[p*4+c]/255-means[c])/std[c];
    const channel='cutout-'+Math.random();
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{clearInterval(timer);window.removeEventListener('message',receive);error?reject(error):resolve(result);};
      const receive=event=>{const m=event.data;if(event.source!==this.host?.contentWindow||m?.channel!==channel)return;if(m.type==='error')finish(new Error(m.message));else if(m.output)finish(null,new Float32Array(m.output.buffer));};
      const deadline=Date.now()+180000;
      const timer=setInterval(()=>{if(this.cancelled()||Date.now()>deadline)finish(new Error(this.cancelled()?'작업 취소':'배경 제거 시간 초과'));},100);
      window.addEventListener('message',receive);
      this.host.contentWindow.postMessage({__liveShotAiCommand:true,type:'run',channel,modelName:'birefnet-lite-compatible.onnx',image:{buffer:values.buffer,dims:[1,3,1024,1024]}},'*',[values.buffer]);
    });
  }
  async apply(source,time) {
    if(this.cancelled())throw new Error('작업 취소');
    if(this.mode!=='ai') {
      const context=source.getContext('2d'),image=context.getImageData(0,0,source.width,source.height);
      const color=this.detectSolid(image);
      if(color || this.keyColor) {
        this.mode='solid';this.keyColor ||= color;
        this.progress('단색 배경 제거 중…');
        this.removeSolid(image,this.keyColor);context.putImageData(image,0,0);return;
      }
      throw new Error('단색 배경색을 찾지 못했습니다. AI 배경 제거를 사용해 주세요.');
    }
    this.ctx.drawImage(source,0,0,128,128); const rgba=this.ctx.getImageData(0,0,128,128).data;
    const gray=new Float32Array(16384);for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3;
    let next=new Uint8Array(16384),error=0;
    if(this.previous) {
      // Backward block matching moves the previous mask with local image motion.
      for(let by=0;by<128;by+=8)for(let bx=0;bx<128;bx+=8){let best=Infinity,dxBest=0,dyBest=0;
        for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){let cost=0,count=0;for(let y=by;y<by+8;y+=2)for(let x=bx;x<bx+8;x+=2){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=128||yy>=128)continue;cost+=Math.abs(gray[y*128+x]-this.previous[yy*128+xx]);count++;}cost=count?cost/count+.05*(Math.abs(dx)+Math.abs(dy)):Infinity;if(cost<best){best=cost;dxBest=dx;dyBest=dy;}}
        error+=best/256;for(let y=by;y<by+8;y++)for(let x=bx;x<bx+8;x++){const xx=Math.max(0,Math.min(127,x+dxBest)),yy=Math.max(0,Math.min(127,y+dyBest));next[y*128+x]=this.alpha[yy*128+xx];}
      }
    }
    if(!this.previous||time-this.lastAi>=1||error>22){
      this.progress('AI 배경 보정 중…');const result=await this.infer(source);if(result.length!==1048576)throw new Error('배경 마스크 크기 오류');
      const probability=result.every(v=>v>=0&&v<=1); const binary=new Uint8Array(16384);
      for(let y=0;y<128;y++)for(let x=0;x<128;x++){const v=result[(y*8+4)*1024+x*8+4];binary[y*128+x]=(probability?v:1/(1+Math.exp(-v)))>=.2?1:0;}
      const seen=new Uint8Array(16384),queue=new Int32Array(16384);let best=null;
      for(let seed=0;seed<16384;seed++){if(!binary[seed]||seen[seed])continue;let head=0,tail=1,dist=Infinity,overlap=0;queue[0]=seed;seen[seed]=1;
        while(head<tail){const p=queue[head++],x=p%128,y=Math.floor(p/128);dist=Math.min(dist,Math.hypot(x-this.point.x*128,y-this.point.y*128));if(next[p])overlap++;for(const n of [y?p-128:-1,y<127?p+128:-1,x?p-1:-1,x<127?p+1:-1])if(n>=0&&binary[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}}
        const score=this.previous?overlap-dist*.01:-dist;if(!best||score>best.score)best={score,pixels:queue.slice(0,tail)};
      }
      if(!best)throw new Error('선택한 캐릭터를 찾지 못했습니다');next.fill(0);for(const p of best.pixels)next[p]=255;
      this.lastAi=time;
    }
    // Keep propagation separate: feeding the expanded mask back would grow it every frame.
    this.alpha=next;this.previous=gray;
    const safe=this.preserveOutline(next);
    const mc=this.mask.getContext('2d'),pixels=mc.createImageData(128,128);for(let i=0;i<16384;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=safe[i];}mc.putImageData(pixels,0,0);
    const target=source.getContext('2d');target.save();target.globalCompositeOperation='destination-in';target.imageSmoothingEnabled=true;target.drawImage(this.mask,0,0,source.width,source.height);target.restore();
  }
  preserveOutline(core) {
    core=core.slice();
    // A torso touching the bottom is not an exterior hole. Close only the
    // bottom span supported by foreground on both sides before flood filling.
    let left=128,right=-1;
    for(let x=0;x<128;x++)if(core[127*128+x]){left=Math.min(left,x);right=x;}
    if(right>left)for(let x=left;x<=right;x++)core[127*128+x]=255;
    const outside=new Uint8Array(16384),queue=new Int32Array(16384);let head=0,tail=0;
    const visit=p=>{if(!core[p]&&!outside[p]){outside[p]=1;queue[tail++]=p;}};
    for(let i=0;i<128;i++){visit(i);visit(127*128+i);visit(i*128);visit(i*128+127);}
    while(head<tail){const p=queue[head++],x=p%128,y=Math.floor(p/128);if(x)visit(p-1);if(x<127)visit(p+1);if(y)visit(p-128);if(y<127)visit(p+128);}
    // Enclosed areas belong to the character by default; only feather outward.
    const filled=core.slice(),safe=new Uint8Array(16384);
    for(let p=0;p<filled.length;p++)if(!outside[p])filled[p]=255;
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      if(!filled[y*128+x])continue;
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
        const xx=x+dx,yy=y+dy,d=Math.hypot(dx,dy);
        if(xx<0||yy<0||xx>=128||yy>=128||d>3)continue;
        const p=yy*128+xx,alpha=d<=2?255:Math.round(255*(3-d));safe[p]=Math.max(safe[p],alpha);
      }
    }
    return safe;
  }
  detectSolid(image) {
    const {width:w,height:h,data}=image,samples=[];
    for(let i=0;i<64;i++){
      const x=Math.round(i*(w-1)/63),y=Math.round(i*(h-1)/63);
      for(const p of [x,(h-1)*w+x,y*w,y*w+w-1])if(data[p*4+3]>250)samples.push([data[p*4],data[p*4+1],data[p*4+2]]);
    }
    if(samples.length<192)return null;
    const color=[0,1,2].map(c=>samples.map(s=>s[c]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
    return samples.filter(s=>s.every((v,c)=>Math.abs(v-color[c])<=10)).length/samples.length>=.5?color:null;
  }
  removeSolid(image,color) {
    const {width:w,height:h,data}=image,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
    const visit=p=>{if(seen[p])return;seen[p]=1;if(data[p*4+3] && color.some((v,c)=>Math.abs(data[p*4+c]-v)>12))return;queue[tail++]=p;};
    for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x);}for(let y=0;y<h;y++){visit(y*w);visit(y*w+w-1);}
    while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);data[p*4+3]=0;if(x)visit(p-1);if(x<w-1)visit(p+1);if(y)visit(p-w);if(y<h-1)visit(p+w);}
  }
  dispose(){this.host?.remove();this.host=null;this.previous=null;this.alpha=null;}
};
