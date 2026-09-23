/* On-demand Chzzk HLS source. Only playlist metadata is retained while watching. */
(() => {
  const api = globalThis.LiveShotLiveStream = {};
  const retainedVideo = new WeakMap();
  let channel = '', entries = [], track = null, pending = null, parser;
  const channelId = () => location.hostname === 'chzzk.naver.com' ? location.pathname.match(/^\/live\/([a-f0-9]{32})/)?.[1] || '' : '';
  const request = async url => {
    const reply = await chrome.runtime.sendMessage({ type: 'LIVESHOT_LIVE_TEXT', url });
    if (!reply?.ok) throw new Error(reply?.error || '라이브 영상 목록 요청에 실패했습니다.');
    return reply.text;
  };
  const attrs = line => Object.fromEntries([...line.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m => [m[1], m[2] ?? m[3]]));
  function parsePlaylist(text, base) {
    const result = []; let duration = 0, start = NaN, init = '', sequence = 0;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-KEY:') && attrs(line).METHOD !== 'NONE') throw new Error('암호화된 라이브 영상은 아직 지원하지 않습니다.');
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]);
      if (line.startsWith('#EXT-X-MAP:')) init = new URL(attrs(line).URI, base).href;
      if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) start = Date.parse(line.slice(25));
      if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice(8)) * 1000;
      if (line && !line.startsWith('#') && duration) {
        result.push({ url: new URL(line, base).href, init, start, end: start + duration, duration, sequence: sequence++ });
        start += duration; duration = 0;
      }
    }
    return result;
  }
  async function refresh() {
    const id = channelId();
    if (id !== channel) { channel = id; entries = []; track = null; }
    if (!id) return;
    if (pending) return pending;
    pending = (async () => {
      const detailUrl = `https://api.chzzk.naver.com/service/v3/channels/${id}/live-detail`;
      let payload = JSON.parse(await request(detailUrl));
      if (payload.content?.status === 'OPEN' && !payload.content.livePlaybackJson) {
        // The logged-in page is allowed to view this stream. Let the browser
        // attach its normal session; never read, persist or export cookies.
        const response = await fetch(detailUrl, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`로그인 상태의 영상 정보 요청 실패 (${response.status})`);
        payload = await response.json();
      }
      if (payload.content?.status !== 'OPEN') throw new Error('방송이 종료되어 라이브 구간을 가져올 수 없습니다.');
      const playback = JSON.parse(payload.content.livePlaybackJson || 'null');
      const media = playback?.media?.find(m => m.mediaId === 'HLS');
      if (!media) throw new Error('독립 재생용 영상 정보를 받지 못했습니다. 해당 방송이 로그인·인증 후 정상 재생되는지 확인해 주세요.');
      const master = await request(media.path); let info; const variants = [];
      for (const line of master.split('\n').map(l => l.trim())) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) info = attrs(line);
        else if (info && line && !line.startsWith('#')) { const [width, height] = (info.RESOLUTION || '').split('x').map(Number); variants.push({ url: new URL(line, media.path).href, width, height, fps: Number(info['FRAME-RATE']) || 30 }); info = null; }
      }
      const selected = variants.filter(v => v.width && v.height).sort((a,b) => b.height-a.height)[0];
      if (!selected) throw new Error('지원되는 라이브 화질이 없습니다.');
      const fresh = parsePlaylist(await request(selected.url), selected.url);
      if (!fresh.length || !fresh[0].init) throw new Error('지원되는 fMP4 영상 조각이 없습니다.');
      // Some streams omit wall-clock tags. Align by observed sequence overlap.
      const overlap = fresh.find(e => entries.some(old => old.sequence === e.sequence));
      let cursor = Number.isFinite(fresh[0].start) ? fresh[0].start : overlap ? entries.find(e => e.sequence === overlap.sequence).start - fresh.slice(0, fresh.indexOf(overlap)).reduce((n,e)=>n+e.duration,0) : Date.now()-fresh.reduce((n,e)=>n+e.duration,0);
      for (const e of fresh) { if (!Number.isFinite(e.start)) { e.start = cursor; e.end = cursor+e.duration; } cursor = e.end; }
      if (channel !== id) return;
      if (track && (track.width !== selected.width || fresh.at(-1).sequence < (entries.at(-1)?.sequence || 0))) entries = [];
      const merged = new Map(entries.map(e => [e.sequence,e])); for (const e of fresh) merged.set(e.sequence,e);
      const edge = fresh.at(-1).end;
      entries = [...merged.values()].filter(e => e.end > edge-90000).sort((a,b)=>a.start-b.start);
      track = selected;
    })().finally(() => { pending = null; });
    return pending;
  }
  async function bytes(url, signal) {
    const r = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(`영상 구간이 만료되었거나 다운로드할 수 없습니다 (${r.status}). 창을 다시 열어 주세요.`);
    return r.arrayBuffer();
  }
  async function demux(segment, signal, retained) {
    parser ||= import(chrome.runtime.getURL('vendor/mp4box/mp4box.all.mjs'));
    const {createFile, DataStream} = await parser;
    const parts = await Promise.all([segment.init,segment.url].map(url=>retained?.get(url) || bytes(url,signal)));
    const combined = new Uint8Array(parts.reduce((n,b)=>n+b.byteLength,0)); let offset=0;
    for(const part of parts){combined.set(new Uint8Array(part),offset);offset+=part.byteLength;}
    const file=createFile(); let video; const samples=[]; let parseError;
    file.onError=e=>{parseError=String(e);};
    file.onReady=info=>{video=info.videoTracks[0];file.setExtractionOptions(video.id,null,{nbSamples:1});file.start();};
    file.onSamples=(id,user,batch)=>samples.push(...batch);
    combined.buffer.fileStart=0;file.appendBuffer(combined.buffer);file.flush();
    if(parseError || !samples.length) throw new Error(parseError || '영상 프레임을 읽지 못했습니다.');
    const entry=file.getTrackById(video.id).mdia.minf.stbl.stsd.entries[0];
    if(!entry.avcC) throw new Error('현재 라이브 추출은 H.264 영상만 지원합니다.');
    const stream=new DataStream(undefined,0,DataStream.BIG_ENDIAN);entry.avcC.write(stream);
    return {samples,config:{codec:video.codec,codedWidth:video.video.width,codedHeight:video.video.height,description:new Uint8Array(stream.buffer,8)}};
  }
  async function* decoded(segment, signal, retained) {
    const {samples,config}=await demux(segment,signal,retained);
    const queue=[]; let done=false, stopped=false, failure, wake, drain;
    const notify=()=>{wake?.();wake=null;};
    const base=Math.min(...samples.map(s=>s.cts/s.timescale))*1000;
    const decoder=new VideoDecoder({output:frame=>{if(signal.aborted)frame.close();else queue.push(frame);notify();},error:e=>{failure=e;done=true;notify();drain?.();}});
    const abort=()=>{done=true;notify();drain?.();};signal.addEventListener('abort',abort,{once:true});
    decoder.configure(config);
    const producer=(async()=>{try{
      for(const s of samples){
        if(signal.aborted || stopped) break;
        while(queue.length+decoder.decodeQueueSize>=12 && !signal.aborted && !failure && !stopped) await new Promise(r=>{drain=r;});
        if(signal.aborted || failure || stopped) break;
        decoder.decode(new EncodedVideoChunk({type:s.is_sync?'key':'delta',timestamp:Math.round(s.cts*1e6/s.timescale),duration:Math.round(s.duration*1e6/s.timescale),data:s.data}));
      }
      if(!signal.aborted && !failure && !stopped)await decoder.flush();
    }catch(e){failure=e;}finally{done=true;notify();}})();
    decoder.addEventListener('dequeue',()=>{drain?.();drain=null;});
    try{
      while(!done || queue.length){
        if(signal.aborted)throw new DOMException('취소했습니다.','AbortError');
        if(!queue.length){await new Promise(r=>{wake=r;});continue;}
        const frame=queue.shift();drain?.();drain=null;
        try{yield {frame,time:segment.start+frame.timestamp/1000-base};}finally{frame.close();}
      }
      if(failure)throw failure;
    }finally{signal.removeEventListener('abort',abort);stopped=true;done=true;drain?.();if(decoder.state!=='closed')decoder.close();queue.forEach(f=>f.close());queue.length=0;await producer;}
  }
  api.captureSnapshot = () => {
    const capturedAt = Date.now();
    const freeze = () => ({entries:entries.filter(e=>e.start<capturedAt).map(e=>({...e})),track:{...track},capturedAt});
    return entries.length ? Promise.resolve(freeze()) : refresh().then(freeze).catch(()=>({entries:[],track:{...track},capturedAt}));
  };
  api.open = async snapshot => {
    if(typeof VideoDecoder === 'undefined')throw new Error('이 브라우저는 라이브 프레임 추출을 지원하지 않습니다.');
    if(!snapshot){await refresh();snapshot={entries:entries.map(e=>({...e})),track:{...track}};}
    if(!snapshot.entries?.length)throw new Error('라이브 구간을 준비 중입니다. 잠시 후 다시 눌러 주세요.');
    const segments=snapshot.entries, end=Math.min(segments.at(-1).end,snapshot.capturedAt || Infinity), start=Math.max(segments[0].start,end-90000);
    if(!retainedVideo.has(snapshot))retainedVideo.set(snapshot,new Map());
    const retained=retainedVideo.get(snapshot);
    const controller=new AbortController(); let previews=Promise.resolve();
    let previewIterator=null, previewFrame=null, previewRequested=-Infinity;
    async function* previewFrames(index){
      for(const segment of segments.slice(index)){
        yield* decoded(segment,controller.signal,retained);
      }
    }
    const session={snapshot,width:snapshot.track.width,height:snapshot.track.height,fps:snapshot.track.fps,end,available:(end-start)/1000,
      async retain(startAgo,endAgo){
        // Preserve compressed media for the chosen interval, not decoded RGBA frames.
        const urls=new Set(segments.filter(s=>s.end>end-startAgo*1000&&s.start<end-endAgo*1000).flatMap(s=>[s.init,s.url]));
        for(const url of retained.keys())if(!urls.has(url))retained.delete(url);
        await Promise.all([...urls].map(url=>{
          if(!retained.has(url)){
            const job=bytes(url,AbortSignal.timeout(20000)).catch(error=>{if(retained.get(url)===job)retained.delete(url);throw error;});
            retained.set(url,job);
          }
          return retained.get(url);
        }));
      },
      dispose(){controller.abort();void previews.finally(async()=>{await previewIterator?.return();previewIterator=null;previewFrame=null;}).catch(()=>{});},
      async still(ago){
        const bitmap=await session.preview(ago);
        const release=previews.then(async()=>{await previewIterator?.return();previewIterator=null;previewFrame=null;});
        previews=release.catch(()=>{});
        try { await release; return bitmap; } catch(error) { bitmap.close(); throw error; }
      },
      async preview(ago){
        const target=Math.min(end-1,Math.max(start,end-ago*1000));const segment=segments.find(s=>s.start<=target&&s.end>target);
        if(!segment)throw new Error('이 시점의 영상 구간이 없습니다.');
        const load=async()=>{
          if(controller.signal.aborted)throw new DOMException('취소했습니다.','AbortError');
          // Decode ahead with the bounded WebCodecs queue, not a whole segment's
          // resized bitmaps. Keep source resolution and source frame cadence.
          if(!previewIterator || target<previewRequested-1 || target-previewRequested>1500){
            await previewIterator?.return();
            previewIterator=previewFrames(segments.indexOf(segment));previewFrame=null;
          }
          previewRequested=target;
          while(!previewFrame || previewFrame.time+1000/session.fps<target){
            const item=await previewIterator.next();
            if(item.done){previewFrame=null;previewIterator=null;throw new Error('미리보기 구간의 끝입니다.');}
            previewFrame=item.value;
          }
          return createImageBitmap(previewFrame.frame);
        };
        const job=previews.then(load);previews=job.catch(()=>{});return job;
      },
      async *frames(startAgo,endAgo,fps,signal){
        const first=end-startAgo*1000,last=end-endAgo*1000,step=1000/fps;
        let next=first,previousEnd=first;const local=new AbortController();
        const abort=()=>local.abort();signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',abort,{once:true});
        if(signal?.aborted || controller.signal.aborted)local.abort();
        try{for(const segment of segments.filter(s=>s.end>first&&s.start<last)){
          if(segment.start>previousEnd+200)throw new Error('선택한 영상 구간에 빈 구간이 있습니다.');
          previousEnd=segment.end;
          for await(const item of decoded(segment,local.signal,retained)){
            if(item.time+step*.15<next)continue;
            while(next<last && next<=item.time+step*.15){
              const bitmap=await createImageBitmap(item.frame);
              try{yield {bitmap,time:next};}finally{bitmap.close();}
              next+=step;
            }
          }
        }
        if(next<last-step*1.1)throw new Error('선택한 구간의 프레임이 부족합니다.');
        }finally{local.abort();signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',abort);}
      }
    };
    return session;
  };
  api.refresh=refresh;
  setInterval(()=>refresh().catch(()=>{}),5000);refresh().catch(()=>{});
})();
