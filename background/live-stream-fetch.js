// Narrow, read-only transport for public Chzzk playlists. Never accepts arbitrary hosts.
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=='LIVESHOT_LIVE_TEXT')return false;
  (async()=>{
    const source=new URL(sender.url||'https://invalid.local');
    if(source.hostname!=='chzzk.naver.com')throw Error('지원하지 않는 요청 출처입니다.');
    const url=new URL(message.url);
    // Chzzk also advertises this Naver CDN in livePlaybackJson.encodingTrack.
    // Keep the explicit host restriction: do not permit arbitrary playlist URLs.
    const playlistHost=/(^|\.)pstatic\.net$/.test(url.hostname) || (url.hostname==='ex-nlive-streaming.navercdn.com' && url.pathname.startsWith('/chzzk/'));
    const allowed=url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443') && ((url.hostname==='api.chzzk.naver.com' && /^\/service\/v3\/channels\/[a-f0-9]{32}\/live-detail$/.test(url.pathname)) || (playlistHost && /\.m3u8$/i.test(url.pathname)));
    if(!allowed)throw Error(`허용되지 않은 라이브 영상 주소입니다 (${url.hostname}).`);
    const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!response.ok)throw Error(`라이브 목록 요청 실패 (${response.status})`);
    const text=await response.text();if(text.length>2000000)throw Error('영상 목록이 너무 큽니다.');return text;
  })().then(text=>reply({ok:true,text}),e=>reply({ok:false,error:e.message}));
  return true;
});
