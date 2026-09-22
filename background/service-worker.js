/** Chzzk VS - 중계글 작성 전용 서비스 워커 */
importScripts('live-stream-fetch.js');
const DEFAULT_DESTINATION = {
  id: 'virtual_streamer',
  name: '버츄얼 스트리머 미니 갤러리',
  url: 'https://gall.dcinside.com/mini/board/lists/?id=virtual_streamer'
};

let offscreenCreating = null;
async function ensureWebpOffscreen() {
  if (!chrome.offscreen) return false;
  if (await chrome.offscreen.hasDocument()) return true;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['WORKERS'], justification: 'WebP 압축을 탭과 독립된 백그라운드에서 계속 처리합니다.'
    }).finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating; return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ENSURE_WEBP_OFFSCREEN') return false;
  ensureWebpOffscreen().then(ok => sendResponse({ ok })).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

function collectMediaUrls(value, results = [], keyHint = '') {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) results.push({ url: value.replace(/&amp;/g, '&'), key: keyHint });
    return results;
  }
  if (!value || typeof value !== 'object') return results;
  for (const [key, child] of Object.entries(value)) collectMediaUrls(child, results, key);
  return results;
}

function chooseClipVideoUrl(payload) {
  const adaptations = payload?.card?.content?.vod?.playback?.MPD?.flatMap(item => item?.Period || [])
    ?.flatMap(item => item?.AdaptationSet || []) || [];
  const progressive = adaptations.find(item => String(item?.['@mimeType'] || item?.mimeType || '').toLowerCase() === 'video/mp4');
  const representations = progressive?.Representation || [];
  const directBaseUrl = representations.flatMap(item => item?.BaseURL || []).find(url => typeof url === 'string' && /^https?:\/\//i.test(url));
  if (directBaseUrl) return directBaseUrl.replace(/&amp;/g, '&');
  const imagePattern = /\.(?:jpe?g|png|gif|webp)(?:\?|$)|thumbnail|image/i;
  const candidates = collectMediaUrls(payload)
    .filter(item => !imagePattern.test(item.url) && !imagePattern.test(item.key))
    .map(item => ({
      ...item,
      score: (/\.mp4(?:\?|$)/i.test(item.url) ? 100 : 0)
        + (/source|video|baseurl|playback/i.test(item.key) ? 30 : 0)
        + (/vod|video|stream/i.test(item.url) ? 10 : 0)
    }))
    .filter(item => item.score >= 30)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url || '';
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code && payload.code !== 200) throw new Error(payload.message || `API ${payload.code}`);
  return payload;
}

async function resolveChzzkClipMedia(clipId, pageUrl) {
  let info;
  try { info = await fetchJson(`https://api.chzzk.naver.com/service/v1/play-info/clip/${encodeURIComponent(clipId)}`); }
  catch (_) { info = await fetchJson(`https://api.chzzk.naver.com/service/v1/clips/${encodeURIComponent(clipId)}/detail`); }
  let content = info?.content || info;
  let mediaUrl = chooseClipVideoUrl(content);
  if (mediaUrl) return { url: mediaUrl, source: 'play-info' };

  if (!(content?.videoId || content?.video?.videoId || content?.content?.videoId)) {
    const detail = await fetchJson(`https://api.chzzk.naver.com/service/v1/clips/${encodeURIComponent(clipId)}/detail`);
    content = detail?.content || detail;
  }
  const videoId = content?.videoId || content?.video?.videoId || content?.content?.videoId;
  if (!videoId) throw new Error('클립 재생 정보에 videoId가 없습니다.');
  const params = new URLSearchParams({
    seedMediaId: String(videoId), seedType: 'SPECIFIC', serviceType: 'CHZZK',
    mediaType: 'VOD', panelType: 'sdk_chzzk', recType: 'CHZZK', referer: pageUrl || '',
    recId: content?.recId || JSON.stringify({ seedClipUID: clipId, fromType: 'GLOBAL', listType: 'RECOMMEND' }),
    enableReverse: 'false', adAllowed: 'Y', clickNsc: 'chzzk_url_clip', clickArea: 'clip_item', deviceType: 'html5_mo'
  });
  let lastError;
  for (const version of ['v9', 'v5']) {
    try {
      const hub = await fetchJson(`https://api-videohub.naver.com/shortformhub/feeds/${version}/card?${params}`);
      mediaUrl = chooseClipVideoUrl(hub);
      if (mediaUrl) return { url: mediaUrl, source: `videohub-${version}` };
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || '클립 원본 MP4 주소를 찾지 못했습니다.');
}

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.sync.get(['galleryDestinations', 'selectedGalleryUrl', 'showQuickWidget', 'showYoutubeQuickWidget']);
  const destinations = Array.isArray(saved.galleryDestinations) && saved.galleryDestinations.length
    ? saved.galleryDestinations : [DEFAULT_DESTINATION];
  await chrome.storage.sync.set({
    galleryDestinations: destinations,
    selectedGalleryUrl: saved.selectedGalleryUrl || destinations[0].url,
    showQuickWidget: saved.showQuickWidget !== false,
    showYoutubeQuickWidget: saved.showYoutubeQuickWidget !== false
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url?.startsWith('https://chzzk.naver.com/')) {
    const [chzzkTab] = await chrome.tabs.query({ url: 'https://chzzk.naver.com/*' });
    if (chzzkTab?.id) {
      await chrome.tabs.update(chzzkTab.id, { active: true });
      chrome.tabs.sendMessage(chzzkTab.id, { type: 'OPEN_GALLERY_DRAFT' });
      return;
    }
    const created = await chrome.tabs.create({ url: 'https://chzzk.naver.com/' });
    const listener = (tabId, info) => {
      if (tabId !== created.id || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.sendMessage(tabId, { type: 'OPEN_GALLERY_DRAFT' });
    };
    chrome.tabs.onUpdated.addListener(listener);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'OPEN_GALLERY_DRAFT' });
});

async function removePostedShelfItems(context) {
  const ids=new Set(context?.mediaShelfIds || []);if(!context?.submitArmed || !ids.size)return;
  const stored=await chrome.storage.local.get('liveShotMediaIndex');
  await chrome.storage.local.set({liveShotMediaIndex:(stored.liveShotMediaIndex || []).filter(item=>!ids.has(item.id))});
  await chrome.storage.local.remove([...ids].map(id=>'liveShotMedia:'+id));
}
const finishingPosts=new Set();
function isPostedView(url) {
  try { const parsed=new URL(url);return /(^|\.)dcinside\.com$/.test(parsed.hostname) && /\/(?:view|view\.php)(?:\/|$)/.test(parsed.pathname); } catch (_) { return false; }
}
async function finishPostedWindow(tabId, url) {
  if(!tabId || finishingPosts.has(tabId))return;
  let isPostList=false;
  try {const parsed=new URL(url);isPostList=/(^|\.)dcinside\.com$/.test(parsed.hostname)&&/\/(?:lists?|lists?\.php)(?:\/|$)/.test(parsed.pathname);}catch(_){return;}
  if(!isPostedView(url)&&!isPostList)return;
  finishingPosts.add(tabId);
  try {
    const key=`post_source_${tabId}`,stored=await chrome.storage.session.get(key),context=stored[key];
    if(!context?.submitArmed)return;
    // Storage cleanup or a disconnected source tab must not prevent closing.
    try { await removePostedShelfItems(context); } catch(error) { console.warn('[LiveShot] 임시저장 정리 실패',error); }
    if(context.sourceTabId){
      try { await chrome.tabs.sendMessage(context.sourceTabId,{type:'POST_STATUS',success:true}); } catch (_) {}
      try { const source=await chrome.tabs.get(context.sourceTabId);await chrome.tabs.update(source.id,{active:true});await chrome.windows.update(source.windowId,{focused:true}); } catch (_) {}
    }
    const target=await chrome.tabs.get(tabId).catch(()=>null);
    if(context.isPopup && target){
      const win=await chrome.windows.get(target.windowId);
      if(win.type==='popup')await chrome.windows.remove(win.id);
      else await chrome.tabs.remove(tabId);
    } else if(target)await chrome.tabs.remove(tabId);
    await chrome.storage.session.remove(key);
  } finally { finishingPosts.delete(tabId); }
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if(changeInfo.url || changeInfo.status==='complete')finishPostedWindow(tabId,changeInfo.url || tab.url).catch(error=>console.warn('[LiveShot] 등록 창 닫기 실패',error));
});

const postOpening=new Map();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'RESOLVE_CHZZK_CLIP') {
    resolveChzzkClipMedia(String(message.clipId || ''), String(message.pageUrl || ''))
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === 'CAPTURE_TAB') {
    try {
      chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' }, (dataUrl) => {
        sendResponse(chrome.runtime.lastError || !dataUrl
          ? { success: false, error: chrome.runtime.lastError?.message || '화면 캡처 실패' }
          : { success: true, dataUrl });
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message || '화면 캡처 권한 오류' });
    }
    return true;
  }

  if (message.type === 'INSTALL_YOUTUBE_CONFIRM' && sender.tab?.id) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        if (window.__chzzkYoutubeConfirmBridge) return;
        window.__chzzkYoutubeConfirmBridge = true;
        const originalConfirm = window.confirm;
        const youtubeConfirm = function(message) {
          const text = String(message || '').replace(/\s+/g, ' ');
          if (/유튜브\s*링크가\s*포함되어\s*있습니다/i.test(text) && /소스코드/i.test(text) && /변환하시겠습니까/i.test(text)) return true;
          return originalConfirm.apply(this, arguments);
        };
        window.confirm = youtubeConfirm;
        setTimeout(() => {
          if (window.confirm === youtubeConfirm) window.confirm = originalConfirm;
          delete window.__chzzkYoutubeConfirmBridge;
        }, 600000);
      }
    }).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'OPEN_URL') {
    const openKey=sender.tab?.id+':'+message.url;
    if(Date.now()-(postOpening.get(openKey)||0)<5000){sendResponse({success:false,error:'이미 글쓰기 창을 여는 중입니다.'});return;}
    postOpening.set(openKey,Date.now());
    let createdWindowId = null;
    const createTarget = message.popup
      ? chrome.windows.get(sender.tab.windowId).then(sourceWindow => {
          const width = 460;
          const height = 300;
          const left = Math.max(0, (sourceWindow.left || 0) + (sourceWindow.width || 1280) - width - 18);
          const top = Math.max(0, (sourceWindow.top || 0) + 72);
          return chrome.windows.create({ url: message.url, type: 'popup', width, height, left, top, focused: true });
        }).then(async win => {
          createdWindowId = win.id;
          return win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0];
        })
      : chrome.tabs.create({ url: message.url, active: message.active !== false });
    createTarget.then(async (created) => {
      if (sender.tab?.id && created?.id) {
        await chrome.storage.session.set({
          [`post_source_${created.id}`]: {
            sourceTabId: sender.tab.id,
            targetWindowId: createdWindowId || null,
            isPopup: Boolean(message.popup && createdWindowId)
          }
        });
      }
      sendResponse({ success: true, tabId: created?.id });
    }).catch(error=>{postOpening.delete(openKey);sendResponse({success:false,error:error.message});});
    return true;
  }

  if (message.type === 'POST_READY' || message.type === 'POST_CONFIRM_WAIT') {
    (async () => {
      if (message.type === 'POST_CONFIRM_WAIT' && sender.tab?.id) {
        const key = `post_source_${sender.tab.id}`;
        const stored = await chrome.storage.session.get(key);
        const current = stored[key];
        if (current && typeof current === 'object') {
          await chrome.storage.session.set({ [key]: { ...current, submitArmed: true, mediaShelfIds: Array.isArray(message.mediaShelfIds) ? message.mediaShelfIds.filter(id=>typeof id==='string') : [] } });
        }
      }
      if (sender.tab?.windowId) await chrome.windows.update(sender.tab.windowId, { focused: true });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'CANCEL_POST') {
    (async () => {
      const targetTabId = sender.tab?.id;
      if (!targetTabId) return;
      const key = `post_source_${targetTabId}`;
      const stored = await chrome.storage.session.get(key);
      const postContext = stored[key];
      const sourceTabId = typeof postContext === 'number' ? postContext : postContext?.sourceTabId;
      await chrome.storage.session.remove(key);
      if (postContext?.isPopup && postContext?.targetWindowId) {
        try { await chrome.windows.remove(postContext.targetWindowId); } catch (_) { }
      }
      if (sourceTabId) {
        try {
          const sourceTab = await chrome.tabs.get(sourceTabId);
          await chrome.tabs.update(sourceTab.id, { active: true });
          await chrome.windows.update(sourceTab.windowId, { focused: true });
          for (const delay of [0, 150, 500]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            try {
              const response = await chrome.tabs.sendMessage(sourceTab.id, { type: 'POST_CANCELLED_RESTORE' });
              if (response?.success) break;
            } catch (_) { }
          }
        } catch (_) { }
      }
    })();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESIZE_POST_WINDOW' && sender.tab?.windowId) {
    const expanded = message.mode === 'expanded';
    chrome.windows.update(sender.tab.windowId, expanded
      ? { width: 900, height: 700, focused: true }
      : { width: 460, height: 300, focused: true });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'POST_SUCCESS' || message.type === 'POST_NEEDS_ATTENTION') {
    if(message.type==='POST_SUCCESS'){
      finishPostedWindow(sender.tab?.id,sender.tab?.url || sender.url).catch(error=>console.warn('[LiveShot] 등록 창 닫기 실패',error));
      sendResponse({success:true});return;
    }
    (async () => {
      const targetTabId = sender.tab?.id;
      if (!targetTabId) return;
      const key = `post_source_${targetTabId}`;
      const stored = await chrome.storage.session.get(key);
      const postContext = stored[key];
      if (!postContext || typeof postContext !== 'object') return;
      if (message.type === 'POST_SUCCESS' && !postContext.submitArmed) return;
      const sourceTabId = typeof postContext === 'number' ? postContext : postContext?.sourceTabId;
      const targetWindowId = postContext?.isPopup ? postContext?.targetWindowId : null;
      if (sourceTabId) {
        chrome.tabs.sendMessage(sourceTabId, {
          type: 'POST_STATUS',
          success: message.type === 'POST_SUCCESS',
          reason: message.reason || ''
        });
      }
      if (message.type === 'POST_SUCCESS') {
        if (!postContext.submitArmed) return;
        const usedIds = new Set(postContext.mediaShelfIds || []);
        if (usedIds.size) {
          const data = await chrome.storage.local.get('liveShotMediaIndex');
          await chrome.storage.local.set({ liveShotMediaIndex: (data.liveShotMediaIndex || []).filter(item => !usedIds.has(item.id)) });
          await chrome.storage.local.remove([...usedIds].map(id => 'liveShotMedia:' + id));
        }
        await chrome.storage.session.remove(key);
        if (sourceTabId) {
          try {
            const sourceTab = await chrome.tabs.get(sourceTabId);
            await chrome.tabs.update(sourceTabId, { active: true });
            if (sourceTab.windowId) await chrome.windows.update(sourceTab.windowId, { focused: true });
          } catch (_) { }
        }
        if (targetWindowId) chrome.windows.remove(targetWindowId);
      } else {
        chrome.tabs.update(targetTabId, { active: true });
      }
    })();
    sendResponse({ success: true });
    return true;
  }

});
