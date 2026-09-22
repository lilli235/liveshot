/**
 * ============================================================================
 * [라이브샷] 캡처 및 중계글 작성
 * 
 * @file        content/features/gallery-draft.js
 * @description 디시인사이드 글 초안 작성 & 캡처 연동 화면 (Gallery Draft & Capture Engine)
 * @author      LiveShot
 * @version     1.0.0
 * @updated     2026-09-04
 * 
 * [화면 및 주요 기능 설명]
 * 1. 치지직 라이브 영상 즉시 캡처 후 갤러리 글 작성 모달 자동 호출
 * 2. 방송 제목, 스트리머 정보 기반 갤러리 글 제목/본문 템플릿 자동 구성
 * 3. 캡처 이미지 클립보드 복사 및 디시인사이드 글쓰기 페이지 원클릭 이동
 * 4. 연동 대상 갤러리 추가/관리 및 자동 폼 채우기(Auto-fill) 연계
 * ============================================================================
 */

window.ChzzkVS = window.ChzzkVS || {};

(function () {
  'use strict';

  const { UTILS, showToast } = ChzzkVS;

  // ─── 클립보드 PNG 이미지 복사 헬퍼 ───
  async function copyImageToClipboard(blobOrDataUrl) {
    try {
      let pngBlob = null;
      if (blobOrDataUrl instanceof Blob) {
        if (blobOrDataUrl.type === 'image/png') {
          pngBlob = blobOrDataUrl;
        } else {
          const img = new Image();
          const imageUrl = URL.createObjectURL(blobOrDataUrl);
          try {
            await new Promise((res, rej) => {
              img.onload = res;
              img.onerror = rej;
              img.src = imageUrl;
            });
          } finally {
            URL.revokeObjectURL(imageUrl);
          }
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          pngBlob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        }
      } else if (typeof blobOrDataUrl === 'string') {
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = blobOrDataUrl;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      }

      if (pngBlob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ]);
        console.log('[Chzzk VS] 클립보드 이미지 복사 성공 (PNG)');
        return true;
      }
    } catch (err) {
      console.warn('[Chzzk VS] 클립보드 이미지 복사 오류:', err);
    }
    return false;
  }

  // ─── Shadow DOM 재귀 탐색 포함 전체 비디오 탐색 ───
  function getAllVideosAcrossShadowRoots(root = document) {
    const videos = [];
    if (!root) return videos;

    try {
      if (root.querySelectorAll) {
        videos.push(...Array.from(root.querySelectorAll('video')));
      }

      const allElements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const el of allElements) {
        if (el.shadowRoot) {
          videos.push(...getAllVideosAcrossShadowRoots(el.shadowRoot));
        }
      }
    } catch (e) { }

    return Array.from(new Set(videos));
  }

  // ─── 활성 비디오 엘리먼트 정밀 탐색 엔진 ───
  function findMainVideoElement(preferredType) {
    const isClipMode = (preferredType === 'CLIP') || /^\/(?:clips?|video|shorts?)\//i.test(window.location.pathname);

    // 1단계: Shadow Root 포함 전체 비디오 요소 수집
    const allVideos = getAllVideosAcrossShadowRoots(document);

    if (/(^|\.)youtube\.com$/i.test(location.hostname) && /^\/shorts\//.test(location.pathname)) {
      const activeShort = document.querySelector('ytd-reel-video-renderer[is-active] video, ytd-reel-video-renderer[active] video, ytd-shorts[is-active] video');
      if (activeShort?.videoWidth && activeShort.getClientRects().length) return activeShort;
    }

    if (allVideos.length === 0) {
      const fallbackV = document.querySelector('video, [class*="webplayer"] video');
      if (fallbackV) return fallbackV;
      return null;
    }

    if (allVideos.length === 1) return allVideos[0];

    let bestVideo = null;
    let maxScore = -999999;

    for (const v of allVideos) {
      let score = 0;
      let rect = { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
      try {
        if (v.getBoundingClientRect) {
          rect = v.getBoundingClientRect();
        }
      } catch (e) { }

      const inViewport = (
        rect.width > 20 &&
        rect.height > 20 &&
        rect.top < (window.innerHeight || 1080) &&
        rect.bottom > 0 &&
        rect.left < (window.innerWidth || 1920) &&
        rect.right > 0
      );

      if (inViewport) {
        score += 5000;
        score += Math.min(20000, (rect.width * rect.height) / 50);
      }

      if (v.videoWidth > 100 && v.videoHeight > 100) {
        score += 3000;
      }
      if (v.readyState >= 2) {
        score += 1500;
      }
      if (!v.paused) {
        score += 1000;
      }
      if (v.currentTime > 0) {
        score += 800;
      }

      const className = (v.className || '') + ' ' + (v.parentElement?.className || '');
      if (className.includes('webplayer') || className.includes('pzp') || className.includes('player') || className.includes('clip')) {
        score += 4000;
      }

      if (v.closest && v.closest('[class*="clip"], [class*="viewer"], [class*="player"], [class*="pzp"], [class*="webplayer"], main')) {
        score += 4000;
      }

      // 사이드바 / 추천 영상 목록 / 썸네일 미리보기 내부일 때 감점
      if (v.closest && v.closest('[class*="aside"], [class*="sidebar"], [class*="recommend"], [class*="list"], [class*="thumbnail"], [class*="preview"], [class*="guide"]')) {
        score -= 8000;
      }

      if (score > maxScore) {
        maxScore = score;
        bestVideo = v;
      }
    }

    return bestVideo || allVideos[0];
  }

  // ─── 비디오 화면 캡쳐 헬퍼 (클립 & 라이브 고화질 전용 캡쳐 엔진) ───
  async function captureVideoFrame(preferredType) {
    const isClipMode = (preferredType === 'CLIP') || /^\/(?:clips?|video|shorts?)\//i.test(window.location.pathname);
    const isDirectClipPage = /^\/(?:clips?|shorts?)\//i.test(window.location.pathname);

    // 클립 페이지의 DOM에는 실제 영상 대신 화면 레이어만 노출되는 경우가 있으므로
    // 전체 탭 캡처로 대체하지 않고 videohub 원본 MP4에서 현재 프레임을 가져옵니다.
    if (isDirectClipPage) {
      let clipVideo;
      try {
        clipVideo = await createClipSourceVideo();
        const pageVideo = getAllVideosAcrossShadowRoots(document)
          .filter(item => !item.dataset?.chzzkVsClipSource)
          .sort((a, b) => ((b.videoWidth || b.clientWidth) * (b.videoHeight || b.clientHeight)) - ((a.videoWidth || a.clientWidth) * (a.videoHeight || a.clientHeight)))[0];
        const desiredTime = Number.isFinite(pageVideo?.currentTime) ? pageVideo.currentTime : 0;
        if (desiredTime > 0.02) await waitForVideoSeek(clipVideo, Math.min(Math.max(0, desiredTime), Math.max(0, clipVideo.duration - 0.05)));
        const canvas = document.createElement('canvas'); canvas.width = clipVideo.videoWidth; canvas.height = clipVideo.videoHeight;
        const context = canvas.getContext('2d'); context.drawImage(clipVideo, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const dataUrl = canvas.toDataURL('image/png');
        if (!blob || dataUrl.length < 5000) throw new Error('클립 원본 프레임이 비어 있습니다.');
        return { dataUrl, blob, width: canvas.width, height: canvas.height };
      } finally {
        if (clipVideo) { clipVideo.pause(); clipVideo.removeAttribute('src'); clipVideo.load(); clipVideo.remove(); }
      }
    }

    // 1. 영상 엘리먼트 정밀 탐색 (Shadow Root 포함)
    const video = findMainVideoElement(preferredType) ||
      document.querySelector('.webplayer-internal-video, video') ||
      getAllVideosAcrossShadowRoots(document)[0];

    // 1단계: Canvas 직접 캡쳐 시도 (100% 원본 픽셀, UI 없음)
    if (video) {
      const w = video.videoWidth || video.clientWidth || 1280;
      const h = video.videoHeight || video.clientHeight || 720;
      if (w > 50 && h > 50) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);

          const dataUrl = canvas.toDataURL('image/png');
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (dataUrl && dataUrl.length > 5000) {
            console.log(`[Chzzk VS] 비디오 프레임 Canvas 직접 캡쳐 성공 (${w}x${h})`);
            return { dataUrl, blob, width: w, height: h };
          }
        } catch (corsErr) {
          console.warn('[Chzzk VS] Canvas 직접 캡쳐 실패 (CORS 등), 정밀 크롭 탭 캡쳐로 전환:', corsErr);
        }
      }
    }

    // 2단계: 백그라운드 captureVisibleTab + 비디오 영역 정밀 크롭 (UI 오버레이 및 외곽 버튼 100% 제거)
    const hideOverlayStyle = document.createElement('style');
    hideOverlayStyle.id = 'chzzk-vs-temp-hide';
    hideOverlayStyle.textContent = `
      [class*="ControlAreaView"],
      [class*="touch_wrap"],
      [class*="btn_play"],
      [class*="control_area"],
      [class*="pzp-pc__control"],
      [class*="pzp-pc__bottom"],
      [class*="pzp-pc__top"],
      [class*="pzp-ui-dim"],
      [class*="tooltip"] {
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(hideOverlayStyle);

    try {
      await new Promise(r => setTimeout(r, 20));

      const response = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, error: '캡처 응답 시간 초과' }), 4000);
        chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: '빈 캡처 응답' });
          }
        });
      });

      if (response && response.success && response.dataUrl) {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = response.dataUrl;
        });

        const scaleX = img.naturalWidth / window.innerWidth;
        const scaleY = img.naturalHeight / window.innerHeight;

        const targetVideoEl = video || document.querySelector('.webplayer-internal-video, video') || getAllVideosAcrossShadowRoots(document)[0];
        const sourceWrapper = document.querySelector('.webplayer-internal-source-wrapper, .webplayer-internal-source-shadow, [class*="webplayer-internal-source"], .pzp-pc');

        const rectTarget = targetVideoEl || sourceWrapper;
        let rect = null;

        if (rectTarget && rectTarget.getBoundingClientRect) {
          const r = rectTarget.getBoundingClientRect();
          if (r.width > 50 && r.height > 50) {
            rect = r;
          }
        }

        if (!rect) {
          const fallbackSelectors = [
            'iframe[src*="shorts"]',
            'iframe[src*="media"]',
            'iframe[src*="player"]',
            'iframe',
            '[class*="ControlAreaView"][class*="touch_wrap"]',
            '[class*="ControlAreaView"]',
            '.webplayer-internal-source-wrapper',
            '.webplayer-internal-video',
            '.pzp-pc',
            '[class*="desktop-media-viewer"] [class*="player"]',
            '[class*="desktop-media-viewer"] [class*="content"]',
            '[class*="desktop-media-viewer"]',
            '[class*="clip_player"]',
            '[class*="vod_player"]',
            '[class*="player_container"]',
            '[class*="webplayer"]',
            '[class*="player_area"]',
            '[class*="_clip_"]'
          ];
          for (const sel of fallbackSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const r = el.getBoundingClientRect();
              if (r.width > 50 && r.height > 50) {
                rect = r;
                break;
              }
            }
          }
        }

        if (!rect || rect.width <= 50 || rect.height <= 50) {
          const sidebar = document.querySelector('aside, [class*="sidebar"]');
          const header = document.querySelector('header, [class*="header"]');
          const sidebarRight = sidebar ? Math.max(0, sidebar.getBoundingClientRect().right) : 0;
          const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 60;

          rect = {
            left: sidebarRight,
            top: headerBottom,
            width: Math.max(200, window.innerWidth - sidebarRight),
            height: Math.max(200, window.innerHeight - headerBottom)
          };
        }

        let activeLeft = rect.left;
        let activeTop = rect.top;
        let activeWidth = rect.width;
        let activeHeight = rect.height;

        if (targetVideoEl && targetVideoEl.videoWidth > 0 && targetVideoEl.videoHeight > 0) {
          const vRatio = targetVideoEl.videoWidth / targetVideoEl.videoHeight;
          const bRatio = rect.width / rect.height;

          if (bRatio > vRatio + 0.005) {
            const computedWidth = rect.height * vRatio;
            activeLeft = rect.left + (rect.width - computedWidth) / 2;
            activeWidth = computedWidth;
          } else if (bRatio < vRatio - 0.005) {
            const computedHeight = rect.width / vRatio;
            activeTop = rect.top + (rect.height - computedHeight) / 2;
            activeHeight = computedHeight;
          }
        }

        const sx = Math.max(0, Math.round(activeLeft * scaleX));
        const sy = Math.max(0, Math.round(activeTop * scaleY));
        const sw = Math.min(img.naturalWidth - sx, Math.round(activeWidth * scaleX));
        const sh = Math.min(img.naturalHeight - sy, Math.round(activeHeight * scaleY));

        if (sw > 30 && sh > 30) {
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = sw;
          cropCanvas.height = sh;
          const cropCtx = cropCanvas.getContext('2d');
          cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

          const croppedDataUrl = cropCanvas.toDataURL('image/png');
          const croppedBlob = await new Promise((resolve) => cropCanvas.toBlob(resolve, 'image/png'));

          console.log(`[Chzzk VS] 비디오 영상 화면 정밀 크롭 캡쳐 성공 (${Math.round(sw)}x${Math.round(sh)})`);
          return {
            dataUrl: croppedDataUrl,
            blob: croppedBlob,
            width: Math.round(cropCanvas.width),
            height: Math.round(cropCanvas.height)
          };
        }
      }
    } catch (bgErr) {
      console.warn('[Chzzk VS] 백그라운드 크롭 캡쳐 오류:', bgErr);
    } finally {
      if (document.getElementById('chzzk-vs-temp-hide')) {
        document.getElementById('chzzk-vs-temp-hide').remove();
      }
    }

    throw new Error('클립/라이브 화면 캡쳐에 실패했습니다.');
  }

  // 최근 라이브 화면을 JPEG 프레임으로 순환 보관합니다. 원본 HLS의
  // seekable 구간과 달리 편집기를 여는 순간 복사본을 만들 수 있습니다.
  const rollingFrameCache = (() => {
    const frames = [];
    const stillFrames = [];
    const slots = Array.from({ length: 8 }, () => {
      const canvas = document.createElement('canvas');
      return { canvas, context: canvas.getContext('2d', { alpha: false }), busy: false };
    });
    const stillSlots = Array.from({ length: 2 }, () => {
      const canvas = document.createElement('canvas');
      return { canvas, context: canvas.getContext('2d', { alpha: false }), busy: false };
    });
    let activeVideo = null;
    let callbackId = null;
    let lastCapturedAt = 0;
    let lastStillCapturedAt = 0;
    const maxAgeMs = 45000;
    const stillMaxAgeMs = 15000;
    const intervalMs = 1000 / 30;
    const stillIntervalMs = 500;

    const trim = now => {
      while (frames.length && now - frames[0].time > maxAgeMs) frames.shift();
      while (stillFrames.length && now - stillFrames[0].time > stillMaxAgeMs) stillFrames.shift();
    };
    const capture = (now, metadata) => {
      if (!activeVideo?.isConnected) { activeVideo = null; callbackId = null; return; }
      const capturedVideo = activeVideo;
      callbackId = activeVideo.requestVideoFrameCallback(capture);
      if (activeVideo.readyState < 2 || !activeVideo.videoWidth) return;
      if (location.hostname === 'chzzk.naver.com' && /^\/live\//.test(location.pathname) && globalThis.LiveShotLiveStream) { frames.length = 0; stillFrames.length = 0; return; }
      if (now - lastStillCapturedAt >= stillIntervalMs) {
        const stillSlot = stillSlots.find(item => !item.busy);
        if (stillSlot) {
          lastStillCapturedAt = now;
          const stillWidth = activeVideo.videoWidth; const stillHeight = activeVideo.videoHeight;
          if (stillSlot.canvas.width !== stillWidth || stillSlot.canvas.height !== stillHeight) { stillSlot.canvas.width = stillWidth; stillSlot.canvas.height = stillHeight; }
          try {
            stillSlot.context.drawImage(activeVideo, 0, 0, stillWidth, stillHeight); stillSlot.busy = true;
            const stillTime = now;
            stillSlot.canvas.toBlob(blob => {
              stillSlot.busy = false; if (!blob || activeVideo !== capturedVideo) return;
              const item = { blob, time: stillTime, mediaTime: metadata?.mediaTime || activeVideo?.currentTime || 0, width: stillWidth, height: stillHeight };
              const insertAt = stillFrames.findIndex(frame => frame.time > stillTime);
              if (insertAt < 0) stillFrames.push(item); else stillFrames.splice(insertAt, 0, item);
              trim(performance.now());
            }, 'image/jpeg', .98);
          } catch (_) { stillSlot.busy = false; }
        }
      }
      const isChzzkLive = location.hostname === 'chzzk.naver.com' && /^\/live\//.test(window.location.pathname);
      if (isChzzkLive && globalThis.LiveShotLiveStream) return;
      const youtubePlayer = activeVideo.closest('.html5-video-player');
      const liveBadge = youtubePlayer?.querySelector('.ytp-live-badge');
      const isYouTubeLivePage = /(^|\.)youtube\.com$/i.test(location.hostname) && (!Number.isFinite(activeVideo.duration) || youtubePlayer?.classList.contains('ytp-live') || Boolean(liveBadge && liveBadge.getClientRects().length));
      const isYouTubeLive = isYouTubeLivePage;
      if ((!isChzzkLive && !isYouTubeLive) || now - lastCapturedAt < intervalMs) return;
      const slot = slots.find(item => !item.busy);
      if (!slot) return;
      lastCapturedAt = now;
      const width = activeVideo.videoWidth;
      const height = Math.max(2, Math.round(width * activeVideo.videoHeight / activeVideo.videoWidth));
      if (slot.canvas.width !== width || slot.canvas.height !== height) { slot.canvas.width = width; slot.canvas.height = height; }
      try { slot.context.drawImage(activeVideo, 0, 0, width, height); } catch (_) { return; }
      slot.busy = true;
      const capturedAt = now;
      try {
        slot.canvas.toBlob(blob => {
          slot.busy = false;
          if (!blob || activeVideo !== capturedVideo) return;
          const item = { blob, time: capturedAt, mediaTime: metadata?.mediaTime || activeVideo?.currentTime || 0, width, height };
          const insertAt = frames.findIndex(frame => frame.time > capturedAt);
          if (insertAt < 0) frames.push(item); else frames.splice(insertAt, 0, item);
          trim(performance.now());
        }, 'image/jpeg', .92);
      } catch (_) { slot.busy = false; }
    };
    const attach = video => {
      if (!video || video === activeVideo || typeof video.requestVideoFrameCallback !== 'function') return;
      if (activeVideo && callbackId !== null && typeof activeVideo.cancelVideoFrameCallback === 'function') activeVideo.cancelVideoFrameCallback(callbackId);
      if (activeVideo && video !== activeVideo) { frames.splice(0, frames.length); stillFrames.splice(0, stillFrames.length); }
      activeVideo = video; lastCapturedAt = 0; lastStillCapturedAt = 0; callbackId = video.requestVideoFrameCallback(capture);
    };
    const ensure = () => {
      const isYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);
      const supportedRoute = isYouTube ? /^\/(?:watch|live|shorts)(?:\/|$)/.test(window.location.pathname) : /^\/(?:live|video|clips?|shorts?)\//.test(window.location.pathname);
      if (!supportedRoute) {
        if (activeVideo && callbackId !== null && typeof activeVideo.cancelVideoFrameCallback === 'function') activeVideo.cancelVideoFrameCallback(callbackId);
        activeVideo = null; callbackId = null; frames.splice(0, frames.length); stillFrames.splice(0, stillFrames.length);
        return;
      }
      attach(findMainVideoElement(/^\/live\//.test(window.location.pathname) ? 'LIVE' : 'CLIP'));
    };
    const watcher = setInterval(ensure, 1500);
    ensure();
    return {
      snapshot() { trim(performance.now()); return frames.slice(); },
      stillSnapshot() { trim(performance.now()); return stillFrames.slice(); },
      ensure,
      stop() {
        clearInterval(watcher);
        if (activeVideo && callbackId !== null) activeVideo.cancelVideoFrameCallback?.(callbackId);
        activeVideo = null; callbackId = null;
        frames.splice(0, frames.length); stillFrames.splice(0, stillFrames.length);
      }
    };
  })();

  // A capture owns its editor settings. Reloading the page naturally clears this map.
  const webpEditorSessionSettings = new Map();
  const webpResultEditorSettings = new WeakMap();

  const waitForVideoSeek = (video, time) => new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.015 && !video.seeking) {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      return;
    }
    let settled = false;
    let seeked = false;
    let framePresented = typeof video.requestVideoFrameCallback !== 'function';
    let frameCallbackId = null;
    let paintFallbackTimer = null;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(paintFallbackTimer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', fail);
      if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(frameCallbackId);
    };
    const finishIfReady = () => {
      if (settled || !seeked || !framePresented) return;
      settled = true; cleanup();
      // Give the compositor one paint turn before Canvas reads the video.
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    };
    const onSeeked = () => {
      seeked = true;
      finishIfReady();
      // Paused clip/replay videos often stop delivering video-frame callbacks.
      // A short paint fallback avoids waiting for the full 5-second timeout for
      // every extracted frame while still allowing the sought frame to decode.
      if (!framePresented) paintFallbackTimer = setTimeout(() => { framePresented = true; finishIfReady(); }, 300);
    };
    const onFrame = () => { framePresented = true; frameCallbackId = null; finishIfReady(); };
    const fail = () => { if (settled) return; settled = true; cleanup(); reject(new Error('영상 구간을 불러오지 못했습니다.')); };
    const timer = setTimeout(() => {
      // Some HLS players do not fire requestVideoFrameCallback while paused.
      // A completed seek is still usable after two paint turns.
      if (seeked) { framePresented = true; finishIfReady(); } else fail();
    }, 5000);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', fail, { once: true });
    if (typeof video.requestVideoFrameCallback === 'function') frameCallbackId = video.requestVideoFrameCallback(onFrame);
    video.currentTime = time;
    if (Math.abs(video.currentTime - time) < 0.015) onSeeked();
  });

  function getLiveSeekRange(video) {
    if (!video?.seekable?.length) return null;
    const index = video.seekable.length - 1;
    return { start: video.seekable.start(index), end: video.seekable.end(index) };
  }

  function canUseYouTubeDvr() {
    try {
      const state = JSON.parse(document.documentElement.dataset.chzzkVsYoutubePlayerState || '{}');
      if (typeof state.allowLiveDvr === 'boolean') return state.allowLiveDvr;
    } catch (_) {}
    return false;
  }

  async function createClipSourceVideo() {
    const clipId = window.location.pathname.match(/^\/(?:clips?|shorts?)\/([^/?#]+)/i)?.[1];
    if (!clipId) throw new Error('주소에서 클립 ID를 찾지 못했습니다.');
    const resolved = await chrome.runtime.sendMessage({ type: 'RESOLVE_CHZZK_CLIP', clipId, pageUrl: window.location.href });
    if (!resolved?.success || !resolved.url) throw new Error(resolved?.error || '클립 원본 주소를 찾지 못했습니다.');
    const video = document.createElement('video');
    video.dataset.chzzkVsClipSource = 'true';
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'auto';
    Object.assign(video.style, { position: 'fixed', width: '2px', height: '2px', left: '-10000px', top: '-10000px', opacity: '0', pointerEvents: 'none' });
    document.documentElement.appendChild(video);
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('클립 원본 영상 로딩 시간이 초과되었습니다.')), 15000);
      const finish = callback => event => { clearTimeout(timer); video.removeEventListener('loadeddata', onLoaded); video.removeEventListener('error', onError); callback(event); };
      const onLoaded = finish(resolve); const onError = finish(() => reject(new Error('클립 원본 영상을 불러오지 못했습니다.')));
      video.addEventListener('loadeddata', onLoaded); video.addEventListener('error', onError);
    });
    video.src = resolved.url; video.load();
    try {
      await loaded;
      const probe = document.createElement('canvas'); probe.width = 2; probe.height = 2;
      const probeContext = probe.getContext('2d'); probeContext.drawImage(video, 0, 0, 2, 2); probeContext.getImageData(0, 0, 1, 1);
      return video;
    } catch (error) { video.removeAttribute('src'); video.load(); video.remove(); throw error; }
  }

  async function createReplaySourceVideo() {
    const pageVideo = findMainVideoElement('CLIP');
    const desiredTime = Number.isFinite(pageVideo?.currentTime) ? pageVideo.currentTime : 0;
    const frame = document.createElement('iframe');
    frame.dataset.chzzkVsReplaySource = 'true'; frame.src = window.location.href;
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    Object.assign(frame.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '720px', opacity: '0', pointerEvents: 'none', border: '0', zIndex: '-2147483647' });
    document.documentElement.appendChild(frame);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('독립 다시보기 화면 로딩 시간이 초과되었습니다.')), 20000);
        frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        frame.addEventListener('error', () => { clearTimeout(timer); reject(new Error('독립 다시보기 화면을 열지 못했습니다.')); }, { once: true });
      });
      const deadline = Date.now() + 20000; let video = null;
      while (Date.now() < deadline) {
        const doc = frame.contentDocument;
        if (doc) {
          const candidates = getAllVideosAcrossShadowRoots(doc).filter(item => item.videoWidth || item.readyState);
          candidates.sort((a, b) => ((b.videoWidth || b.clientWidth) * (b.videoHeight || b.clientHeight)) - ((a.videoWidth || a.clientWidth) * (a.videoHeight || a.clientHeight)));
          video = candidates[0] || null;
        }
        if (video) {
          video.muted = true; video.play().catch(() => {});
          if (video.readyState >= 2 && video.videoWidth && (video.seekable?.length || Number.isFinite(video.duration))) break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!video || video.readyState < 2 || !video.videoWidth) throw new Error('독립 다시보기 영상을 찾지 못했습니다.');
      video.muted = true; video.pause();
      const seekable = getLiveSeekRange(video); const end = seekable?.end || video.duration || 0;
      if (desiredTime > 0 && end > 0) await waitForVideoSeek(video, Math.max(seekable?.start || 0, Math.min(end - .05, desiredTime)));
      return { video, frame };
    } catch (error) { frame.remove(); throw error; }
  }

  async function createYouTubeSourceVideo() {
    const pageVideo = findMainVideoElement('CLIP');
    const desiredTime = Number.isFinite(pageVideo?.currentTime) ? pageVideo.currentTime : 0;
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/^\/(?:live|shorts|embed)\/([a-zA-Z0-9_-]{11})/);
    const videoId = url.searchParams.get('v') || pathMatch?.[1] || '';
    if (!videoId) throw new Error('주소에서 유튜브 영상 ID를 찾지 못했습니다.');
    // Reuse the signed media URL that the active YouTube player already
    // requested. This avoids iframe DOM isolation and never seeks the visible
    // player. Resource names remain available even without timing details.
    const mediaCandidates = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /googlevideo\.com\/videoplayback/i.test(name))
      .map(name => {
        try {
          const mediaUrl = new URL(name);
          if (!/^video\//i.test(mediaUrl.searchParams.get('mime') || '')) return null;
          ['range', 'rn', 'rbuf', 'alr'].forEach(key => mediaUrl.searchParams.delete(key));
          const height = Number(mediaUrl.searchParams.get('height')) || 0;
          const itag = Number(mediaUrl.searchParams.get('itag')) || 0;
          const knownHeight = ({ 160: 144, 133: 240, 134: 360, 135: 480, 136: 720, 137: 1080, 298: 720, 299: 1080, 399: 1080, 398: 720 })[itag] || 0;
          return { url: mediaUrl.href, score: Math.max(height, knownHeight), itag };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const uniqueCandidates = [...new Map(mediaCandidates.map(item => [item.itag || item.url, item])).values()].slice(0, 4);
    for (const candidate of uniqueCandidates) {
      const holder = document.createElement('div');
      const mediaVideo = document.createElement('video');
      mediaVideo.crossOrigin = 'anonymous'; mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'auto';
      Object.assign(holder.style, { position: 'fixed', left: '0', bottom: '0', width: '4px', height: '3px', opacity: '.01', overflow: 'hidden', pointerEvents: 'none', zIndex: '0' });
      holder.appendChild(mediaVideo); document.documentElement.appendChild(holder);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('원본 미디어 응답 시간 초과')), 10000);
          const finish = callback => () => { clearTimeout(timer); callback(); };
          mediaVideo.addEventListener('loadeddata', finish(resolve), { once: true });
          mediaVideo.addEventListener('error', finish(() => reject(new Error('원본 미디어 로딩 실패'))), { once: true });
          mediaVideo.src = candidate.url; mediaVideo.load(); mediaVideo.play().catch(() => {});
        });
        if (mediaVideo.videoWidth && mediaVideo.readyState >= 2) {
          mediaVideo.pause();
          const seekable = getLiveSeekRange(mediaVideo); const end = seekable?.end || mediaVideo.duration || 0;
          if (desiredTime > 0 && end > 0) await waitForVideoSeek(mediaVideo, Math.max(seekable?.start || 0, Math.min(end - .05, desiredTime)));
          return { video: mediaVideo, frame: holder };
        }
      } catch (_) { /* Try another active quality URL, then iframe fallback. */ }
      mediaVideo.pause(); mediaVideo.removeAttribute('src'); mediaVideo.load(); holder.remove();
    }
    const frame = document.createElement('iframe');
    frame.dataset.chzzkVsYoutubeSource = 'true';
    frame.src = `${url.origin}/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(url.origin)}&start=${Math.max(0, Math.floor(desiredTime))}`;
    frame.allow = 'autoplay; encrypted-media'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    // YouTube suspends media initialization in fully transparent/off-screen
    // frames. Keep a tiny composited surface without intercepting input.
    Object.assign(frame.style, { position: 'fixed', left: '0', bottom: '0', width: '1280px', height: '720px', transform: 'scale(.0025)', transformOrigin: 'left bottom', opacity: '.01', pointerEvents: 'none', border: '0', zIndex: '0' });
    document.documentElement.appendChild(frame);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('독립 유튜브 플레이어 로딩 시간이 초과되었습니다.')), 30000);
        frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        frame.addEventListener('error', () => { clearTimeout(timer); reject(new Error('독립 유튜브 플레이어를 열지 못했습니다.')); }, { once: true });
      });
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
      const deadline = Date.now() + 30000; let video = null;
      while (Date.now() < deadline) {
        const doc = frame.contentDocument;
        if (doc) video = doc.querySelector('video.html5-main-video, #movie_player video, video');
        if (video) {
          video.muted = true; video.play().catch(() => {});
          if (video.readyState >= 2 && video.videoWidth && (video.seekable?.length || Number.isFinite(video.duration))) break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!video || video.readyState < 2 || !video.videoWidth) throw new Error('독립 유튜브 영상 데이터를 찾지 못했습니다.');
      video.muted = true; video.pause();
      const seekable = getLiveSeekRange(video); const end = seekable?.end || video.duration || 0;
      if (desiredTime > 0 && end > 0) await waitForVideoSeek(video, Math.max(seekable?.start || 0, Math.min(end - .05, desiredTime)));
      return { video, frame };
    } catch (error) { frame.remove(); throw error; }
  }

  async function openStillImageEditor(source, onComplete) {
    if (!source?.dataUrl) return;
    document.getElementById('chzzk-webp-editor')?.remove();
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source.dataUrl; });
    const editor = document.createElement('div'); editor.id = 'chzzk-webp-editor';
    editor.innerHTML = `<div class="chzzk-webp-dialog chzzk-still-editor" role="dialog" aria-modal="true"><div class="chzzk-webp-head"><strong>캡처 편집</strong><div class="chzzk-webp-head-actions"><button type="button" data-still-close>×</button></div></div><div class="chzzk-still-tools"><button type="button" data-still-tool="crop">자르기</button><button type="button" data-still-pen-trigger>펜 ▾</button><button type="button" data-still-eraser-trigger>지우개 ▾</button><button type="button" data-still-cleanup>배경 제거 ▾</button><button type="button" data-still-shapes>도형 ▾</button><button type="button" data-still-undo title="실행 취소">↶</button><button type="button" data-still-redo title="다시 실행">↷</button><input type="color" data-still-color value="#ff425c" title="색상"><label class="chzzk-still-size">크기 <input type="range" data-still-size min="2" max="40" value="8"><output data-still-size-value>8</output></label><span class="chzzk-still-popover" data-still-pen-list hidden><button type="button" data-still-tool="pen">펜</button><button type="button" data-still-tool="highlighter">형광펜</button></span><span class="chzzk-still-popover" data-still-eraser-list hidden><button type="button" data-still-tool="eraser">지우개</button><button type="button" data-still-clear>모든 마크업 지우기</button></span><span class="chzzk-still-popover" data-still-cleanup-list hidden><button type="button" data-still-tool="background-remove">자동 배경 제거</button><button type="button" data-still-tool="background-eraser">브러시 지우기</button></span><span class="chzzk-still-shapes" data-still-shape-list hidden><button type="button" data-still-tool="line">선</button><button type="button" data-still-tool="arrow">화살표</button><button type="button" data-still-tool="rect">사각형</button><button type="button" data-still-tool="ellipse">원</button><label><input type="checkbox" data-still-fill> 채우기</label><b>이모지</b>${['😀','😂','❤️','🔥','👍','✨'].map(value => `<button type="button" data-still-emoji="${value}">${value}</button>`).join('')}</span><span class="chzzk-still-crop-actions" data-still-crop-actions hidden><button type="button" data-still-crop-cancel>자르기 취소</button><button type="button" class="active" data-still-crop-apply>자르기 적용</button></span></div><div class="chzzk-webp-preview-wrap"><div class="chzzk-webp-preview-stage"><canvas data-still-canvas></canvas><canvas class="chzzk-still-ink" data-still-ink></canvas><div class="chzzk-webp-crop" data-still-crop hidden><i data-handle="nw"></i><i data-handle="ne"></i><i data-handle="sw"></i><i data-handle="se"></i></div><div class="chzzk-still-emoji-box" data-still-emoji-box hidden><i data-emoji-resize></i></div></div></div><div class="chzzk-webp-crop-resolution" data-still-resolution hidden></div><div class="chzzk-still-mask-tools" data-still-mask-tools hidden><button type="button" class="active" data-still-mask-mode="restore">보호 브러시</button><button type="button" data-still-mask-mode="remove">제거 브러시</button><label>크기 <input type="range" min="4" max="80" value="32" data-still-mask-size></label></div><div class="chzzk-webp-actions"><button type="button" data-still-cancel>취소</button><button type="button" class="primary" data-still-apply>적용</button></div></div>`;
    document.body.appendChild(editor);
    const canvas = editor.querySelector('[data-still-canvas]'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0);
    canvas.parentElement.style.setProperty('--webp-video-ratio', `${canvas.width} / ${canvas.height}`); canvas.parentElement.style.setProperty('--webp-max-width', `${52 * canvas.width / canvas.height}vh`);
    const ink = editor.querySelector('[data-still-ink]'); ink.width = canvas.width; ink.height = canvas.height; const inkContext = ink.getContext('2d');
    let baseDataUrl = source.dataUrl; let history = []; let future = [];
    const box = editor.querySelector('[data-still-crop]'); const resolution = editor.querySelector('[data-still-resolution]');
    const cropActions = editor.querySelector('[data-still-crop-actions]');
    const maskTools = editor.querySelector('[data-still-mask-tools]');
    const maskUndo = []; const maskRedo = []; let maskColorMode = false;
    const zoomStage = canvas.parentElement; const zoomViewport = zoomStage.parentElement;
    let maskZoom = 1; let zoomBaseWidth = 0;
    const resetMaskZoom = () => { maskZoom = 1; zoomStage.style.removeProperty('width'); zoomStage.style.removeProperty('flex'); zoomViewport.style.removeProperty('height'); zoomViewport.style.removeProperty('overflow'); zoomViewport.style.removeProperty('display'); zoomViewport.scrollLeft = 0; zoomViewport.scrollTop = 0; };
    zoomViewport.addEventListener('wheel', event => {
      if (!['background-mask-restore','background-mask-remove'].includes(tool) || drawing) return;
      event.preventDefault();
      const bounds = zoomViewport.getBoundingClientRect();
      if (maskZoom === 1) { zoomBaseWidth = zoomStage.getBoundingClientRect().width; zoomViewport.style.height = `${zoomViewport.clientHeight}px`; }
      const next = Math.max(1, Math.min(5, maskZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const ratio = next / maskZoom; const x = event.clientX - bounds.left; const y = event.clientY - bounds.top;
      const left = (zoomViewport.scrollLeft + x) * ratio - x; const top = (zoomViewport.scrollTop + y) * ratio - y;
      maskZoom = next; zoomViewport.style.overflow = 'auto'; zoomViewport.style.display = 'block'; zoomStage.style.flex = 'none'; zoomStage.style.width = `${zoomBaseWidth * next}px`; zoomViewport.scrollLeft = left; zoomViewport.scrollTop = top;
      if (next === 1) resetMaskZoom();
    }, { passive: false });
    const zoomToolObserver = new MutationObserver(() => { if (!['background-mask-restore','background-mask-remove'].includes(editor.dataset.stillTool)) resetMaskZoom(); });
    zoomToolObserver.observe(editor, { attributes: true, attributeFilter: ['data-still-tool'] });
    maskTools.insertAdjacentHTML('beforeend', '<button type="button" data-mask-color title="클릭한 곳에 연결된 비슷한 색만 제거">색상 제거</button><label>허용 범위 <input type="range" min="5" max="80" value="20" data-mask-tolerance></label><button type="button" data-mask-undo disabled title="실행 취소">↶</button><button type="button" data-mask-redo disabled title="다시 실행">↷</button>');
    const maskPixels = () => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const syncMaskHistory = () => { maskTools.querySelector('[data-mask-undo]').disabled = !maskUndo.length; maskTools.querySelector('[data-mask-redo]').disabled = !maskRedo.length; };
    const rememberMask = () => { maskUndo.push(maskPixels()); if (maskUndo.length > 12) maskUndo.shift(); maskRedo.length = 0; syncMaskHistory(); };
    maskTools.querySelector('[data-mask-undo]').addEventListener('click', () => { if (!maskUndo.length || drawing) return; maskRedo.push(maskPixels()); canvas.getContext('2d').putImageData(maskUndo.pop(), 0, 0); syncMaskHistory(); });
    maskTools.querySelector('[data-mask-redo]').addEventListener('click', () => { if (!maskRedo.length || drawing) return; maskUndo.push(maskPixels()); canvas.getContext('2d').putImageData(maskRedo.pop(), 0, 0); syncMaskHistory(); });
    maskTools.querySelector('[data-mask-color]').addEventListener('click', () => { setTool('background-mask-remove'); maskColorMode = true; maskTools.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.hasAttribute('data-mask-color'))); });
    maskTools.querySelectorAll('[data-still-mask-mode]').forEach(button => button.addEventListener('click', () => { maskColorMode = false; }));
    const eraseMaskColor = point => {
      const image = maskPixels(); const { data, width, height } = image;
      const seed = Math.min(height - 1, Math.floor(point.y)) * width + Math.min(width - 1, Math.floor(point.x));
      if (!data[seed * 4 + 3]) return;
      const tolerance = Number(maskTools.querySelector('[data-mask-tolerance]').value);
      const r = data[seed * 4], g = data[seed * 4 + 1], b = data[seed * 4 + 2];
      const visited = new Uint8Array(width * height); const queue = new Int32Array(width * height); let head = 0, tail = 0;
      const add = index => { if (index < 0 || index >= visited.length || visited[index]) return; visited[index] = 1; const p = index * 4; if (!data[p + 3] || Math.max(Math.abs(data[p]-r), Math.abs(data[p+1]-g), Math.abs(data[p+2]-b)) > tolerance) return; queue[tail++] = index; };
      add(seed); rememberMask();
      while (head < tail) { const index = queue[head++]; data[index * 4 + 3] = 0; const x = index % width; add(index - width); add(index + width); if (x) add(index - 1); if (x + 1 < width) add(index + 1); }
      canvas.getContext('2d').putImageData(image, 0, 0);
    };
    const crop = { x: 0, y: 0, w: 1, h: 1 }; let drag = null;
    const render = () => {
      crop.w = Math.max(.08, Math.min(1, crop.w)); crop.h = Math.max(.08, Math.min(1, crop.h));
      crop.x = Math.max(0, Math.min(1 - crop.w, crop.x)); crop.y = Math.max(0, Math.min(1 - crop.h, crop.y));
      box.style.left = `${crop.x * 100}%`; box.style.top = `${crop.y * 100}%`; box.style.width = `${crop.w * 100}%`; box.style.height = `${crop.h * 100}%`;
      resolution.textContent = `선택 영역 ${Math.round(crop.w * canvas.width)} × ${Math.round(crop.h * canvas.height)}`;
    };
    box.addEventListener('pointerdown', event => { const bounds = box.parentElement.getBoundingClientRect(); drag = { handle: event.target.dataset.handle || 'move', x: event.clientX, y: event.clientY, initial: { ...crop }, bounds }; box.setPointerCapture(event.pointerId); event.preventDefault(); });
    box.addEventListener('pointermove', event => { if (!drag) return; const dx = (event.clientX - drag.x) / drag.bounds.width; const dy = (event.clientY - drag.y) / drag.bounds.height; const i = drag.initial;
      if (drag.handle === 'move') { crop.x = Math.max(0, Math.min(1 - i.w, i.x + dx)); crop.y = Math.max(0, Math.min(1 - i.h, i.y + dy)); }
      else {
        const west = drag.handle.includes('w'); const north = drag.handle.includes('n');
        const fixedRight = i.x + i.w; const fixedBottom = i.y + i.h;
        crop.x = west ? Math.max(0, Math.min(fixedRight - .08, i.x + dx)) : i.x;
        crop.y = north ? Math.max(0, Math.min(fixedBottom - .08, i.y + dy)) : i.y;
        crop.w = west ? fixedRight - crop.x : Math.max(.08, Math.min(1 - i.x, i.w + dx));
        crop.h = north ? fixedBottom - crop.y : Math.max(.08, Math.min(1 - i.y, i.h + dy));
      }
      render(); });
    const stop = () => { drag = null; }; box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop);
    let tool = 'none'; let drawing = null; let emoji = '😀'; let operations = []; let redoOperations = []; let clearUndoBatch = null; let clearRedoBatch = null; let cropSnapshot = { ...crop }; let selectedEmoji = null; let backgroundMaskOriginal = null;
    const drawOperation = operation => {
      const points = operation.points || []; if (!points.length) return;
      inkContext.save(); inkContext.lineCap = 'round'; inkContext.lineJoin = 'round'; inkContext.lineWidth = operation.size; inkContext.strokeStyle = operation.color; inkContext.fillStyle = operation.color; inkContext.globalCompositeOperation = operation.tool === 'eraser' ? 'destination-out' : 'source-over'; inkContext.globalAlpha = operation.tool === 'highlighter' ? .32 : 1;
      const first = points[0]; const last = points[points.length - 1];
      if (operation.tool === 'emoji') { inkContext.font = `${Math.max(24, operation.size * 4)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; inkContext.textAlign = 'center'; inkContext.textBaseline = 'middle'; inkContext.fillText(operation.emoji, first.x, first.y); }
      else if (operation.tool === 'rect') { if (operation.fill) inkContext.fillRect(first.x, first.y, last.x - first.x, last.y - first.y); else inkContext.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y); }
      else if (operation.tool === 'ellipse') { inkContext.beginPath(); inkContext.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2, Math.abs(last.x - first.x) / 2, Math.abs(last.y - first.y) / 2, 0, 0, Math.PI * 2); if (operation.fill) inkContext.fill(); else inkContext.stroke(); }
      else if (operation.tool === 'line' || operation.tool === 'arrow') { inkContext.beginPath(); inkContext.moveTo(first.x, first.y); inkContext.lineTo(last.x, last.y); inkContext.stroke(); if (operation.tool === 'arrow') { const angle = Math.atan2(last.y - first.y, last.x - first.x); const head = Math.max(12, operation.size * 3); inkContext.beginPath(); inkContext.moveTo(last.x, last.y); inkContext.lineTo(last.x - head * Math.cos(angle - Math.PI / 6), last.y - head * Math.sin(angle - Math.PI / 6)); inkContext.moveTo(last.x, last.y); inkContext.lineTo(last.x - head * Math.cos(angle + Math.PI / 6), last.y - head * Math.sin(angle + Math.PI / 6)); inkContext.stroke(); } }
      else { inkContext.beginPath(); inkContext.moveTo(first.x, first.y); points.slice(1).forEach(point => inkContext.lineTo(point.x, point.y)); if (points.length === 1) inkContext.lineTo(first.x + .01, first.y + .01); inkContext.stroke(); }
      inkContext.restore();
    };
    const emojiBox = editor.querySelector('[data-still-emoji-box]');
    const getEmojiBounds = operation => { const point = operation.points[0]; const fontSize = Math.max(24, operation.size * 4); inkContext.save(); inkContext.font = `${fontSize}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; inkContext.textAlign = 'center'; inkContext.textBaseline = 'middle'; const metrics = inkContext.measureText(operation.emoji); inkContext.restore(); const left = Number(metrics.actualBoundingBoxLeft) || fontSize * .5; const right = Number(metrics.actualBoundingBoxRight) || fontSize * .5; const top = Number(metrics.actualBoundingBoxAscent) || fontSize * .5; const bottom = Number(metrics.actualBoundingBoxDescent) || fontSize * .5; return { x: point.x - left, y: point.y - top, width: Math.max(12, left + right), height: Math.max(12, top + bottom) }; };
    const renderEmojiBox = () => { if (!selectedEmoji || !operations.includes(selectedEmoji) || tool !== 'emoji') { emojiBox.hidden = true; return; } const bounds = getEmojiBounds(selectedEmoji); emojiBox.hidden = false; emojiBox.style.left = `${bounds.x / ink.width * 100}%`; emojiBox.style.top = `${bounds.y / ink.height * 100}%`; emojiBox.style.width = `${bounds.width / ink.width * 100}%`; emojiBox.style.height = `${bounds.height / ink.height * 100}%`; };
    const redrawInk = preview => { inkContext.clearRect(0, 0, ink.width, ink.height); operations.forEach(drawOperation); if (preview) drawOperation(preview); renderEmojiBox(); };
    const snapshotState = () => ({ baseDataUrl, operations: operations.map(operation => ({ ...operation, points: operation.points.map(point => ({ ...point })) })) });
    const rememberState = () => { history.push(snapshotState()); if (history.length > 30) history.shift(); future = []; };
    const restoreState = async state => { baseDataUrl = state.baseDataUrl; operations = state.operations; selectedEmoji = null; const restored = new Image(); await new Promise((resolve, reject) => { restored.onload = resolve; restored.onerror = reject; restored.src = baseDataUrl; }); canvas.width = restored.naturalWidth; canvas.height = restored.naturalHeight; canvas.getContext('2d').drawImage(restored, 0, 0); ink.width = canvas.width; ink.height = canvas.height; Object.assign(crop, { x: 0, y: 0, w: 1, h: 1 }); canvas.parentElement.style.setProperty('--webp-video-ratio', `${canvas.width} / ${canvas.height}`); canvas.parentElement.style.setProperty('--webp-max-width', `${52 * canvas.width / canvas.height}vh`); redrawInk(); render(); };
    const updateHistoryButtons = () => { editor.querySelector('[data-still-undo]').disabled = !history.length; editor.querySelector('[data-still-redo]').disabled = !future.length; };
    const closePopovers = () => editor.querySelectorAll('[data-still-pen-list],[data-still-eraser-list],[data-still-cleanup-list],[data-still-shape-list]').forEach(list => { list.hidden = true; });
    const setTool = next => { tool = next; editor.dataset.stillTool = next; editor.querySelector('.chzzk-still-editor').dataset.stillTool = next; const cropping = next === 'crop'; const maskEditing = next === 'background-mask-restore' || next === 'background-mask-remove'; const focusedEditing = cropping || maskEditing; box.hidden = !cropping; resolution.hidden = !cropping; cropActions.hidden = true; maskTools.hidden = !maskEditing; editor.querySelector('.chzzk-still-tools').style.display = focusedEditing ? 'none' : ''; if (cropping) { cropSnapshot = { ...crop }; render(); } editor.querySelectorAll('[data-still-tool]').forEach(button => button.classList.toggle('active', button.dataset.stillTool === next)); editor.querySelector('[data-still-pen-trigger]').classList.toggle('active', next === 'pen' || next === 'highlighter'); editor.querySelector('[data-still-eraser-trigger]').classList.toggle('active', next === 'eraser'); const value = editor.querySelector('[data-still-size-value]'); const input = editor.querySelector('[data-still-size]'); if (input && next === 'background-eraser') input.value = input.max; if (value && input) value.textContent = next === 'emoji' ? `${Number(input.value) * 4}px` : input.value; renderEmojiBox(); };
    editor.querySelectorAll('[data-still-tool]').forEach(button => button.addEventListener('click', () => { closePopovers(); setTool(button.dataset.stillTool); if (button.dataset.stillTool === 'background-remove') showToast('남길 캐릭터의 얼굴이나 몸 안쪽을 클릭하세요.'); }));
    setTool('none');
    const shapeList = editor.querySelector('[data-still-shape-list]'); editor.querySelector('[data-still-shapes]').addEventListener('click', () => { const open = shapeList.hidden; closePopovers(); shapeList.hidden = !open; });
    const penList = editor.querySelector('[data-still-pen-list]'); penList.querySelector('[data-still-tool="pen"]')?.remove(); editor.querySelector('[data-still-pen-trigger]').addEventListener('click', () => { if (tool !== 'pen') { closePopovers(); setTool('pen'); } else { const open = penList.hidden; closePopovers(); penList.hidden = !open; } });
    const eraserList = editor.querySelector('[data-still-eraser-list]'); eraserList.querySelector('[data-still-tool="eraser"]')?.remove(); editor.querySelector('[data-still-eraser-trigger]').addEventListener('click', () => { if (tool !== 'eraser') { closePopovers(); setTool('eraser'); } else { const open = eraserList.hidden; closePopovers(); eraserList.hidden = !open; } });
    const cleanupList = editor.querySelector('[data-still-cleanup-list]'); editor.querySelector('[data-still-cleanup]').addEventListener('click', () => { const open = cleanupList.hidden; closePopovers(); cleanupList.hidden = !open; });
    maskTools.querySelectorAll('[data-still-mask-mode]').forEach(button => button.addEventListener('click', () => { const next = button.dataset.stillMaskMode === 'remove' ? 'background-mask-remove' : 'background-mask-restore'; setTool(next); maskTools.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); }));
    editor.querySelector('[data-still-clear]').addEventListener('click', () => { if (operations.length) { rememberState(); operations = []; selectedEmoji = null; redrawInk(); updateHistoryButtons(); } closePopovers(); });
    editor.querySelectorAll('[data-still-emoji]').forEach(button => button.addEventListener('click', () => { emoji = button.dataset.stillEmoji; setTool('emoji'); shapeList.hidden = true; }));
    editor.querySelector('[data-still-undo]').addEventListener('click', async () => { if (!history.length) return; future.push(snapshotState()); await restoreState(history.pop()); updateHistoryButtons(); });
    editor.querySelector('[data-still-redo]').addEventListener('click', async () => { if (!future.length) return; history.push(snapshotState()); await restoreState(future.pop()); updateHistoryButtons(); }); updateHistoryButtons();
    const sizeInput = editor.querySelector('[data-still-size]'); const sizeValue = editor.querySelector('[data-still-size-value]'); sizeInput.addEventListener('input', () => { sizeValue.textContent = tool === 'emoji' ? `${Number(sizeInput.value) * 4}px` : sizeInput.value; });
    const drawingSurface = canvas.parentElement;
    let emojiResize = null; const emojiResizeHandle = emojiBox.querySelector('[data-emoji-resize]');
    emojiResizeHandle.addEventListener('pointerdown', event => { if (!selectedEmoji) return; emojiResize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size: selectedEmoji.size, mode: 'resize' }; try { emojiResizeHandle.setPointerCapture(event.pointerId); } catch (_) {} event.stopPropagation(); event.preventDefault(); });
    emojiResizeHandle.addEventListener('pointermove', event => { if (!emojiResize || event.pointerId !== emojiResize.pointerId || !selectedEmoji) return; const bounds = drawingSurface.getBoundingClientRect(); const delta = Math.max(event.clientX - emojiResize.x, event.clientY - emojiResize.y) * ink.width / bounds.width; selectedEmoji.size = Math.max(6, Math.min(160, emojiResize.size + delta / 4)); redrawInk(); event.stopPropagation(); });
    const stopEmojiResize = event => { if (!emojiResize) return; emojiResize = null; updateHistoryButtons(); event.stopPropagation(); }; emojiResizeHandle.addEventListener('pointerup', stopEmojiResize); emojiResizeHandle.addEventListener('pointercancel', stopEmojiResize);
    emojiBox.addEventListener('pointerdown', event => { if (!selectedEmoji || event.target === emojiResizeHandle) return; const point = selectedEmoji.points[0]; emojiResize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point: { ...point }, mode: 'move' }; try { emojiBox.setPointerCapture(event.pointerId); } catch (_) {} event.stopPropagation(); event.preventDefault(); });
    emojiBox.addEventListener('pointermove', event => { if (!emojiResize || emojiResize.mode !== 'move' || event.pointerId !== emojiResize.pointerId || !selectedEmoji) return; const bounds = drawingSurface.getBoundingClientRect(); const half = Math.max(12, selectedEmoji.size * 2); selectedEmoji.points[0] = { x: Math.max(half, Math.min(ink.width - half, emojiResize.point.x + (event.clientX - emojiResize.x) * ink.width / bounds.width)), y: Math.max(half, Math.min(ink.height - half, emojiResize.point.y + (event.clientY - emojiResize.y) * ink.height / bounds.height)) }; redrawInk(); event.stopPropagation(); });
    emojiBox.addEventListener('pointerup', stopEmojiResize); emojiBox.addEventListener('pointercancel', stopEmojiResize);
    const inkPoint = event => { const bounds = drawingSurface.getBoundingClientRect(); return { x: Math.max(0, Math.min(ink.width, (event.clientX - bounds.left) * ink.width / bounds.width)), y: Math.max(0, Math.min(ink.height, (event.clientY - bounds.top) * ink.height / bounds.height)) }; };
    const commitBaseCanvas = () => { baseDataUrl = canvas.toDataURL('image/png'); };
    const ensureAiHost = () => new Promise((resolve, reject) => {
      let frame = document.getElementById('liveshot-ai-host');
      if (frame?.dataset.ready === 'true') { resolve(frame); return; }
      if (!frame) { frame = document.createElement('iframe'); frame.id = 'liveshot-ai-host'; frame.src = chrome.runtime.getURL('vendor/ai-runtime/ai-host.html'); Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', left: '-10000px', top: '-10000px', border: '0', opacity: '0', pointerEvents: 'none' }); document.documentElement.appendChild(frame); }
      const timer = setTimeout(() => reject(new Error('AI 작업자 준비 시간이 초과되었습니다.')), 10000); frame.addEventListener('load', () => { clearTimeout(timer); frame.dataset.ready = 'true'; resolve(frame); }, { once: true });
    });
    const activeAiCancels = new Set();
    const runAiModel = async (modelName, imageData, imageDims, maskData = null, maskDims = null) => {
      const frame = await ensureAiHost(); const channel = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('AI 처리 시간이 초과되었습니다.')); }, 180000);
        const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); activeAiCancels.delete(cancel); };
        const cancel = () => { cleanup(); const error = new Error('AI 작업이 취소되었습니다.'); error.name = 'AbortError'; reject(error); };
        const receive = event => { const message = event.data || {}; if (event.source !== frame.contentWindow || !message.__liveShotAiReply || message.channel !== channel) return; cleanup(); if (message.type === 'error') reject(new Error(message.message || 'AI 처리 실패')); else resolve(new Float32Array(message.output.buffer)); };
        activeAiCancels.add(cancel); window.addEventListener('message', receive); const image = { buffer: imageData.buffer, dims: imageDims }; const mask = maskData ? { buffer: maskData.buffer, dims: maskDims } : null; const transfer = [image.buffer, mask?.buffer].filter(Boolean); frame.contentWindow.postMessage({ __liveShotAiCommand: true, type: 'run', channel, modelName, image, mask }, '*', transfer);
      });
    };
    const aiDisabledStates = new Map();
    let stillAiStatus = null;
    const setAiBusy = (busy, message = '') => {
      editor.classList.toggle('chzzk-still-ai-busy', busy);
      editor.querySelectorAll('.chzzk-still-tools button,.chzzk-webp-actions button').forEach(button => { if (busy) { if (!aiDisabledStates.has(button)) aiDisabledStates.set(button, button.disabled); button.disabled = true; } else button.disabled = Boolean(aiDisabledStates.get(button)); });
      if (!busy) aiDisabledStates.clear();
      const heading = editor.querySelector('.chzzk-webp-head strong');
      if (heading) heading.textContent = busy ? message : '캡처 편집';
      if (busy) {
        editor.style.display = 'none';
        if (!stillAiStatus) {
          stillAiStatus = document.createElement('div');
          stillAiStatus.className = 'chzzk-webp-background-status chzzk-still-ai-status';
          stillAiStatus.innerHTML = '<span><b data-still-ai-status></b><small>배경에서 처리 중입니다.</small></span><button type="button" data-still-ai-cancel title="작업 취소">×</button>';
          stillAiStatus.querySelector('[data-still-ai-cancel]').addEventListener('click', event => { event.stopPropagation(); [...activeAiCancels].forEach(cancel => cancel()); document.getElementById('liveshot-ai-host')?.remove(); });
          document.body.appendChild(stillAiStatus);
        }
        stillAiStatus.querySelector('[data-still-ai-status]').textContent = message || '배경 제거 중...';
      } else {
        stillAiStatus?.remove(); stillAiStatus = null;
        if (editor.isConnected) editor.style.display = 'grid';
        updateHistoryButtons();
      }
    };
    const reportBackgroundFailure = error => {
      backgroundMaskOriginal = null;
      const notice = document.createElement('p'); notice.dataset.backgroundError = ''; notice.className = 'chzzk-webp-status'; notice.setAttribute('role', 'alert');
      notice.textContent = `배경 제거 실패: ${error.message || error} · 원본은 유지됩니다.`;
      editor.querySelector('.chzzk-webp-actions').before(notice); updateHistoryButtons();
    };
    const removeBackgroundWithAi = async selectedPoint => {
      if (editor.classList.contains('chzzk-still-ai-busy')) return;
      editor.querySelector('[data-background-error]')?.remove();
      rememberState(); setAiBusy(true, 'AI가 캐릭터 경계를 분석 중...');
      maskUndo.length = 0; maskRedo.length = 0; maskColorMode = false; syncMaskHistory();
      try {
        backgroundMaskOriginal = document.createElement('canvas'); backgroundMaskOriginal.width = canvas.width; backgroundMaskOriginal.height = canvas.height; backgroundMaskOriginal.getContext('2d').drawImage(canvas, 0, 0);
        const size = 1024; const inputCanvas = document.createElement('canvas'); inputCanvas.width = size; inputCanvas.height = size;
        const inputContext = inputCanvas.getContext('2d', { alpha: false }); inputContext.fillStyle = '#000'; inputContext.fillRect(0, 0, size, size);
        const inputScale = Math.min(size / canvas.width, size / canvas.height); const fittedWidth = Math.round(canvas.width * inputScale); const fittedHeight = Math.round(canvas.height * inputScale); const fittedX = Math.floor((size - fittedWidth) / 2); const fittedY = Math.floor((size - fittedHeight) / 2);
        inputContext.imageSmoothingEnabled = true; inputContext.imageSmoothingQuality = 'high'; inputContext.drawImage(canvas, fittedX, fittedY, fittedWidth, fittedHeight);
        const rgba = inputContext.getImageData(0, 0, size, size).data; const tensorData = new Float32Array(3 * size * size);
        const mean = [.485, .456, .406]; const deviation = [.229, .224, .225];
        for (let pixel = 0; pixel < size * size; pixel += 1) for (let channel = 0; channel < 3; channel += 1) tensorData[channel * size * size + pixel] = (rgba[pixel * 4 + channel] / 255 - mean[channel]) / deviation[channel];
        const logits = await runAiModel('birefnet-lite-compatible.onnx', tensorData, [1, 3, size, size]); const output = new Float32Array(logits.length);
        if (logits.length !== size * size) throw new Error('캐릭터 마스크의 출력 크기가 올바르지 않습니다.');
        let minMask = Infinity; let maxMask = -Infinity;
        for (const value of logits) { if (!Number.isFinite(value)) throw new Error('캐릭터 마스크에 잘못된 값이 있습니다.'); minMask = Math.min(minMask, value); maxMask = Math.max(maxMask, value); }
        const probabilityMask = minMask >= 0 && maxMask <= 1;
        const binary = new Uint8Array(size * size); for (let index = 0; index < binary.length; index += 1) { output[index] = probabilityMask ? logits[index] : 1 / (1 + Math.exp(-logits[index])); binary[index] = output[index] >= .4 ? 1 : 0; }
        const visited = new Uint8Array(binary.length); const queue = new Int32Array(binary.length); let best = null;
        for (let seed = 0; seed < binary.length; seed += 1) { if (!binary[seed] || visited[seed]) continue; let head = 0; let tail = 0; let sx = 0; let sy = 0; let sideBorderCount = 0; let centerHits = 0; queue[tail++] = seed; visited[seed] = 1;
          while (head < tail) { const pixel = queue[head++]; const x = pixel % size; const y = Math.floor(pixel / size); sx += x; sy += y; if (x < 4 || x >= size - 4) sideBorderCount += 1; if (Math.abs(x - size / 2) < size * .12 && Math.abs(y - size / 2) < size * .18) centerHits += 1; const neighbors = [pixel - size, pixel + size, x ? pixel - 1 : -1, x + 1 < size ? pixel + 1 : -1]; for (const next of neighbors) if (next >= 0 && next < binary.length && binary[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; } }
          const targetX = selectedPoint ? fittedX + selectedPoint.x * inputScale : size / 2;
          const targetY = selectedPoint ? fittedY + selectedPoint.y * inputScale : size / 2;
          let distance = Infinity;
          for (let i = 0; i < tail; i++) { const p = queue[i]; distance = Math.min(distance, Math.hypot(p % size - targetX, Math.floor(p / size) - targetY)); }
          const score = selectedPoint ? -distance + Math.min(tail / binary.length, 1) * .001 : tail * (centerHits ? 4 : 1);
          if (!best || score > best.score) best = { score, pixels: queue.slice(0, tail) };
        }
        if (!best) throw new Error('가운데 캐릭터 경계를 찾지 못했습니다.');
        const keep = new Uint8Array(size * size); best.pixels.forEach(pixel => { keep[pixel] = 1; });
        // Grow only through lower-confidence foreground connected to the selected subject.
        // This recovers thin fingers without selecting unrelated foreground objects.
        let growHead = 0; let growTail = 0;
        best.pixels.forEach(pixel => { queue[growTail++] = pixel; });
        while (growHead < growTail) { const pixel = queue[growHead++]; const x = pixel % size; const neighbors = [pixel - size, pixel + size, x ? pixel - 1 : -1, x + 1 < size ? pixel + 1 : -1]; for (const next of neighbors) if (next >= 0 && next < keep.length && !keep[next] && output[next] >= .2) { keep[next] = 1; queue[growTail++] = next; } }
        const repairedInterior = new Uint8Array(size * size); const bottomRow = (size - 1) * size; let bottomLeft = -1; let bottomRight = -1;
        // 이전 보존형 설정처럼, 캐릭터 외곽의 좌우 경계 안은 우선 전경으로
        // 유지한다. 머리카락 틈은 제거 브러시로 후처리할 수 있지만 얼굴·가슴
        // 같은 내부가 배경과 비슷한 색이라는 이유로 뚫리는 것은 방지한다.
        for (let y = 0; y < size; y += 1) {
          let left = size; let right = -1; const row = y * size;
          for (let x = 0; x < size; x += 1) if (keep[row + x]) { left = Math.min(left, x); right = x; }
          if (right - left < size * .08) continue;
          for (let x = left; x <= right; x += 1) if (!keep[row + x]) { keep[row + x] = 1; repairedInterior[row + x] = 1; }
        }
        for (let x = 0; x < size; x += 1) if (keep[bottomRow + x]) { if (bottomLeft < 0) bottomLeft = x; bottomRight = x; }
        if (bottomLeft >= 0 && bottomRight - bottomLeft > size * .12) for (let x = bottomLeft; x <= bottomRight; x += 1) keep[bottomRow + x] = 1;
        const outside = new Uint8Array(size * size); const outsideQueue = new Int32Array(size * size); let outsideHead = 0; let outsideTail = 0;
        const enqueueOutside = pixel => { if (pixel < 0 || pixel >= keep.length || keep[pixel] || outside[pixel]) return; outside[pixel] = 1; outsideQueue[outsideTail++] = pixel; };
        for (let x = 0; x < size; x += 1) { enqueueOutside(x); enqueueOutside(bottomRow + x); }
        for (let y = 1; y < size - 1; y += 1) { enqueueOutside(y * size); enqueueOutside(y * size + size - 1); }
        while (outsideHead < outsideTail) { const pixel = outsideQueue[outsideHead++]; const x = pixel % size; enqueueOutside(pixel - size); enqueueOutside(pixel + size); if (x) enqueueOutside(pixel - 1); if (x + 1 < size) enqueueOutside(pixel + 1); }
        for (let pixel = 0; pixel < keep.length; pixel += 1) if (!keep[pixel] && !outside[pixel]) { keep[pixel] = 1; repairedInterior[pixel] = 1; }
        const maskCanvas = document.createElement('canvas'); maskCanvas.width = size; maskCanvas.height = size; const maskContext = maskCanvas.getContext('2d'); const maskPixels = maskContext.createImageData(size, size);
        for (let pixel = 0; pixel < keep.length; pixel += 1) {
          let confidence = keep[pixel] ? Math.max(0, Math.min(1, output[pixel])) : 0;
          if (keep[pixel]) { const x = pixel % size; const y = Math.floor(pixel / size); const edge = !x || !y || x === size - 1 || y === size - 1 || !keep[pixel - 1] || !keep[pixel + 1] || !keep[pixel - size] || !keep[pixel + size]; if (repairedInterior[pixel] || !edge) confidence = Math.max(confidence, .98); else confidence = Math.max(confidence, .9); }
          const normalized = Math.max(0, Math.min(1, (confidence - .08) / .84)); const alpha = Math.round(normalized * normalized * (3 - 2 * normalized) * 255);
          maskPixels.data[pixel * 4] = 255; maskPixels.data[pixel * 4 + 1] = 255; maskPixels.data[pixel * 4 + 2] = 255; maskPixels.data[pixel * 4 + 3] = alpha;
        }
        maskContext.putImageData(maskPixels, 0, 0); const softenedMask = document.createElement('canvas'); softenedMask.width = size; softenedMask.height = size; const softenedContext = softenedMask.getContext('2d'); softenedContext.filter = 'blur(0.65px)'; softenedContext.drawImage(maskCanvas, 0, 0);
        const resultCanvas = document.createElement('canvas'); resultCanvas.width = canvas.width; resultCanvas.height = canvas.height; const resultContext = resultCanvas.getContext('2d'); resultContext.drawImage(canvas, 0, 0); resultContext.globalCompositeOperation = 'destination-in'; resultContext.imageSmoothingEnabled = true; resultContext.imageSmoothingQuality = 'high'; resultContext.drawImage(softenedMask, fittedX, fittedY, fittedWidth, fittedHeight, 0, 0, canvas.width, canvas.height); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); canvas.getContext('2d').drawImage(resultCanvas, 0, 0); commitBaseCanvas(); future = []; updateHistoryButtons(); setTool('background-mask-restore'); maskTools.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.stillMaskMode === 'restore'));
      } catch (error) { const previous = history.pop(); if (error?.name === 'AbortError') { if (previous) await restoreState(previous); return; } showToast(`AI 누끼 실패: ${error.message || error}`); throw error; }
      finally { setAiBusy(false); }
    };
    const removeConnectedBackground = () => {
      rememberState();
      const context = canvas.getContext('2d'); const pixels = context.getImageData(0, 0, canvas.width, canvas.height); const data = pixels.data;
      const cornerOffsets = [0, (canvas.width - 1) * 4, (canvas.height - 1) * canvas.width * 4, (canvas.width * canvas.height - 1) * 4];
      const cornerMedian = channel => { const values = cornerOffsets.map(offset => data[offset + channel]).sort((a, b) => a - b); return Math.round((values[1] + values[2]) / 2); };
      const sr = cornerMedian(0); const sg = cornerMedian(1); const sb = cornerMedian(2);
      const count = canvas.width * canvas.height; const visited = new Uint8Array(count); const queue = new Int32Array(count); let head = 0; let tail = 0;
      const tolerance = 58;
      const enqueue = pixel => { if (pixel < 0 || pixel >= count || visited[pixel]) return; const offset = pixel * 4; if (Math.abs(data[offset] - sr) + Math.abs(data[offset + 1] - sg) + Math.abs(data[offset + 2] - sb) > tolerance * 3) return; visited[pixel] = 1; queue[tail++] = pixel; };
      for (let x = 0; x < canvas.width; x += 1) { enqueue(x); enqueue((canvas.height - 1) * canvas.width + x); }
      for (let y = 1; y < canvas.height - 1; y += 1) { enqueue(y * canvas.width); enqueue(y * canvas.width + canvas.width - 1); }
      while (head < tail) { const pixel = queue[head++]; const offset = pixel * 4; const distance = Math.abs(data[offset] - sr) + Math.abs(data[offset + 1] - sg) + Math.abs(data[offset + 2] - sb); if (distance > tolerance * 3) continue; data[offset + 3] = 0; const x = pixel % canvas.width; const neighbors = [pixel - canvas.width, pixel + canvas.width, x ? pixel - 1 : -1, x + 1 < canvas.width ? pixel + 1 : -1]; for (const next of neighbors) if (next >= 0 && next < count && !visited[next]) { visited[next] = 1; queue[tail++] = next; } }
      context.putImageData(pixels, 0, 0); commitBaseCanvas(); future = []; updateHistoryButtons();
    };
    const removeBrushWithAi = async (strokes, brushSize) => {
      const points = strokes.flat(); if (!points.length) return; rememberState(); setAiBusy(true, 'AI가 칠한 영역의 배경을 복원 중...');
      try {
        const size = 512; const radius = Math.max(2, brushSize); const xs = points.map(point => point.x); const ys = points.map(point => point.y);
        const bx1 = Math.max(0, Math.min(...xs) - radius); const bx2 = Math.min(canvas.width, Math.max(...xs) + radius); const by1 = Math.max(0, Math.min(...ys) - radius); const by2 = Math.min(canvas.height, Math.max(...ys) + radius);
        const contextSide = Math.min(Math.max(canvas.width, canvas.height), Math.max(bx2 - bx1, by2 - by1) * 2.4 + radius * 2); const centerX = (bx1 + bx2) / 2; const centerY = (by1 + by2) / 2;
        const sourceX = Math.max(0, Math.min(Math.max(0, canvas.width - contextSide), centerX - contextSide / 2)); const sourceY = Math.max(0, Math.min(Math.max(0, canvas.height - contextSide), centerY - contextSide / 2)); const sourceWidth = Math.min(contextSide, canvas.width - sourceX); const sourceHeight = Math.min(contextSide, canvas.height - sourceY);
        const inputCanvas = document.createElement('canvas'); inputCanvas.width = size; inputCanvas.height = size; const inputContext = inputCanvas.getContext('2d', { alpha: false }); inputContext.imageSmoothingEnabled = true; inputContext.imageSmoothingQuality = 'high'; inputContext.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
        const maskCanvas = document.createElement('canvas'); maskCanvas.width = size; maskCanvas.height = size; const maskContext = maskCanvas.getContext('2d'); maskContext.strokeStyle = '#fff'; maskContext.fillStyle = '#fff'; maskContext.lineCap = 'round'; maskContext.lineJoin = 'round'; maskContext.lineWidth = Math.max(2, brushSize * 2 * size / Math.max(sourceWidth, sourceHeight)); strokes.forEach(stroke => { if (!stroke.length) return; maskContext.beginPath(); stroke.forEach((point, index) => { const x = (point.x - sourceX) / sourceWidth * size; const y = (point.y - sourceY) / sourceHeight * size; if (!index) maskContext.moveTo(x, y); else maskContext.lineTo(x, y); }); maskContext.stroke(); if (stroke.length === 1) { const point = stroke[0]; maskContext.beginPath(); maskContext.arc((point.x - sourceX) / sourceWidth * size, (point.y - sourceY) / sourceHeight * size, maskContext.lineWidth / 2, 0, Math.PI * 2); maskContext.fill(); } });
        const rgba = inputContext.getImageData(0, 0, size, size).data; const maskRgba = maskContext.getImageData(0, 0, size, size).data; const imageTensor = new Float32Array(3 * size * size); const maskTensor = new Float32Array(size * size);
        for (let pixel = 0; pixel < size * size; pixel += 1) { for (let channel = 0; channel < 3; channel += 1) imageTensor[channel * size * size + pixel] = rgba[pixel * 4 + channel] / 255; maskTensor[pixel] = maskRgba[pixel * 4 + 3] > 16 ? 1 : 0; }
        const output = await runAiModel('inpainting-lama.onnx', imageTensor, [1, 3, size, size], maskTensor, [1, 1, size, size]); const restored = document.createElement('canvas'); restored.width = size; restored.height = size; const restoredContext = restored.getContext('2d'); const restoredPixels = restoredContext.createImageData(size, size);
        for (let pixel = 0; pixel < size * size; pixel += 1) { for (let channel = 0; channel < 3; channel += 1) restoredPixels.data[pixel * 4 + channel] = Math.max(0, Math.min(255, Math.round(output[channel * size * size + pixel]))); restoredPixels.data[pixel * 4 + 3] = 255; } restoredContext.putImageData(restoredPixels, 0, 0);
        const patch = document.createElement('canvas'); patch.width = canvas.width; patch.height = canvas.height; const patchContext = patch.getContext('2d'); patchContext.drawImage(restored, 0, 0, size, size, sourceX, sourceY, sourceWidth, sourceHeight); patchContext.globalCompositeOperation = 'destination-in'; patchContext.drawImage(maskCanvas, 0, 0, size, size, sourceX, sourceY, sourceWidth, sourceHeight); canvas.getContext('2d').drawImage(patch, 0, 0); commitBaseCanvas(); future = []; updateHistoryButtons();
      } catch (error) { const previous = history.pop(); if (error?.name === 'AbortError') { if (previous) await restoreState(previous); return; } showToast(`AI 브러시 복원 실패: ${error.message || error}`); }
      finally { setAiBusy(false); }
    };
    const refineBackgroundMaskEdges = () => {
      if (!backgroundMaskOriginal) return;
      const width = canvas.width;
      const height = canvas.height;
      const context = canvas.getContext('2d');
      const current = context.getImageData(0, 0, width, height);
      const original = backgroundMaskOriginal.getContext('2d').getImageData(0, 0, width, height);
      const pixelCount = width * height;
      const mask = new Uint8Array(pixelCount);
      for (let index = 0; index < pixelCount; index += 1) mask[index] = current.data[index * 4 + 3] >= 128 ? 1 : 0;

      // 브러시로 정한 큰 영역은 유지하고, 경계의 한 픽셀 돌기와 구멍만 보수적으로 정리한다.
      const cleaned = mask.slice();
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          let neighbors = 0;
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) neighbors += mask[index + offsetY * width + offsetX];
          }
          if (mask[index] && neighbors <= 2) cleaned[index] = 0;
          else if (!mask[index] && neighbors >= 7) cleaned[index] = 1;
        }
      }

      // 원본 RGB로 1픽셀 경계의 반투명도를 다시 만들어 검은 테두리와 톱니를 줄인다.
      const output = context.createImageData(width, height);
      const weights = [1, 4, 6, 4, 1];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          const dataIndex = index * 4;
          let coverage = 0;
          let total = 0;
          for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
            const sampleY = y + offsetY;
            if (sampleY < 0 || sampleY >= height) continue;
            for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
              const sampleX = x + offsetX;
              if (sampleX < 0 || sampleX >= width) continue;
              const weight = weights[offsetY + 2] * weights[offsetX + 2];
              coverage += cleaned[sampleY * width + sampleX] * weight;
              total += weight;
            }
          }
          output.data[dataIndex] = original.data[dataIndex];
          output.data[dataIndex + 1] = original.data[dataIndex + 1];
          output.data[dataIndex + 2] = original.data[dataIndex + 2];
          output.data[dataIndex + 3] = Math.min(original.data[dataIndex + 3], Math.round((coverage / total) * 255));
        }
      }
      context.putImageData(output, 0, 0);
    };

    const applyBackgroundMaskSegment = (from, to, mode, size) => {
      if (!backgroundMaskOriginal) return; const context = canvas.getContext('2d'); context.save(); context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = Math.max(8, size * 2);
      if (mode === 'background-mask-remove') { context.globalCompositeOperation = 'destination-out'; context.strokeStyle = '#000'; context.fillStyle = '#000'; }
      else { const pattern = context.createPattern(backgroundMaskOriginal, 'no-repeat'); context.globalCompositeOperation = 'source-over'; context.strokeStyle = pattern; context.fillStyle = pattern; }
      context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
      if (from.x === to.x && from.y === to.y) { context.beginPath(); context.arc(from.x, from.y, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); }
      context.restore();
    };
    ink.addEventListener('pointerdown', event => {
      if (tool === 'crop' || tool === 'none') return;
      const point = inkPoint(event); const size = Number(editor.querySelector('[data-still-size]').value) || 8;
      if (tool === 'background-remove') { setTool('none'); removeBackgroundWithAi(point).catch(reportBackgroundFailure); return; }
      if (tool === 'background-mask-restore' || tool === 'background-mask-remove') { if (maskColorMode) { eraseMaskColor(point); event.preventDefault(); return; } rememberMask(); const maskSize = Number(maskTools.querySelector('[data-still-mask-size]').value) || 32; drawing = { operation: { tool, points: [point], size: maskSize }, pointerId: event.pointerId }; applyBackgroundMaskSegment(point, point, tool, maskSize); try { ink.setPointerCapture(event.pointerId); } catch (_) {} event.preventDefault(); return; }
      if (tool === 'background-eraser') { drawing = { operation: { tool, points: [point], size, color: '#ff5577' }, pointerId: event.pointerId }; try { ink.setPointerCapture(event.pointerId); } catch (_) {} redrawInk(drawing.operation); event.preventDefault(); return; }
      const operation = { tool, points: [point], size: tool === 'highlighter' ? size * 2.5 : size, color: editor.querySelector('[data-still-color]').value, emoji, fill: editor.querySelector('[data-still-fill]').checked };
      if (tool === 'emoji') { rememberState(); operations.push(operation); selectedEmoji = operation; redrawInk(); updateHistoryButtons(); return; }
      drawing = { operation, pointerId: event.pointerId }; try { ink.setPointerCapture(event.pointerId); } catch (_) {} redrawInk(operation); event.preventDefault();
    });
    ink.addEventListener('pointermove', event => { if (!drawing || event.pointerId !== drawing.pointerId) return; const point = inkPoint(event); if (drawing.operation.tool === 'background-mask-restore' || drawing.operation.tool === 'background-mask-remove') { const previous = drawing.operation.points[drawing.operation.points.length - 1]; drawing.operation.points.push(point); applyBackgroundMaskSegment(previous, point, drawing.operation.tool, drawing.operation.size); return; } if (['pen','highlighter','eraser','background-eraser'].includes(drawing.operation.tool)) drawing.operation.points.push(point); else drawing.operation.points[1] = point; redrawInk(drawing.operation); });
    const stopDrawing = () => { if (!drawing) return; const operation = drawing.operation; drawing = null; if (operation.tool === 'background-mask-restore' || operation.tool === 'background-mask-remove') return; if (operation.tool === 'background-eraser') { redrawInk(); removeBrushWithAi([operation.points], operation.size); } else { rememberState(); operations.push(operation); redrawInk(); updateHistoryButtons(); } }; ink.addEventListener('pointerup', stopDrawing); ink.addEventListener('pointercancel', stopDrawing);
    const close = () => { stillAiStatus?.remove(); editor.remove(); }; editor.querySelector('[data-still-close]').addEventListener('click', close); editor.addEventListener('click', event => { if (event.target === editor) close(); });
    const applyCropNow = async () => { const sx = Math.round(crop.x * canvas.width); const sy = Math.round(crop.y * canvas.height); const sw = Math.max(2, Math.round(crop.w * canvas.width)); const sh = Math.max(2, Math.round(crop.h * canvas.height)); rememberState(); const flattened = document.createElement('canvas'); flattened.width = canvas.width; flattened.height = canvas.height; flattened.getContext('2d').drawImage(canvas, 0, 0); flattened.getContext('2d').drawImage(ink, 0, 0); const output = document.createElement('canvas'); output.width = sw; output.height = sh; output.getContext('2d').drawImage(flattened, sx, sy, sw, sh, 0, 0, sw, sh); baseDataUrl = output.toDataURL('image/png'); canvas.width = sw; canvas.height = sh; canvas.getContext('2d').drawImage(output, 0, 0); ink.width = sw; ink.height = sh; operations = []; selectedEmoji = null; Object.assign(crop, { x: 0, y: 0, w: 1, h: 1 }); canvas.parentElement.style.setProperty('--webp-video-ratio', `${sw} / ${sh}`); canvas.parentElement.style.setProperty('--webp-max-width', `${52 * sw / sh}vh`); redrawInk(); render(); setTool('none'); updateHistoryButtons(); };
    editor.querySelector('[data-still-cancel]').addEventListener('click', async () => { if (tool === 'crop') { Object.assign(crop, cropSnapshot); render(); setTool('none'); } else if (tool === 'background-mask-restore' || tool === 'background-mask-remove') { const previous = history.pop(); backgroundMaskOriginal = null; if (previous) await restoreState(previous); setTool('none'); updateHistoryButtons(); } else close(); });
    editor.querySelector('[data-still-apply]').addEventListener('click', async () => { if (tool === 'crop') { await applyCropNow(); return; } if (tool === 'background-mask-restore' || tool === 'background-mask-remove') { refineBackgroundMaskEdges(); commitBaseCanvas(); backgroundMaskOriginal = null; setTool('none'); future = []; updateHistoryButtons(); return; } const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height; const outputContext = output.getContext('2d'); outputContext.drawImage(canvas, 0, 0); outputContext.drawImage(ink, 0, 0); const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png')); const result = { blob, dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height, animated: false }; await onComplete(result); close(); });
    redrawInk(); render();
  }

  async function openAnimatedWebpEditor(onComplete, options = {}) {
    document.getElementById('chzzk-webp-editor')?.remove();
    const isYouTubeSource = options.sourcePlatform === 'youtube' || /(^|\.)youtube\.com$/i.test(window.location.hostname);
    const visibleVideo = findMainVideoElement('CLIP');
    const youtubePlayer = visibleVideo?.closest('.html5-video-player');
    const liveBadge = youtubePlayer?.querySelector('.ytp-live-badge');
    const isYouTubeLive = isYouTubeSource && Boolean(visibleVideo) && (!Number.isFinite(visibleVideo.duration) || youtubePlayer?.classList.contains('ytp-live') || Boolean(liveBadge && liveBadge.getClientRects().length));
    const hasYouTubeDvr = isYouTubeLive && canUseYouTubeDvr();
    const declaredSourceKind = options.sourceKind || '';
    let isLiveSource = declaredSourceKind === 'live' || (!declaredSourceKind && ((isYouTubeLive && !hasYouTubeDvr) || (!isYouTubeSource && /^\/live\//.test(window.location.pathname))));
    let playerLiveFallback = false;
    const isReplaySource = declaredSourceKind === 'replay' || (!declaredSourceKind && !isYouTubeSource && /^\/video\//.test(window.location.pathname));
    const isClipSource = declaredSourceKind === 'clip' || (!declaredSourceKind && !isYouTubeSource && /^\/(?:clips?|shorts?)\//.test(window.location.pathname));
    const locateDirectVideo = () => {
      if (isYouTubeSource) return findMainVideoElement('CLIP');
      const preferred = document.querySelector('video.webplayer-internal-video, [class*="webplayer"] video, [class*="clip"] video, [class*="short"] video');
      if (preferred) return preferred;
      const candidates = getAllVideosAcrossShadowRoots(document).filter(video => video.videoWidth || video.readyState);
      candidates.sort((a, b) => ((b.videoWidth || b.clientWidth) * (b.videoHeight || b.clientHeight)) - ((a.videoWidth || a.clientWidth) * (a.videoHeight || a.clientHeight)));
      return candidates[0] || findMainVideoElement(isLiveSource ? 'LIVE' : 'CLIP');
    };
    let ownedClipVideo = null;
    let ownedReplayFrame = null;
    let directStateRestored = false;
    let directVideo = null;
    if (isClipSource) {
      showToast('클립 원본 영상을 불러오는 중입니다...');
      try { ownedClipVideo = await createClipSourceVideo(); directVideo = ownedClipVideo; }
      catch (error) { showToast(`클립 원본을 불러오지 못했습니다: ${error.message || error}`); return; }
    } else if (isReplaySource) {
      showToast(isYouTubeSource ? '독립 유튜브 영상을 불러오는 중입니다...' : '독립 다시보기 영상을 불러오는 중입니다...');
      try { const replaySource = isYouTubeSource ? await createYouTubeSourceVideo() : await createReplaySourceVideo(); directVideo = replaySource.video; ownedReplayFrame = replaySource.frame; if (!isYouTubeSource && (directVideo === visibleVideo || directVideo?.ownerDocument !== ownedReplayFrame?.contentDocument)) throw new Error('독립 다시보기 플레이어 분리에 실패했습니다.'); }
      catch (error) { showToast(`${isYouTubeSource ? '유튜브' : '다시보기'} 원본을 불러오지 못했습니다: ${error.message || error}`); return; }
    } else directVideo = locateDirectVideo();
    let initialDirectState = directVideo ? { time: directVideo.currentTime, paused: directVideo.paused, rate: directVideo.playbackRate, muted: directVideo.muted } : null;
    let cachedFrames = [];
    let newestFrameTime = 0;
    let directRange = null;
    let fullSourceRange = null;
    let available = 0;
    let serverLive = null;
    const settingsKey = `chzzkWebpEditorSettings:${isYouTubeSource ? 'youtube' : isLiveSource ? 'live' : isReplaySource ? 'replay' : 'clip'}`;
    if (isLiveSource && !isYouTubeSource && globalThis.LiveShotLiveStream) {
      try { serverLive = await globalThis.LiveShotLiveStream.open((options.initialSettings || webpEditorSessionSettings.get(settingsKey))?.liveSnapshot); }
      catch (error) {
        showToast(`독립 라이브 영상 준비 실패: ${error.message} · 시청 중인 플레이어는 변경하지 않습니다.`); return;
      }
    }
    if (serverLive) {
      newestFrameTime = serverLive.end; available = serverLive.available;
    } else if (isLiveSource) {
      rollingFrameCache.ensure(); cachedFrames = Array.isArray(options.cachedFrames) && options.cachedFrames.length > 1 ? options.cachedFrames.slice() : rollingFrameCache.snapshot();
      if (cachedFrames.length < 2) { showToast('라이브 화면을 임시 저장 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
      newestFrameTime = cachedFrames[cachedFrames.length - 1].time;
      available = Math.min(90, Math.max(0, (newestFrameTime - cachedFrames[0].time) / 1000));
    } else {
      const videoDeadline = Date.now() + 6000;
      while ((!directVideo || directVideo.readyState < 2 || !directVideo.videoWidth) && Date.now() < videoDeadline) {
        if (directVideo && isClipSource && directVideo.paused) directVideo.play().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 150));
        // Never replace an explicitly-created clip/replay source with the
        // visible page player while waiting for readiness. In particular,
        // replay uses an owned iframe rather than ownedClipVideo.
        if (!ownedClipVideo && !ownedReplayFrame) directVideo = locateDirectVideo();
        if (!initialDirectState && directVideo) initialDirectState = { time: directVideo.currentTime, paused: directVideo.paused, rate: directVideo.playbackRate, muted: directVideo.muted };
      }
      if (!directVideo || directVideo.readyState < 2) { showToast('클립·다시보기 영상을 찾지 못했습니다. 영상을 재생한 뒤 다시 시도해 주세요.'); return; }
      let sourceRange = null;
      while (!sourceRange && Date.now() < videoDeadline) {
        const seekable = getLiveSeekRange(directVideo);
        const duration = Number.isFinite(directVideo.duration) ? directVideo.duration : 0;
        sourceRange = seekable || (duration > 0 ? { start: 0, end: duration } : null);
        if (!sourceRange) {
          if (isClipSource && directVideo.paused) directVideo.play().catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      fullSourceRange = sourceRange;
      if (sourceRange && (isReplaySource || isClipSource || isYouTubeSource)) {
        const requestedAnchor = Number(options.captureAnchorTime);
        const capturePoint = Math.max(sourceRange.start, Math.min(sourceRange.end, Number.isFinite(requestedAnchor) ? requestedAnchor : directVideo.currentTime));
        const windowLength = Math.min(90, Math.max(0, sourceRange.end - sourceRange.start));
        const windowStart = Math.max(sourceRange.start, Math.min(sourceRange.end - windowLength, capturePoint - 45));
        directRange = { start: windowStart, end: windowStart + windowLength };
      } else directRange = sourceRange;
      if (playerLiveFallback && directRange) directRange = { start: Math.max(directRange.start, directRange.end - 90), end: directRange.end - 0.2 };
      if (!directRange) { showToast('영상의 탐색 가능 구간을 찾지 못했습니다.'); return; }
      available = Math.max(0, directRange.end - directRange.start);
    }
    if (available < 1) { serverLive?.dispose(); showToast('아직 사용할 수 있는 되감기 구간이 없습니다.'); return; }
    const isEditingResult = options.settingsMode === 'edit';
    const savedSettings = isEditingResult
      ? (options.initialSettings || options.editResult?.webpEditorSettings || (options.editResult && webpResultEditorSettings.get(options.editResult)) || null)
      : (options.initialSettings || webpEditorSessionSettings.get(settingsKey) || null);
    if (!isLiveSource && savedSettings && Number.isFinite(savedSettings.capturePoint) && fullSourceRange) {
      const windowLength = Math.min(90, fullSourceRange.end - fullSourceRange.start);
      const center = Math.max(fullSourceRange.start, Math.min(fullSourceRange.end, savedSettings.capturePoint));
      const windowStart = Math.max(fullSourceRange.start, Math.min(fullSourceRange.end - windowLength, center - windowLength / 2));
      directRange = { start: windowStart, end: windowStart + windowLength };
      available = directRange.end - directRange.start;
    }
    const directOriginal = !isLiveSource ? (initialDirectState || { time: directVideo.currentTime, paused: directVideo.paused, rate: directVideo.playbackRate, muted: directVideo.muted }) : null;
    if (!isLiveSource) directVideo.muted = true;
    const requestedAnchor = Number(savedSettings?.capturePoint ?? options.captureAnchorTime);
    const currentAgo = isLiveSource ? 0 : Math.max(0, directRange.end - (Number.isFinite(requestedAnchor) ? requestedAnchor : directVideo.currentTime));
    let initialEndAgo = isLiveSource ? 0 : Math.max(0, currentAgo - 2.5);
    let initialStartAgo = Math.min(available, isLiveSource ? 5 : currentAgo + 2.5);
    if (savedSettings) {
      const restoredEndAgo = Number(savedSettings.endAgo);
      const restoredStartAgo = Number(savedSettings.startAgo);
      initialEndAgo = Math.max(0, Math.min(available - .5, restoredEndAgo || 0));
      initialStartAgo = Math.max(initialEndAgo + .5, Math.min(available, restoredStartAgo || initialStartAgo));
    }
    const formatVideoTime = seconds => {
      const safe = Math.max(0, Number(seconds) || 0); const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60);
      const secondsText = `${String(Math.floor(safe % 60)).padStart(2, '0')}.${Math.floor((safe % 1) * 10)}`;
      if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
      if (minutes > 0) return `${minutes}:${secondsText}`;
      return secondsText;
    };

    const editor = document.createElement('div');
    editor.id = 'chzzk-webp-editor';
    editor.innerHTML = `
      <div class="chzzk-webp-dialog ${isEditingResult ? 'chzzk-webp-edit-mode' : ''}" role="dialog" aria-modal="true" aria-label="움직이는 WebP 만들기">
        <div class="chzzk-webp-head"><strong>${isEditingResult ? '움짤 편집' : '움짤 만들기'}</strong><div class="chzzk-webp-head-actions"><button type="button" data-webp-minimize hidden>최소화</button><button type="button" data-webp-close>×</button></div></div>
        <div class="chzzk-webp-preview-wrap"><div class="chzzk-webp-preview-stage"><canvas data-webp-preview></canvas><div class="chzzk-webp-crop" data-webp-crop><i data-handle="nw"></i><i data-handle="ne"></i><i data-handle="sw"></i><i data-handle="se"></i></div><div class="chzzk-webp-effect-region" data-effect-region-box hidden><i data-handle="nw"></i><i data-handle="ne"></i><i data-handle="sw"></i><i data-handle="se"></i></div></div></div>
        <div class="chzzk-webp-crop-resolution" data-crop-resolution></div>
        <div class="chzzk-webp-timebar">
          <div class="chzzk-webp-timeline-labels"><span>시작 <b data-start-label></b></span><span>선택 구간 <b data-duration-label></b></span><span>종료 <b data-end-label></b></span></div>
          <div class="chzzk-webp-dual-range">
            <div class="chzzk-webp-range-tooltip" data-range-tooltip></div>
            <div class="chzzk-webp-range-base"></div><div class="chzzk-webp-range-selection" data-range-selection title="잡아서 선택 구간 이동"></div><div class="chzzk-webp-playhead" data-webp-playhead></div>
            <input type="range" aria-label="시작 지점" data-webp-start min="0" max="${available.toFixed(1)}" step="0.1" value="${initialStartAgo.toFixed(1)}">
            <input type="range" aria-label="종료 지점" data-webp-end min="0" max="${available.toFixed(1)}" step="0.1" value="${initialEndAgo.toFixed(1)}">
          </div>
          <div class="chzzk-webp-timeline-scale"><span>${isEditingResult ? '0.0초' : (isLiveSource ? `-${available.toFixed(0)}초` : formatVideoTime(directRange.start))}</span><span>${isEditingResult ? `${(initialStartAgo - initialEndAgo).toFixed(1)}초` : (isLiveSource ? '현재' : formatVideoTime(directRange.end))}</span></div>
          <div class="chzzk-webp-segment-editor" data-effect-segment-editor ${isEditingResult ? '' : 'hidden'}><div class="chzzk-webp-segment-head"><small>분할 위치를 클릭하거나 선을 끌어 이동</small></div><div class="chzzk-webp-split-rail" data-effect-split-rail title="클릭한 위치에서 구간 나누기"><button type="button" data-effect-boundary-delete disabled title="선 삭제">×</button></div><div class="chzzk-webp-segment-track" data-effect-segment-track><span>블러·속도·클로즈업을 선택하세요.</span></div></div>
        </div>
        <div class="chzzk-webp-options">
          <label>출력 크기<select data-webp-width><option value="0">원본</option><option value="854" selected>854px</option><option value="640">640px</option><option value="480">480px</option></select></label>
          <label>프레임<select data-webp-fps>${isLiveSource ? '<option value="30" selected>30fps</option><option value="24">24fps</option><option value="20">20fps</option><option value="15">15fps</option><option value="10">10fps</option>' : '<option value="60">60fps</option><option value="30">30fps</option><option value="15" selected>15fps</option>'}</select></label>
          <small class="chzzk-webp-size-estimate" data-size-label></small>
          <button type="button" data-webp-reset>자르기 초기화</button>
        </div>
        <div class="chzzk-webp-effects" ${isEditingResult ? '' : 'hidden'}>
          <button type="button" data-effect-region="blur" data-effect-mode="blur">블러</button><label class="chzzk-effect-compact-slider"><input type="range" min="0" max="8" step="0.5" value="0" data-effect-blur><span>강도 <output data-effect-blur-value>0</output></span></label>
          <button type="button" data-effect-mode="speed">속도 구간</button><label class="chzzk-effect-compact-slider"><input type="range" min="0.25" max="4" step="0.05" value="1" data-effect-speed><span>속도 <output data-effect-speed-value>1×</output></span></label>
          <button type="button" data-effect-region="zoom" data-effect-mode="zoom">영역 클로즈업</button><span class="chzzk-webp-zoom-scale">배율 <output data-effect-zoom-value>1×</output></span>
          <label class="chzzk-animated-cutout-toggle">배경 제거 (시험)<input type="checkbox" role="switch" data-animated-cutout><span aria-hidden="true"></span></label><button type="button" data-cutout-solid aria-pressed="false">단색 제거</button>
        </div>
        <div class="chzzk-webp-color-effects" ${isEditingResult ? '' : 'hidden'}>
          <label>밝기 <input type="range" min="50" max="150" step="1" value="100" data-effect-brightness><output data-effect-brightness-value>100%</output></label>
          <label>대비 <input type="range" min="50" max="150" step="1" value="100" data-effect-contrast><output data-effect-contrast-value>100%</output></label>
          <label>채도 <input type="range" min="0" max="200" step="1" value="100" data-effect-saturation><output data-effect-saturation-value>100%</output></label>
          <button type="button" data-effect-reset>설정 초기화</button>
        </div>
        <p class="chzzk-webp-status" data-webp-status>${isEditingResult ? '효과를 선택하고 영역 또는 적용 구간을 조정하세요.' : '버튼을 누른 시점에 고정된 화면입니다. 테두리와 구간을 조정하세요.'}</p>
        <div class="chzzk-webp-actions">${isEditingResult && options.returnToMake ? '<button type="button" class="chzzk-webp-create-edit" data-webp-back-to-make>뒤로</button>' : isEditingResult ? '' : '<button type="button" class="chzzk-webp-create-edit" data-webp-create-edit>편집</button>'}<button type="button" data-webp-cancel>취소</button><button type="button" class="primary" data-webp-create>${isEditingResult ? '편집 적용' : 'WebP 만들기'}</button></div>
      </div>`;
    document.body.appendChild(editor);

    const canvas = editor.querySelector('[data-webp-preview]');
    const ctx = canvas.getContext('2d');
    canvas.width = serverLive ? serverLive.width : isLiveSource ? cachedFrames[0].width : directVideo.videoWidth;
    canvas.height = serverLive ? serverLive.height : isLiveSource ? cachedFrames[0].height : directVideo.videoHeight;
    const previewSavedCrop = isEditingResult ? (savedSettings?.crop || {}) : {}; const previewCrop = { x: Math.max(0, Math.min(.92, Number(previewSavedCrop.x) || 0)), y: Math.max(0, Math.min(.92, Number(previewSavedCrop.y) || 0)), w: Math.max(.08, Math.min(1, Number(previewSavedCrop.w) || 1)), h: Math.max(.08, Math.min(1, Number(previewSavedCrop.h) || 1)) }; previewCrop.w = Math.min(previewCrop.w, 1 - previewCrop.x); previewCrop.h = Math.min(previewCrop.h, 1 - previewCrop.y);
    const previewAspect = (canvas.width * previewCrop.w) / Math.max(1, canvas.height * previewCrop.h); canvas.parentElement.style.setProperty('--webp-video-ratio', `${canvas.width * previewCrop.w} / ${canvas.height * previewCrop.h}`);
    canvas.parentElement.style.setProperty('--webp-max-width', `${52 * previewAspect}vh`);
    const savedEffects = isEditingResult ? savedSettings?.effects : null;
    const estimateHistory = (await chrome.storage.local.get('webpEstimateRates')).webpEstimateRates || {};
    const cutoutToggle = editor.querySelector('[data-animated-cutout]');
    cutoutToggle.checked = Boolean(savedEffects?.cutout);
    let liveZoomPreviewRect = null;
    const effects = {
      cutout: Boolean(savedEffects?.cutout), cutoutMode: savedEffects?.cutoutMode || 'ai', cutoutPoint: {x:.5,y:.5},
      blur: Number(savedEffects?.blur) || 0,
      brightness: Number(savedEffects?.brightness) || 100,
      contrast: Number(savedEffects?.contrast) || 100,
      saturation: Number(savedEffects?.saturation) || 100,
      speed: Number(savedEffects?.speed) || 1,
      zoom: 1,
      blurStart: Number(savedEffects?.blurStart) || 0, blurEnd: Number(savedEffects?.blurEnd) || 1,
      speedStart: Number(savedEffects?.speedStart) || 0, speedEnd: Number(savedEffects?.speedEnd) || 1,
      zoomStart: Number(savedEffects?.zoomStart) || 0, zoomEnd: Number(savedEffects?.zoomEnd) || 1,
      blurRect: { x: 0, y: 0, w: 1, h: 1, ...(savedEffects?.blurRect || {}) },
      zoomRect: { x: 0, y: 0, w: 1, h: 1, ...(savedEffects?.zoomRect || {}) },
      centerX: Number.isFinite(Number(savedEffects?.centerX)) ? Number(savedEffects.centerX) : .5,
      centerY: Number.isFinite(Number(savedEffects?.centerY)) ? Number(savedEffects.centerY) : .5
    };
    cutoutToggle.addEventListener('change', () => { effects.cutout = cutoutToggle.checked; });
    const solidButton = editor.querySelector('[data-cutout-solid]');
    const syncSolid = () => { solidButton.disabled = !effects.cutout; solidButton.classList.toggle('active', effects.cutoutMode === 'solid'); solidButton.setAttribute('aria-pressed', String(effects.cutoutMode === 'solid')); };
    cutoutToggle.addEventListener('change', syncSolid);
    syncSolid();
    solidButton.addEventListener('click', () => { effects.cutoutMode = effects.cutoutMode === 'solid' ? 'ai' : 'solid'; effects.cutout = true; cutoutToggle.checked = true; syncSolid(); });
    editor.querySelector('[data-effect-reset]').addEventListener('click', () => { effects.cutoutMode = 'ai'; syncSolid(); });
    editor.querySelector('[data-effect-reset]').addEventListener('click', () => { effects.cutout=false;effects.cutoutPoint={x:.5,y:.5};cutoutToggle.checked=false;syncSolid(); });
    const cloneEffectRect = rect => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    const normalizeEffectSegments = (kind, saved) => Array.isArray(saved) && saved.length ? saved.map(segment => ({ ...segment, rect: segment.rect ? cloneEffectRect(segment.rect) : undefined })) : [{ start: 0, end: 1, value: kind === 'blur' ? effects.blur : kind === 'speed' ? effects.speed : 1, ...(kind === 'blur' ? { rect: cloneEffectRect(effects.blurRect) } : kind === 'zoom' ? { rect: cloneEffectRect(effects.zoomRect) } : {}) }];
    const effectSegments = { blur: normalizeEffectSegments('blur', savedEffects?.segments?.blur), speed: normalizeEffectSegments('speed', savedEffects?.segments?.speed), zoom: normalizeEffectSegments('zoom', savedEffects?.segments?.zoom) };
    const segmentAt = (kind, progress) => effectSegments[kind].find(segment => progress >= segment.start && (progress < segment.end || segment.end === 1)) || effectSegments[kind][effectSegments[kind].length - 1];
    const effectFilter = () => `brightness(${effects.brightness}%) contrast(${effects.contrast}%) saturate(${effects.saturation}%)`;
    const inEffectRange = (progress, prefix) => progress >= effects[`${prefix}Start`] && progress <= effects[`${prefix}End`];
    const scaledZoomRect = rect => ({ ...(rect || effects.zoomRect) });
    const mapFocusToBounds = (focus, boundsX, boundsY, boundsWidth, boundsHeight) => ({ x: (boundsX + focus.x * boundsWidth) / canvas.width, y: (boundsY + focus.y * boundsHeight) / canvas.height, w: focus.w * boundsWidth / canvas.width, h: focus.h * boundsHeight / canvas.height });
    const fitFocusRect = (focus, boundsX, boundsY, boundsWidth, boundsHeight, targetAspect) => {
      const centerX = (focus.x + focus.w / 2) * canvas.width; const centerY = (focus.y + focus.h / 2) * canvas.height;
      let width = Math.max(2, Math.min(boundsWidth, focus.w * canvas.width)); let height = Math.max(2, Math.min(boundsHeight, focus.h * canvas.height));
      if (width / height < targetAspect) width = Math.min(boundsWidth, height * targetAspect); else height = Math.min(boundsHeight, width / targetAspect);
      const x = Math.max(boundsX, Math.min(boundsX + boundsWidth - width, centerX - width / 2)); const y = Math.max(boundsY, Math.min(boundsY + boundsHeight - height, centerY - height / 2));
      return { x, y, width, height };
    };
    const drawEffectPreview = (source, progress = 0) => {
      const boundsX = previewCrop.x * canvas.width; const boundsY = previewCrop.y * canvas.height; const boundsWidth = previewCrop.w * canvas.width; const boundsHeight = previewCrop.h * canvas.height;
      const zoomSegment = segmentAt('zoom', progress); const zoomRect = liveZoomPreviewRect || zoomSegment?.rect; const focus = zoomRect ? fitFocusRect(mapFocusToBounds(scaledZoomRect(zoomRect), boundsX, boundsY, boundsWidth, boundsHeight), boundsX, boundsY, boundsWidth, boundsHeight, boundsWidth / boundsHeight) : { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight };
      const scaleX = (source.videoWidth || source.width) / canvas.width, scaleY = (source.videoHeight || source.height) / canvas.height;
      const sourceWidth = focus.width * scaleX; const sourceHeight = focus.height * scaleY; const sourceX = focus.x * scaleX; const sourceY = focus.y * scaleY;
      ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.filter = effectFilter();
      ctx.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height); ctx.restore();
      const blurSegment = segmentAt('blur', progress); if (blurSegment?.value > 0) { const rect = blurSegment.rect; const x = rect.x * canvas.width; const y = rect.y * canvas.height; const w = rect.w * canvas.width; const h = rect.h * canvas.height; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.filter = `${effectFilter()} blur(${blurSegment.value}px)`; ctx.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height); ctx.restore(); }
    };
    const bitmapCache = new Map();
    const pendingBitmaps = new Map();
    const previewProgress = ago => { const startInput = editor.querySelector('[data-webp-start]'); const endInput = editor.querySelector('[data-webp-end]'); const first = isEditingResult ? initialStartAgo : Number(startInput?.value ?? initialStartAgo); const last = isEditingResult ? initialEndAgo : Number(endInput?.value ?? initialEndAgo); return Math.max(0, Math.min(1, (first - Number(ago)) / Math.max(.001, first - last))); };
    const findCachedFrame = ago => {
      const target = newestFrameTime - Math.max(0, Math.min(available, ago)) * 1000;
      let low = 0; let high = cachedFrames.length - 1;
      while (low < high) { const middle = Math.floor((low + high) / 2); if (cachedFrames[middle].time < target) low = middle + 1; else high = middle; }
      if (low > 0 && Math.abs(cachedFrames[low - 1].time - target) < Math.abs(cachedFrames[low].time - target)) return { frame: cachedFrames[low - 1], index: low - 1 };
      return { frame: cachedFrames[low], index: low };
    };
    const getBitmap = async (frame, index) => {
      if (bitmapCache.has(index)) { const bitmap = bitmapCache.get(index); bitmapCache.delete(index); bitmapCache.set(index, bitmap); return bitmap; }
      if (pendingBitmaps.has(index)) return pendingBitmaps.get(index);
      const pending = createImageBitmap(frame.blob); pendingBitmaps.set(index, pending);
      const bitmap = await pending; pendingBitmaps.delete(index); bitmapCache.set(index, bitmap);
      if (bitmapCache.size > 90) { const oldest = bitmapCache.keys().next().value; bitmapCache.get(oldest)?.close(); bitmapCache.delete(oldest); }
      return bitmap;
    };
    let previewDrawSerial = 0;
    let serverPreviewBusy = false;
    let serverPreviewNext = null;
    const drawCachedPreview = async ago => {
      if (serverLive) {
        if (serverPreviewBusy) { serverPreviewNext = ago; return; }
        serverPreviewBusy = true;
        try { const bitmap = await serverLive.preview(ago); try { if (editor.isConnected) drawEffectPreview(bitmap, previewProgress(ago)); } finally { bitmap.close(); } }
        catch (error) { if (editor.isConnected && error.name !== 'AbortError') { const label = editor.querySelector('[data-webp-status]'); if (label) label.textContent = error.message; } }
        finally { serverPreviewBusy = false; if (serverPreviewNext !== null && editor.isConnected) { const next = serverPreviewNext; serverPreviewNext = null; void drawCachedPreview(next); } }
        return;
      }
      const serial = ++previewDrawSerial;
      if (!isLiveSource) {
        await waitForVideoSeek(directVideo, Math.max(directRange.start, Math.min(directRange.end, directRange.end - ago)));
        if (serial === previewDrawSerial && editor.isConnected) drawEffectPreview(directVideo, previewProgress(ago));
        return;
      }
      const { frame, index } = findCachedFrame(ago); const bitmap = await getBitmap(frame, index);
      if (serial !== previewDrawSerial || !editor.isConnected) return;
      drawEffectPreview(bitmap, previewProgress(ago));
    };
    const preloadCachedFrames = async ago => {
      if (!isLiveSource || serverLive) return;
      const { index } = findCachedFrame(ago);
      const jobs = [];
      for (let offset = 0; offset < 36 && index + offset < cachedFrames.length; offset += 1) {
        const frameIndex = index + offset;
        if (!bitmapCache.has(frameIndex)) jobs.push(getBitmap(cachedFrames[frameIndex], frameIndex));
      }
      await Promise.all(jobs);
    };
    if (serverLive) { if (visibleVideo?.readyState >= 2) drawEffectPreview(visibleVideo, 0); }
    else await drawCachedPreview(isLiveSource ? 0 : Math.max(0, directRange.end - directVideo.currentTime));
    const cropEl = editor.querySelector('[data-webp-crop]');
    const savedCrop = savedSettings?.crop || {};
    const crop = {
      x: Math.max(0, Math.min(.92, Number(savedCrop.x) || 0)), y: Math.max(0, Math.min(.92, Number(savedCrop.y) || 0)),
      w: Math.max(.08, Math.min(1, Number(savedCrop.w) || 1)), h: Math.max(.08, Math.min(1, Number(savedCrop.h) || 1))
    };
    crop.w = Math.min(crop.w, 1 - crop.x); crop.h = Math.min(crop.h, 1 - crop.y);
    const getOutputSize = (sourceWidth, sourceHeight) => {
      const limit = Number(editor.querySelector('[data-webp-width]')?.value) || 0;
      // Keep one scale based on the uncropped frame. Cropping should reduce the
      // output dimensions instead of scaling every new crop back up to the limit.
      const scale = limit > 0 ? Math.min(1, limit / Math.max(canvas.width, canvas.height)) : 1;
      return { width: Math.max(2, Math.round(sourceWidth * scale)), height: Math.max(2, Math.round(sourceHeight * scale)) };
    };
    const renderCrop = () => {
      cropEl.style.left = `${crop.x * 100}%`; cropEl.style.top = `${crop.y * 100}%`; cropEl.style.width = `${crop.w * 100}%`; cropEl.style.height = `${crop.h * 100}%`;
      const resolution = editor.querySelector('[data-crop-resolution]');
      if (resolution) {
        const cropWidth = Math.max(2, Math.round(crop.w * canvas.width)); const cropHeight = Math.max(2, Math.round(crop.h * canvas.height));
        const output = getOutputSize(cropWidth, cropHeight);
        resolution.textContent = `선택 영역 ${output.width} × ${output.height}`;
      }
    };
    renderCrop();
    let cropDrag = null;
    cropEl.addEventListener('pointerdown', event => {
      const bounds = cropEl.parentElement.getBoundingClientRect();
      cropDrag = { handle: event.target.dataset.handle || 'move', x: event.clientX, y: event.clientY, initial: { ...crop }, bounds };
      cropEl.setPointerCapture(event.pointerId); event.preventDefault();
    });
    cropEl.addEventListener('pointermove', event => {
      if (!cropDrag) return;
      const dx = (event.clientX - cropDrag.x) / cropDrag.bounds.width;
      const dy = (event.clientY - cropDrag.y) / cropDrag.bounds.height;
      const initial = cropDrag.initial;
      if (cropDrag.handle === 'move') {
        crop.x = Math.max(0, Math.min(1 - crop.w, initial.x + dx)); crop.y = Math.max(0, Math.min(1 - crop.h, initial.y + dy));
      } else {
        const west = cropDrag.handle.includes('w'); const north = cropDrag.handle.includes('n');
        const nextX = west ? Math.max(0, Math.min(initial.x + initial.w - .08, initial.x + dx)) : initial.x;
        const nextY = north ? Math.max(0, Math.min(initial.y + initial.h - .08, initial.y + dy)) : initial.y;
        const edgeX = west ? initial.x + initial.w : Math.max(initial.x + .08, Math.min(1, initial.x + initial.w + dx));
        const edgeY = north ? initial.y + initial.h : Math.max(initial.y + .08, Math.min(1, initial.y + initial.h + dy));
        crop.x = nextX; crop.y = nextY; crop.w = edgeX - nextX; crop.h = edgeY - nextY;
      }
      renderCrop();
    });
    const stopCropDrag = () => { cropDrag = null; updateRange(); };
    cropEl.addEventListener('pointerup', stopCropDrag); cropEl.addEventListener('pointercancel', stopCropDrag);

    const start = editor.querySelector('[data-webp-start]'); const end = editor.querySelector('[data-webp-end]');
    const editBaseStartAgo = initialStartAgo; const editBaseEndAgo = initialEndAgo; const editBaseDuration = Math.max(.5, editBaseStartAgo - editBaseEndAgo);
    if (isEditingResult) { start.min = end.min = String(editBaseEndAgo); start.max = end.max = String(editBaseStartAgo); start.value = String(editBaseStartAgo); end.value = String(editBaseEndAgo); }
    const timelineMaxAgo = isEditingResult ? editBaseStartAgo : available; const timelineMinAgo = isEditingResult ? editBaseEndAgo : 0; const timelineSpan = Math.max(.001, timelineMaxAgo - timelineMinAgo); const timelinePercent = ago => ((timelineMaxAgo - Number(ago)) / timelineSpan) * 100;
    const startLabel = editor.querySelector('[data-start-label]'); const endLabel = editor.querySelector('[data-end-label]');
    const durationLabel = editor.querySelector('[data-duration-label]'); const sizeLabel = editor.querySelector('[data-size-label]'); const rangeSelection = editor.querySelector('[data-range-selection]');
    if (isEditingResult) sizeLabel.hidden = true;
    const status = editor.querySelector('[data-webp-status]'); const create = editor.querySelector('[data-webp-create]');
    const timeline = editor.querySelector('.chzzk-webp-dual-range'); const playhead = editor.querySelector('[data-webp-playhead]'); if (isEditingResult) timeline.classList.add('effect-range-locked');
    const rangeTooltip = editor.querySelector('[data-range-tooltip]');
    const widthSelect = editor.querySelector('[data-webp-width]'); const fpsSelect = editor.querySelector('[data-webp-fps]');
    if (serverLive?.fps >= 50) fpsSelect.insertAdjacentHTML('afterbegin', '<option value="60">60fps</option>');
    if (savedSettings?.width && widthSelect?.querySelector(`option[value="${CSS.escape(String(savedSettings.width))}"]`)) widthSelect.value = String(savedSettings.width);
    if (savedSettings?.fps && fpsSelect?.querySelector(`option[value="${CSS.escape(String(savedSettings.fps))}"]`)) fpsSelect.value = String(savedSettings.fps);
    const effectInputs = {
      blur: editor.querySelector('[data-effect-blur]'), brightness: editor.querySelector('[data-effect-brightness]'),
      contrast: editor.querySelector('[data-effect-contrast]'), saturation: editor.querySelector('[data-effect-saturation]'),
      speed: editor.querySelector('[data-effect-speed]'),
      speedStart: editor.querySelector('[data-effect-speed-start]'), speedEnd: editor.querySelector('[data-effect-speed-end]'),
      zoomStart: editor.querySelector('[data-effect-zoom-start]'), zoomEnd: editor.querySelector('[data-effect-zoom-end]')
    };
    const percentEffectKeys = new Set(['speedStart','speedEnd','zoomStart','zoomEnd']);
    Object.entries(effectInputs).forEach(([key, input]) => { if (input) input.value = String(percentEffectKeys.has(key) ? effects[key] * 100 : effects[key]); });
    const effectSnapshot = () => ({ ...effects, blurRect: { ...effects.blurRect }, zoomRect: { ...effects.zoomRect } });
    const applyEffectSnapshot = snapshot => { Object.assign(effects, snapshot); Object.entries(effectInputs).forEach(([key, input]) => { if (input) input.value = String(percentEffectKeys.has(key) ? effects[key] * 100 : effects[key]); }); updateEffectLabels(); renderEffectRegion(); if (!previewing) drawCachedPreview(Number(start.value)); updateRange(); };
    const updateEffectLabels = () => {
      ['blur','brightness','contrast','saturation'].forEach(key => { const output = editor.querySelector(`[data-effect-${key}-value]`); if (output) output.textContent = key === 'blur' ? `${effects[key]}px` : `${effects[key]}%`; });
      const speedOutput = editor.querySelector('[data-effect-speed-value]'); if (speedOutput) speedOutput.textContent = `${effects.speed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`;
      const zoomOutput = editor.querySelector('[data-effect-zoom-value]'); if (zoomOutput) { const selectionScale = Math.max(1 / Math.max(.001, effects.zoomRect.w), 1 / Math.max(.001, effects.zoomRect.h)); zoomOutput.textContent = `${selectionScale.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`; }
    };
    let activeEffectRegion = null; let activeEffectMode = null; let activeEffectSegment = 0; let activeBoundaryIndex = null; const effectRegionBox = editor.querySelector('[data-effect-region-box]'); let effectRegionDrag = null;
    const segmentTrack = editor.querySelector('[data-effect-segment-track]'); const splitRail = editor.querySelector('[data-effect-split-rail]'); const boundaryDelete = editor.querySelector('[data-effect-boundary-delete]');
    const effectPointStep = .1 / Math.max(.1, editBaseDuration);
    const snapEffectPoint = point => Math.round(point / effectPointStep) * effectPointStep;
    const saveActiveEffectSegment = () => { if (!activeEffectMode) return; const segment = effectSegments[activeEffectMode]?.[activeEffectSegment]; if (!segment) return; if (activeEffectMode === 'blur') { segment.value = effects.blur; segment.rect = cloneEffectRect(effects.blurRect); } else if (activeEffectMode === 'speed') segment.value = effects.speed; else if (activeEffectMode === 'zoom') segment.rect = cloneEffectRect(effects.zoomRect); };
    const loadActiveEffectSegment = () => { const segment = effectSegments[activeEffectMode]?.[activeEffectSegment]; if (!segment) return; if (activeEffectMode === 'blur') { effects.blur = segment.value; effects.blurRect = segment.rect; } else if (activeEffectMode === 'speed') effects.speed = segment.value; else if (activeEffectMode === 'zoom') effects.zoomRect = segment.rect; Object.entries(effectInputs).forEach(([key, input]) => { if (input) input.value = String(percentEffectKeys.has(key) ? effects[key] * 100 : effects[key]); }); updateEffectLabels(); renderEffectRegion(); };
    const renderEffectSegments = () => {
      if (!segmentTrack || !activeEffectMode) { if (segmentTrack) segmentTrack.innerHTML = '<span>블러·속도·클로즈업을 선택하세요.</span>'; return; }
      segmentTrack.innerHTML = ''; splitRail.querySelectorAll('.chzzk-webp-boundary').forEach(item => item.remove());
      effectSegments[activeEffectMode].forEach((segment, index) => { const item = document.createElement('button'); item.type = 'button'; item.className = `chzzk-webp-segment ${index === activeEffectSegment ? 'active' : ''}`; item.style.left = `${segment.start * 100}%`; item.style.width = `${(segment.end - segment.start) * 100}%`; item.title = `${(segment.start * editBaseDuration).toFixed(1)}~${(segment.end * editBaseDuration).toFixed(1)}초`; item.addEventListener('click', event => { event.stopPropagation(); saveActiveEffectSegment(); activeEffectSegment = index; activeBoundaryIndex = null; loadActiveEffectSegment(); renderEffectSegments(); }); segmentTrack.appendChild(item); });
      const markers = []; Object.entries(effectSegments).forEach(([kind, list]) => list.slice(1).forEach((segment, index) => markers.push({ kind, index: index + 1, point: segment.start }))); markers.sort((a, b) => a.point - b.point).forEach(marker => { const line = document.createElement('i'); const own = marker.kind === activeEffectMode; const timeText = `${(marker.point * editBaseDuration).toFixed(1)}초`; line.className = `chzzk-webp-boundary ${own ? 'own' : 'ghost'} ${own && marker.index === activeBoundaryIndex ? 'selected' : ''}`; line.dataset.effectKind = marker.kind; line.dataset.time = timeText; line.style.left = `${marker.point * 100}%`; line.title = `${marker.kind} ${timeText}${own ? ' · 끌어서 이동' : ''}`; if (own) { line.addEventListener('pointerdown', event => { event.stopPropagation(); activeBoundaryIndex = marker.index; boundaryDelete.disabled = false; boundaryDelete.style.left = line.style.left; splitRail.querySelectorAll('.chzzk-webp-boundary').forEach(item => item.classList.remove('selected')); line.classList.add('selected'); line.setPointerCapture(event.pointerId); line.dataset.dragging = '1'; }); line.addEventListener('pointermove', event => { if (line.dataset.dragging !== '1') return; const bounds = splitRail.getBoundingClientRect(); const list = effectSegments[activeEffectMode]; const rawPoint = (event.clientX - bounds.left) / Math.max(1, bounds.width); const point = Math.max(list[marker.index - 1].start + effectPointStep, Math.min(list[marker.index].end - effectPointStep, snapEffectPoint(rawPoint))); list[marker.index - 1].end = point; list[marker.index].start = point; const timeText = `${(point * editBaseDuration).toFixed(1)}초`; line.style.left = `${point * 100}%`; line.dataset.time = timeText; line.title = `${marker.kind} ${timeText} · 끌어서 이동`; boundaryDelete.style.left = line.style.left; const items = segmentTrack.querySelectorAll('.chzzk-webp-segment'); const left = items[marker.index - 1]; const right = items[marker.index]; if (left) left.style.width = `${(point - list[marker.index - 1].start) * 100}%`; if (right) { right.style.left = `${point * 100}%`; right.style.width = `${(list[marker.index].end - point) * 100}%`; } }); line.addEventListener('pointerup', event => { line.dataset.dragging = ''; try { line.releasePointerCapture(event.pointerId); } catch (_) {} renderEffectSegments(); }); line.addEventListener('pointercancel', () => { line.dataset.dragging = ''; renderEffectSegments(); }); } splitRail.appendChild(line); }); boundaryDelete.disabled = activeBoundaryIndex === null; if (activeBoundaryIndex !== null) boundaryDelete.style.left = `${effectSegments[activeEffectMode][activeBoundaryIndex].start * 100}%`;
    };
    const activateEffectSegments = mode => { saveActiveEffectSegment(); activeEffectMode = mode; activeEffectSegment = 0; activeBoundaryIndex = null; activeEffectRegion = mode === 'blur' || mode === 'zoom' ? mode : null; timeline.classList.remove('effect-range-locked'); editor.querySelectorAll('[data-effect-mode]').forEach(item => item.classList.toggle('active', item.dataset.effectMode === mode)); editor.querySelectorAll('[data-effect-region]').forEach(item => item.classList.toggle('active', item.dataset.effectRegion === activeEffectRegion)); if (effectInputs.blur) effectInputs.blur.disabled = mode !== 'blur'; if (effectInputs.speed) effectInputs.speed.disabled = mode !== 'speed'; loadActiveEffectSegment(); renderEffectSegments(); };
    splitRail?.addEventListener('click', event => { if (!activeEffectMode || event.target !== splitRail) return; const bounds = splitRail.getBoundingClientRect(); const point = Math.max(effectPointStep, Math.min(1 - effectPointStep, snapEffectPoint((event.clientX - bounds.left) / Math.max(1, bounds.width)))); const list = effectSegments[activeEffectMode]; const index = list.findIndex(segment => point >= segment.start + effectPointStep && point <= segment.end - effectPointStep); if (index < 0) return; saveActiveEffectSegment(); const source = list[index]; const right = { ...source, start: point, rect: source.rect ? cloneEffectRect(source.rect) : undefined }; source.end = point; list.splice(index + 1, 0, right); activeEffectSegment = index + 1; activeBoundaryIndex = index + 1; loadActiveEffectSegment(); renderEffectSegments(); });
    boundaryDelete?.addEventListener('click', () => { if (!activeEffectMode || activeBoundaryIndex === null) return; const list = effectSegments[activeEffectMode]; const index = activeBoundaryIndex; if (index <= 0 || index >= list.length) return; saveActiveEffectSegment(); list[index - 1].end = list[index].end; list.splice(index, 1); activeEffectSegment = Math.min(index - 1, list.length - 1); activeBoundaryIndex = null; loadActiveEffectSegment(); renderEffectSegments(); });
    Object.entries(effectInputs).forEach(([key, input]) => {
      if (!input) return;
      input.addEventListener('input', () => { effects[key] = Number(input.value) / (percentEffectKeys.has(key) ? 100 : 1); if (key.endsWith('Start')) effects[key] = Math.min(effects[key], effects[key.replace('Start','End')]); if (key.endsWith('End')) effects[key] = Math.max(effects[key], effects[key.replace('End','Start')]); saveActiveEffectSegment(); updateEffectLabels(); if (!previewing) drawCachedPreview(Number(start.value)); updateRange(); });
      input.addEventListener('wheel', event => { event.preventDefault(); const step = Number(input.step) || 1; const minimum = Number(input.min); const maximum = Number(input.max); const next = Math.max(minimum, Math.min(maximum, Number(input.value) + (event.deltaY < 0 ? step : -step))); if (next === Number(input.value)) return; input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, { passive: false });
    });
    const renderEffectRegion = () => { if (!activeEffectRegion) { effectRegionBox.hidden = true; return; } const rect = effects[`${activeEffectRegion}Rect`]; effectRegionBox.hidden = false; effectRegionBox.style.left = `${rect.x * 100}%`; effectRegionBox.style.top = `${rect.y * 100}%`; effectRegionBox.style.width = `${rect.w * 100}%`; effectRegionBox.style.height = `${rect.h * 100}%`; };
    const showEffectRange = mode => { activeEffectMode = mode; timeline.classList.remove('effect-range-locked'); const prefix = mode; start.value = String(editBaseStartAgo - effects[`${prefix}Start`] * editBaseDuration); end.value = String(editBaseStartAgo - effects[`${prefix}End`] * editBaseDuration); updateRange(); editor.querySelectorAll('[data-effect-mode]').forEach(item => item.classList.toggle('active', item.dataset.effectMode === mode)); };
    editor.querySelectorAll('[data-effect-region]').forEach(button => button.addEventListener('click', () => activateEffectSegments(button.dataset.effectMode)));
    editor.querySelectorAll('[data-effect-mode]').forEach(button => { if (button.dataset.effectRegion) return; button.addEventListener('click', () => activateEffectSegments(button.dataset.effectMode)); });
    effectRegionBox.addEventListener('pointerdown', event => { const rect = effects[`${activeEffectRegion}Rect`]; effectRegionDrag = { pointerId: event.pointerId, handle: event.target.dataset.handle || 'move', x: event.clientX, y: event.clientY, initial: { ...rect }, bounds: effectRegionBox.parentElement.getBoundingClientRect() }; effectRegionBox.setPointerCapture(event.pointerId); event.preventDefault(); });
    effectRegionBox.addEventListener('pointermove', event => { if (!effectRegionDrag || effectRegionDrag.pointerId !== event.pointerId) return; const dx = (event.clientX - effectRegionDrag.x) / effectRegionDrag.bounds.width; const dy = (event.clientY - effectRegionDrag.y) / effectRegionDrag.bounds.height; const initial = effectRegionDrag.initial; const rect = effects[`${activeEffectRegion}Rect`]; if (effectRegionDrag.handle === 'move') { rect.x = Math.max(0, Math.min(1 - rect.w, initial.x + dx)); rect.y = Math.max(0, Math.min(1 - rect.h, initial.y + dy)); } else { const west = effectRegionDrag.handle.includes('w'); const north = effectRegionDrag.handle.includes('n'); const nextX = west ? Math.max(0, Math.min(initial.x + initial.w - .05, initial.x + dx)) : initial.x; const nextY = north ? Math.max(0, Math.min(initial.y + initial.h - .05, initial.y + dy)) : initial.y; const edgeX = west ? initial.x + initial.w : Math.max(initial.x + .05, Math.min(1, initial.x + initial.w + dx)); const edgeY = north ? initial.y + initial.h : Math.max(initial.y + .05, Math.min(1, initial.y + initial.h + dy)); Object.assign(rect, { x: nextX, y: nextY, w: edgeX - nextX, h: edgeY - nextY }); if (activeEffectRegion === 'zoom') { const requiredRatio = 1; if (rect.w / rect.h > requiredRatio) rect.w = rect.h * requiredRatio; else rect.h = rect.w / requiredRatio; rect.w = Math.min(rect.w, 1); rect.h = Math.min(rect.h, 1); rect.x = Math.max(0, Math.min(1 - rect.w, rect.x)); rect.y = Math.max(0, Math.min(1 - rect.h, rect.y)); } } if (activeEffectRegion === 'zoom') liveZoomPreviewRect = rect; renderEffectRegion(); updateEffectLabels(); if (!previewing) drawCachedPreview(Number(start.value)); });
    const stopEffectRegionDrag = () => { if (!effectRegionDrag) return; effectRegionDrag = null; saveActiveEffectSegment(); liveZoomPreviewRect = null; updateEffectLabels(); };
    effectRegionBox.addEventListener('pointerup', stopEffectRegionDrag); effectRegionBox.addEventListener('pointercancel', stopEffectRegionDrag);
    editor.querySelector('[data-effect-reset]').addEventListener('click', () => { applyEffectSnapshot({ blur: 0, brightness: 100, contrast: 100, saturation: 100, speed: 1, zoom: 1, blurStart: 0, blurEnd: 1, speedStart: 0, speedEnd: 1, zoomStart: 0, zoomEnd: 1, blurRect: { x: 0, y: 0, w: 1, h: 1 }, zoomRect: { x: 0, y: 0, w: 1, h: 1 }, centerX: .5, centerY: .5 }); effectSegments.blur = normalizeEffectSegments('blur'); effectSegments.speed = normalizeEffectSegments('speed'); effectSegments.zoom = normalizeEffectSegments('zoom'); activeEffectSegment = 0; if (activeEffectMode) loadActiveEffectSegment(); renderEffectSegments(); });
    updateEffectLabels();
    renderCrop();
    const getEditorSettings = () => ({
      startAgo: isEditingResult ? editBaseStartAgo : Number(start.value), endAgo: isEditingResult ? editBaseEndAgo : Number(end.value),
      liveSnapshot: serverLive?.snapshot,
      capturePoint: isLiveSource ? null : (savedSettings?.capturePoint ?? options.captureAnchorTime ?? directOriginal?.time ?? directVideo.currentTime),
      crop: { ...crop }, width: widthSelect?.value || '0', fps: Number(fpsSelect?.value || (isLiveSource ? 30 : 15)), ...(isEditingResult ? { effects: { ...effects, blurRect: { ...effects.blurRect }, zoomRect: { ...effects.zoomRect }, segments: { blur: effectSegments.blur.map(segment => ({ ...segment, rect: cloneEffectRect(segment.rect) })), speed: effectSegments.speed.map(segment => ({ ...segment })), zoom: effectSegments.zoom.map(segment => ({ ...segment, rect: cloneEffectRect(segment.rect) })) } } } : {})
    });
    const retainLiveSelection = () => serverLive?.retain(isEditingResult ? editBaseStartAgo : Number(start.value), isEditingResult ? editBaseEndAgo : Number(end.value)).catch(error => showToast(`구간 임시 보관 실패: ${error.message}`));
    const saveEditorSettings = (reason = 'close') => { const settings = getEditorSettings(); retainLiveSelection(); if (isEditingResult) { if (reason === 'generated') { if (options.editResult) { options.editResult.webpEditorSettings = settings; webpResultEditorSettings.set(options.editResult, settings); } options.onSettingsSaved?.({ ...settings, crop: { ...settings.crop } }, reason); } } else { webpEditorSessionSettings.set(settingsKey, settings); options.onSettingsSaved?.({ ...settings, crop: { ...settings.crop } }, reason); } return settings; };
    let previewing = false; let previewAnimation = 0; let rangePreviewTimer = 0; let previewStartedAt = 0; let previewStartAgo = 0; let previewCurrentAgo = 0; let previewLastTick = 0; let lastPrefetchAt = 0; let lastPreviewDrawAt = 0;
    const useVideoFrameClock = !isLiveSource && typeof directVideo.requestVideoFrameCallback === 'function' && typeof directVideo.cancelVideoFrameCallback === 'function';
    let previewRun = 0; let lastDirectFrameTime = -Infinity;
    const stopPreview = () => { previewing = false; previewRun += 1; if (useVideoFrameClock) directVideo.cancelVideoFrameCallback(previewAnimation); else cancelAnimationFrame(previewAnimation); previewAnimation = 0; if (!isLiveSource) directVideo.pause(); };
    const schedulePreview = () => { previewAnimation = useVideoFrameClock ? directVideo.requestVideoFrameCallback(previewLoop) : requestAnimationFrame(previewLoop); };
    const previewLoop = (_timestamp, metadata) => {
      if (!previewing) return;
      const now = performance.now(); let currentAgo;
      if (isLiveSource) { const progress = previewProgress(previewCurrentAgo); const speed = segmentAt('speed', progress)?.value || 1; previewCurrentAgo -= ((now - previewLastTick) / 1000) * speed; previewLastTick = now; currentAgo = previewCurrentAgo; }
      else { currentAgo = directRange.end - (metadata?.mediaTime ?? directVideo.currentTime); const rate = segmentAt('speed', previewProgress(currentAgo))?.value || 1; if (directVideo.playbackRate !== rate) directVideo.playbackRate = rate; }
      const loopStartAgo = isEditingResult ? editBaseStartAgo : Number(start.value); const loopEndAgo = isEditingResult ? editBaseEndAgo : Number(end.value);
      if (currentAgo <= loopEndAgo) {
        currentAgo = loopStartAgo; previewStartAgo = currentAgo; previewCurrentAgo = currentAgo; previewStartedAt = performance.now(); previewLastTick = previewStartedAt;
        if (!isLiveSource) {
          if (!directVideo.seeking) { directVideo.currentTime = directRange.end - currentAgo; directVideo.play().catch(() => {}); }
          lastDirectFrameTime = -Infinity; schedulePreview(); return;
        }
      }
      if (isLiveSource) {
        if (performance.now() - lastPreviewDrawAt >= (serverLive ? 1000 / Math.min(60, serverLive.fps) - 2 : 32)) { lastPreviewDrawAt = performance.now(); drawCachedPreview(currentAgo); }
        if (performance.now() - lastPrefetchAt > 900) { lastPrefetchAt = performance.now(); preloadCachedFrames(currentAgo).catch(() => {}); }
      } else if (directVideo.readyState >= 2 && !directVideo.seeking) {
        const frameTime = metadata?.mediaTime ?? directVideo.currentTime;
        if (frameTime !== lastDirectFrameTime) { drawEffectPreview(directVideo, previewProgress(currentAgo)); lastDirectFrameTime = frameTime; }
      }
      playhead.style.left = `${timelinePercent(currentAgo)}%`; playhead.style.display = 'block';
      schedulePreview();
    };
    const startPreview = async (ago = Number(start.value)) => {
      retainLiveSelection();
      stopPreview(); clearTimeout(rangePreviewTimer);
      const run = previewRun;
      const loopStartAgo = isEditingResult ? editBaseStartAgo : Number(start.value); const loopEndAgo = isEditingResult ? editBaseEndAgo : Number(end.value); const boundedAgo = Math.max(loopEndAgo, Math.min(loopStartAgo, Number(ago)));
      try {
        await preloadCachedFrames(boundedAgo); await drawCachedPreview(boundedAgo);
        if (run !== previewRun || !editor.isConnected) return;
        previewing = true; previewStartAgo = boundedAgo; previewCurrentAgo = boundedAgo; previewStartedAt = performance.now(); previewLastTick = previewStartedAt;
        if (!isLiveSource) { directVideo.muted = true; directVideo.playbackRate = effects.speed; await directVideo.play(); }
        if (run !== previewRun || !editor.isConnected) return;
        lastDirectFrameTime = -Infinity;
        status.textContent = '선택 구간을 재생 중입니다.'; schedulePreview();
      } catch (error) { if (run !== previewRun) return; stopPreview(); status.textContent = `미리보기 실패: ${error.message || error}`; }
    };
    const updateRange = changed => {
      if (changed === start && Number(start.value) < Number(end.value) + .5) start.value = String(Math.min(available, Number(end.value) + .5));
      if (changed === end && Number(end.value) > Number(start.value) - .5) end.value = String(Math.max(0, Number(start.value) - .5));
      if (isEditingResult && activeEffectMode && changed) {
        effects[`${activeEffectMode}Start`] = Math.max(0, Math.min(1, (editBaseStartAgo - Number(start.value)) / editBaseDuration));
        effects[`${activeEffectMode}End`] = Math.max(effects[`${activeEffectMode}Start`], Math.min(1, (editBaseStartAgo - Number(end.value)) / editBaseDuration));
      }
      const formatPoint = ago => {
        if (isLiveSource) return `${Number(ago).toFixed(1)}초 전`;
        return formatVideoTime(directRange.end - Number(ago));
      };
      startLabel.textContent = formatPoint(start.value); endLabel.textContent = formatPoint(end.value);
      const selectedDuration = Number(start.value) - Number(end.value);
      durationLabel.textContent = `${selectedDuration.toFixed(1)}초`;
      rangeTooltip.textContent = `${startLabel.textContent}~${endLabel.textContent} (${durationLabel.textContent})`;
      const cropWidth = Math.max(2, Math.round(crop.w * canvas.width));
      const cropHeight = Math.max(2, Math.round(crop.h * canvas.height));
      const estimateSize = getOutputSize(cropWidth, cropHeight); const estimateWidth = estimateSize.width; const estimateHeight = estimateSize.height;
      const estimateFps = Number(editor.querySelector('[data-webp-fps]')?.value || (isLiveSource ? 30 : 15));
      const estimateDuration = isEditingResult ? initialStartAgo - initialEndAgo : selectedDuration;
      const estimateFrameCount = Math.max(2, Math.ceil(estimateDuration * estimateFps));
      const estimatePixels = estimateWidth * estimateHeight * estimateFrameCount;
      const rate = estimateHistory[effects.cutout ? 'cutout' : 'normal'];
      const lowMb = estimatePixels * (rate ? rate * .65 : .08) / 1024 / 1024; const highMb = estimatePixels * (rate ? rate * 1.4 : .35) / 1024 / 1024;
      sizeLabel.textContent = `예상 ${lowMb.toFixed(1)}~${highMb.toFixed(1)}MB${rate ? ' · 이전 결과 기준' : ''}`;
      sizeLabel.title = '실제 압축 결과로 보정한 참고 범위입니다. 배경·효과·중복 프레임에 따라 달라집니다. 속도 변경은 프레임 수를 줄이지 않습니다.';
      rangeSelection.style.left = `${timelinePercent(start.value)}%`;
      rangeSelection.style.width = `${((Number(start.value) - Number(end.value)) / timelineSpan) * 100}%`;
      if (changed) {
        if (!isEditingResult) { clearTimeout(rangePreviewTimer); stopPreview(); drawCachedPreview(Number(changed.value)); }
        else if (!previewing) drawCachedPreview(Number(changed.value));
        playhead.style.left = `${timelinePercent(changed.value)}%`; playhead.style.display = 'block';
      }
    };
    let heldRangeHandle = null;
    let releasedRangeHandle = null;
    const agoAtPointer = event => {
      const rect = timeline.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      return timelineMaxAgo - timelineSpan * ratio;
    };
    start.addEventListener('input', () => updateRange(start)); end.addEventListener('input', () => updateRange(end));
    start.addEventListener('change', () => { if (releasedRangeHandle === start) { releasedRangeHandle = null; return; } clearTimeout(rangePreviewTimer); if (!isEditingResult || !previewing) startPreview(isEditingResult ? editBaseStartAgo : Number(start.value)); });
    end.addEventListener('change', () => { if (releasedRangeHandle === end) { releasedRangeHandle = null; return; } clearTimeout(rangePreviewTimer); if (!isEditingResult || !previewing) startPreview(isEditingResult ? editBaseStartAgo : Number(end.value)); });
    const bindRangeHandle = input => {
      let pointerId = null;
      input.addEventListener('pointerdown', event => { pointerId = event.pointerId; heldRangeHandle = input; try { input.setPointerCapture(pointerId); } catch (_) {} input.value = String(agoAtPointer(event)); updateRange(input); event.preventDefault(); }, true);
      input.addEventListener('pointermove', event => { if (pointerId !== event.pointerId) return; input.value = String(agoAtPointer(event)); updateRange(input); event.preventDefault(); }, true);
      const release = event => { if (pointerId === event.pointerId) pointerId = null; };
      input.addEventListener('pointerup', release, true); input.addEventListener('pointercancel', release, true);
    };
    bindRangeHandle(start); bindRangeHandle(end);
    const resumeAfterRangeRelease = () => {
      if (!heldRangeHandle || !editor.isConnected || editor.classList.contains('chzzk-webp-busy')) { heldRangeHandle = null; return; }
      const releasedHandle = heldRangeHandle; heldRangeHandle = null; releasedRangeHandle = releasedHandle; clearTimeout(rangePreviewTimer); if (!isEditingResult || !previewing) startPreview(isEditingResult ? editBaseStartAgo : Number(releasedHandle.value));
      setTimeout(() => { if (releasedRangeHandle === releasedHandle) releasedRangeHandle = null; }, 0);
    };
    document.addEventListener('pointerup', resumeAfterRangeRelease, true); document.addEventListener('pointercancel', resumeAfterRangeRelease, true);
    updateRange();
    editor.querySelector('[data-webp-width]')?.addEventListener('change', () => { renderCrop(); updateRange(); });
    editor.querySelector('[data-webp-fps]')?.addEventListener('change', () => updateRange());
    timeline.addEventListener('pointerenter', () => { rangeTooltip.style.display = 'block'; });
    timeline.addEventListener('pointermove', event => { const rect = timeline.getBoundingClientRect(); rangeTooltip.style.left = `${Math.max(48, Math.min(rect.width - 48, event.clientX - rect.left))}px`; });
    timeline.addEventListener('pointerleave', () => { rangeTooltip.style.display = 'none'; });
    let selectionDrag = null;
    rangeSelection.addEventListener('pointerdown', event => {
      selectionDrag = { x: event.clientX, start: Number(start.value), end: Number(end.value), width: timeline.getBoundingClientRect().width, moved: false, activated: false };
      rangeSelection.setPointerCapture(event.pointerId); rangeSelection.classList.add('dragging'); if (!isEditingResult) stopPreview(); event.preventDefault(); event.stopPropagation();
    });
    rangeSelection.addEventListener('pointermove', event => {
      if (!selectionDrag) return;
      if (!selectionDrag.activated) {
        if (Math.abs(event.clientX - selectionDrag.x) < 9) return;
        selectionDrag.activated = true; selectionDrag.moved = true; selectionDrag.x = event.clientX;
        selectionDrag.start = Number(start.value); selectionDrag.end = Number(end.value);
        return;
      }
      const duration = selectionDrag.start - selectionDrag.end;
      let nextStart = selectionDrag.start - ((event.clientX - selectionDrag.x) / selectionDrag.width) * timelineSpan;
      nextStart = Math.max(timelineMinAgo + duration, Math.min(timelineMaxAgo, nextStart));
      start.value = String(nextStart); end.value = String(nextStart - duration); updateRange(start);
      if (!previewing) drawCachedPreview(Number(start.value));
      playhead.style.left = `${timelinePercent(start.value)}%`; playhead.style.display = 'block';
    });
    const stopSelectionDrag = event => {
      if (!selectionDrag) return;
      const wasClick = !selectionDrag.moved; selectionDrag = null; rangeSelection.classList.remove('dragging');
      if (wasClick && event?.type === 'pointerup') {
        const rect = rangeSelection.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        startPreview(Number(start.value) - ratio * (Number(start.value) - Number(end.value)));
      } else if (!isEditingResult || !previewing) startPreview(isEditingResult ? editBaseStartAgo : Number(start.value));
    };
    rangeSelection.addEventListener('pointerup', stopSelectionDrag); rangeSelection.addEventListener('pointercancel', stopSelectionDrag);
    timeline.addEventListener('pointerdown', event => {
      if (event.target === start || event.target === end) return;
      startPreview(agoAtPointer(event)); event.preventDefault();
    });
    rangePreviewTimer = setTimeout(() => startPreview(Number(start.value)), 120);
    const draftModal = options.draftModal || document.getElementById('chzzk-toolkit-gallery-modal') || document.getElementById('yt-chzzk-draft-modal-overlay');
    const draftCaptureBar = draftModal?.querySelector('#yt-draft-capture-timeline,#chzzk-still-timeline') || document.getElementById('yt-draft-capture-timeline') || document.getElementById('chzzk-still-timeline');
    const completedWebpPreview = draftModal?.querySelector('#chzzk-gallery-preview-image,.yt-draft-preview-img') || null;
    const completedWebpPreviewSrc = completedWebpPreview?.getAttribute('src') || '';
    let completedWebpFrozenSrc = '';
    const shouldFreezeCompletedWebp = Boolean(options.editResult?.animated || options.draftPreviewAnimated || /^data:image\/webp(?:;|,)/i.test(completedWebpPreviewSrc));
    if (completedWebpPreview && shouldFreezeCompletedWebp && completedWebpPreviewSrc) {
      try {
        const frozenCanvas = document.createElement('canvas'); frozenCanvas.width = completedWebpPreview.naturalWidth || options.editResult.width || 1; frozenCanvas.height = completedWebpPreview.naturalHeight || options.editResult.height || 1;
        frozenCanvas.getContext('2d').drawImage(completedWebpPreview, 0, 0, frozenCanvas.width, frozenCanvas.height); completedWebpFrozenSrc = frozenCanvas.toDataURL('image/png'); completedWebpPreview.src = completedWebpFrozenSrc;
      } catch (_) { completedWebpPreview.removeAttribute('src'); }
    }
    const minimizeButton = editor.querySelector('[data-webp-minimize]');
    const closeButton = editor.querySelector('[data-webp-close]');
    let cancelActiveJob = null;
    let backgroundStatus = null;
    let taskText = '프레임 준비 중...'; let taskProgress = 0; let taskStartedAt = 0; let elapsedTimer = 0;
    const renderTaskProgress = () => {
      const elapsed = taskStartedAt ? Math.floor((Date.now() - taskStartedAt) / 1000) : 0;
      const progressText = taskProgress === null ? '처리 중' : `${Math.round(taskProgress)}%`;
      status.textContent = `${taskText} · ${progressText} · ${elapsed}초`;
      if (backgroundStatus) {
        backgroundStatus.querySelector('[data-bg-text]').textContent = `${taskText} · ${progressText}`;
        backgroundStatus.querySelector('[data-bg-elapsed]').textContent = `${elapsed}초 경과 · 눌러서 작업 화면 열기`;
        const bar = backgroundStatus.querySelector('.chzzk-webp-background-bar');
        bar.classList.toggle('indeterminate', taskProgress === null);
        if (taskProgress !== null) bar.querySelector('i').style.width = `${Math.max(2, taskProgress)}%`;
      }
    };
    const updateTaskProgress = (text, progress) => {
      taskText = text; taskProgress = progress === null ? null : Math.max(0, Math.min(100, Number(progress) || 0)); renderTaskProgress();
    };
    const enterBackground = () => {
      editor.style.display = 'none';
      if (draftModal) draftModal.style.setProperty('display', 'none', 'important');
      if (draftCaptureBar) draftCaptureBar.style.setProperty('display', 'none', 'important');
      if (backgroundStatus) return;
      backgroundStatus = document.createElement('div');
      backgroundStatus.className = 'chzzk-webp-background-status';
      backgroundStatus.innerHTML = '<span><b data-bg-text></b><small data-bg-elapsed></small><span class="chzzk-webp-background-bar"><i></i></span></span><button type="button" data-bg-cancel title="작업 취소">×</button>';
      backgroundStatus.addEventListener('click', event => {
        if (event.target.closest('[data-bg-cancel]')) return;
        editor.style.display = 'grid';
        backgroundStatus?.remove(); backgroundStatus = null;
      });
      backgroundStatus.querySelector('[data-bg-cancel]').addEventListener('click', event => { event.stopPropagation(); close(); });
      document.body.appendChild(backgroundStatus);
      renderTaskProgress();
    };
    const restoreEditorLayers = showEditor => {
      backgroundStatus?.remove(); backgroundStatus = null;
      if (draftModal) draftModal.style.removeProperty('display');
      if (draftCaptureBar) draftCaptureBar.style.removeProperty('display');
      if (showEditor) editor.style.display = 'grid';
    };
    const releaseEditorCache = () => {
      serverLive?.dispose();
      document.removeEventListener('pointerup', resumeAfterRangeRelease, true); document.removeEventListener('pointercancel', resumeAfterRangeRelease, true);
      stopPreview(); clearTimeout(rangePreviewTimer); bitmapCache.forEach(bitmap => bitmap.close()); bitmapCache.clear(); pendingBitmaps.clear();
      if (!isLiveSource && directOriginal && !directStateRestored) {
        const restoreRange = playerLiveFallback ? (getLiveSeekRange(directVideo) || directRange) : directRange;
        directVideo.currentTime = Math.max(restoreRange.start, Math.min(restoreRange.end - (playerLiveFallback ? .2 : 0), directOriginal.time)); directVideo.playbackRate = directOriginal.rate; directVideo.muted = directOriginal.muted;
        if (!directOriginal.paused) directVideo.play().catch(() => {});
      }
      if (ownedClipVideo) {
        ownedClipVideo.pause(); ownedClipVideo.removeAttribute('src'); ownedClipVideo.load(); ownedClipVideo.remove(); ownedClipVideo = null;
      }
      if (ownedReplayFrame) {
        const ownedVideo = ownedReplayFrame.querySelector?.('video');
        if (ownedVideo) { ownedVideo.pause(); ownedVideo.removeAttribute('src'); ownedVideo.load(); }
        ownedReplayFrame.remove(); ownedReplayFrame = null;
      }
      if (completedWebpPreview && completedWebpPreviewSrc && (!completedWebpPreview.getAttribute('src') || completedWebpPreview.getAttribute('src') === completedWebpFrozenSrc)) completedWebpPreview.src = completedWebpPreviewSrc;
    };
    const close = () => { saveEditorSettings(); cancelActiveJob?.(); restoreEditorLayers(false); editor.remove(); releaseEditorCache(); };
    const confirmFrameReduction = (byteLength, frameCount) => new Promise(resolve => {
      editor.querySelector('.chzzk-webp-confirm')?.remove();
      const confirmBox = document.createElement('div');
      confirmBox.className = 'chzzk-webp-confirm';
      confirmBox.innerHTML = `<div><strong>디시 이미지 용량 20MB 초과</strong><p>현재 WebP는 <b>${(byteLength / 1024 / 1024).toFixed(1)}MB</b>, ${frameCount}프레임입니다.<br>해상도 또는 프레임을 줄일 수 있습니다. 확인하면 현재 파일을 그대로 보관하지만 디시 업로드는 실패할 수 있습니다.</p><div><button type="button" data-reduce-cancel>확인</button><button type="button" class="resize" data-resize-confirm>크기 조정</button><button type="button" class="primary" data-reduce-confirm>프레임 조정</button></div></div>`;
      editor.querySelector('.chzzk-webp-dialog').appendChild(confirmBox);
      const finish = result => { confirmBox.remove(); resolve(result); };
      confirmBox.querySelector('[data-reduce-cancel]').addEventListener('click', () => finish('keep'));
      confirmBox.querySelector('[data-resize-confirm]').addEventListener('click', () => finish('resize'));
      confirmBox.querySelector('[data-reduce-confirm]').addEventListener('click', () => finish('reduce'));
    });
    const confirmLargeJob = (frameCount, memoryMb) => new Promise(resolve => {
      editor.querySelector('.chzzk-webp-confirm')?.remove();
      const confirmBox = document.createElement('div');
      confirmBox.className = 'chzzk-webp-confirm';
      confirmBox.innerHTML = `<div><strong>긴 WebP 작업</strong><p>예상 처리량은 <b>${frameCount}프레임</b>, 압축 전 프레임 메모리는 약 <b>${memoryMb.toFixed(0)}MB</b>입니다.<br>압축 시간이 오래 걸리거나 최종 결과가 20MB를 넘을 수 있습니다.</p><div><button type="button" data-large-cancel>취소</button><button type="button" class="primary" data-large-confirm>계속 만들기</button></div></div>`;
      editor.querySelector('.chzzk-webp-dialog').appendChild(confirmBox);
      const finish = result => { confirmBox.remove(); resolve(result); };
      confirmBox.querySelector('[data-large-cancel]').addEventListener('click', () => finish(false));
      confirmBox.querySelector('[data-large-confirm]').addEventListener('click', () => finish(true));
    });
    editor.querySelector('[data-webp-close]').addEventListener('click', close); editor.querySelector('[data-webp-cancel]').addEventListener('click', close);
    minimizeButton.addEventListener('click', enterBackground);
    editor.querySelector('[data-webp-reset]').addEventListener('click', () => { Object.assign(crop, { x: 0, y: 0, w: 1, h: 1 }); renderCrop(); });
    editor.addEventListener('click', event => { if (event.target === editor) { if (editor.classList.contains('chzzk-webp-busy')) enterBackground(); else close(); } });
    editor.addEventListener('pointerdown', event => {
      if (!editor.classList.contains('chzzk-webp-busy')) return;
      if (event.target.closest('.chzzk-webp-timebar,.chzzk-webp-preview-wrap')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);

    editor.querySelector('[data-webp-create-edit]')?.addEventListener('click', () => {
      const settings = getEditorSettings(); saveEditorSettings('transition'); options.onEditRequested?.(settings);
      restoreEditorLayers(false); editor.remove(); releaseEditorCache();
    });
    editor.querySelector('[data-webp-back-to-make]')?.addEventListener('click', () => {
      restoreEditorLayers(false); editor.remove(); releaseEditorCache(); options.onBackRequested?.();
    });
    create.addEventListener('click', async () => {
      const jobStartAgo = isEditingResult ? editBaseStartAgo : Number(start.value); const jobEndAgo = isEditingResult ? editBaseEndAgo : Number(end.value);
      const duration = jobStartAgo - jobEndAgo;
      if (duration > 30.01) { showToast('WebP 구간은 최대 30초까지 선택할 수 있습니다.'); return; }
      const fps = Number(editor.querySelector('[data-webp-fps]').value || (isLiveSource ? 30 : 15));
      const sx = Math.round(crop.x * canvas.width); const sy = Math.round(crop.y * canvas.height);
      const sw = Math.max(2, Math.round(crop.w * canvas.width)); const sh = Math.max(2, Math.round(crop.h * canvas.height));
      const outputSize = getOutputSize(sw, sh); const outWidth = outputSize.width; const outHeight = outputSize.height;
      const expectedFrameCount = Math.max(2, Math.ceil(duration * fps));
      const expectedMemoryMb = expectedFrameCount * outWidth * outHeight * 4 / 1024 / 1024;
      if (expectedMemoryMb > 500 && !await confirmLargeJob(expectedFrameCount, expectedMemoryMb)) return;
      stopPreview(); clearTimeout(rangePreviewTimer);
      saveEditorSettings('working');
      const frameCanvas = document.createElement('canvas'); frameCanvas.width = outWidth; frameCanvas.height = outHeight;
      const frameCtx = frameCanvas.getContext('2d', { alpha: true, willReadFrequently: true }); const frames = [];
      frameCtx.imageSmoothingEnabled = true; frameCtx.imageSmoothingQuality = 'high';
      const frameSignatures = new Set();
      let jobCancelled = false;
      const liveJobAbort = new AbortController(); let liveFrameIterator = null;
      const cutoutTracker = effects.cutout ? new globalThis.LiveShotAnimatedCutout(effects.cutoutPoint, () => jobCancelled, message => updateTaskProgress(message, null), effects.cutoutMode) : null;
      create.disabled = true; editor.querySelectorAll('input,select,button').forEach(el => { if (el !== create && el !== minimizeButton && el !== closeButton && el !== start && el !== end) el.disabled = true; });
      editor.classList.add('chzzk-webp-busy');
      minimizeButton.hidden = false; taskStartedAt = Date.now(); clearInterval(elapsedTimer); elapsedTimer = setInterval(renderTaskProgress, 1000);
      cancelActiveJob = () => { jobCancelled = true; liveJobAbort.abort(); };
      updateTaskProgress('프레임 준비를 시작하는 중...', 2); enterBackground();
      try {
        let sourceFrames = [];
        if (serverLive) {
          const frameCount = Math.max(2, Math.ceil(duration * Math.min(fps, serverLive.fps)));
          sourceFrames = Array.from({length:frameCount}, (_,index) => ({time:newestFrameTime-jobStartAgo*1000+index*duration*1000/frameCount}));
          liveFrameIterator = serverLive.frames(jobStartAgo, jobEndAgo, frameCount/duration, liveJobAbort.signal);
        } else if (isLiveSource) {
          const firstTime = newestFrameTime - jobStartAgo * 1000;
          const lastTime = newestFrameTime - jobEndAgo * 1000;
          const candidates = cachedFrames.filter(frame => frame.time >= firstTime && frame.time <= lastTime);
          const minimumGap = (1000 / fps) * .82;
          for (const frame of candidates) {
            if (!sourceFrames.length || frame.time - sourceFrames[sourceFrames.length - 1].time >= minimumGap) sourceFrames.push(frame);
          }
          if (candidates.length && sourceFrames[sourceFrames.length - 1] !== candidates[candidates.length - 1]) sourceFrames.push(candidates[candidates.length - 1]);
        } else {
          const frameCount = Math.max(2, Math.ceil(duration * fps));
          sourceFrames = Array.from({ length: frameCount }, (_, index) => ({ ago: jobStartAgo - duration * (index / (frameCount - 1)) }));
          directVideo.pause();
        }
        if (sourceFrames.length < 2) throw new Error('선택한 구간에 저장된 프레임이 부족합니다.');
        for (let index = 0; index < sourceFrames.length; index += 1) {
          if (jobCancelled) throw new Error('WebP 작업을 취소했습니다.');
          updateTaskProgress(`프레임 준비 중 ${index + 1} / ${sourceFrames.length}`, 5 + ((index + 1) / sourceFrames.length) * 40);
          let bitmap;
          if (serverLive) { const item = await liveFrameIterator.next(); if (item.done) throw new Error('서버 영상의 프레임이 부족합니다. 구간을 줄이거나 창을 다시 열어 주세요.'); bitmap = item.value.bitmap; }
          else if (isLiveSource) bitmap = await createImageBitmap(sourceFrames[index].blob);
          else {
            const target = directRange.end - sourceFrames[index].ago;
            const liveRange = playerLiveFallback ? getLiveSeekRange(directVideo) : null;
            if (playerLiveFallback && (!liveRange || target < liveRange.start || target > liveRange.end)) throw new Error('플레이어의 되감기 구간이 만료되었습니다. 창을 닫고 다시 열어 주세요.');
            await waitForVideoSeek(directVideo, target); bitmap = directVideo;
          }
          const effectProgress = sourceFrames.length <= 1 ? 0 : index / (sourceFrames.length - 1);
          const zoomSegment = segmentAt('zoom', effectProgress); const zoomFocus = zoomSegment ? fitFocusRect(mapFocusToBounds(scaledZoomRect(zoomSegment.rect), sx, sy, sw, sh), sx, sy, sw, sh, outWidth / outHeight) : { x: sx, y: sy, width: sw, height: sh };
          // Cached frames may have a different resolution from the preview canvas.
          const sourceScaleX = (bitmap.videoWidth || bitmap.width) / canvas.width;
          const sourceScaleY = (bitmap.videoHeight || bitmap.height) / canvas.height;
          const zoomWidth = zoomFocus.width * sourceScaleX; const zoomHeight = zoomFocus.height * sourceScaleY; const zoomX = zoomFocus.x * sourceScaleX; const zoomY = zoomFocus.y * sourceScaleY;
          frameCtx.save(); frameCtx.clearRect(0, 0, outWidth, outHeight); frameCtx.filter = effectFilter();
          frameCtx.drawImage(bitmap, zoomX, zoomY, zoomWidth, zoomHeight, 0, 0, outWidth, outHeight); frameCtx.restore();
          const blurSegment = segmentAt('blur', effectProgress); if (blurSegment?.value > 0) { const rect = blurSegment.rect; const regionX = rect.x * outWidth; const regionY = rect.y * outHeight; const regionW = rect.w * outWidth; const regionH = rect.h * outHeight; frameCtx.save(); frameCtx.beginPath(); frameCtx.rect(regionX, regionY, regionW, regionH); frameCtx.clip(); frameCtx.filter = `${effectFilter()} blur(${blurSegment.value}px)`; frameCtx.drawImage(bitmap, zoomX, zoomY, zoomWidth, zoomHeight, 0, 0, outWidth, outHeight); frameCtx.restore(); }
          if (isLiveSource && !serverLive) bitmap.close();
          if (cutoutTracker) await cutoutTracker.apply(frameCanvas, effectProgress * duration);
          const frameData = new Uint8Array(frameCtx.getImageData(0, 0, outWidth, outHeight).data);
          let signature = 2166136261;
          const sampleStep = Math.max(4, Math.floor(frameData.length / 2048 / 4) * 4);
          for (let sample = 0; sample < frameData.length; sample += sampleStep) {
            signature = Math.imul(signature ^ frameData[sample], 16777619);
            signature = Math.imul(signature ^ frameData[sample + 1], 16777619);
            signature = Math.imul(signature ^ frameData[sample + 2], 16777619);
          }
          frameSignatures.add(signature >>> 0);
          // Keep the encoded animation duration identical to the selected range.
          // Live caches can contain fewer frames than the requested FPS; assigning
          // 1000 / fps in that case makes the finished WebP play too quickly.
          const frameSpeed = Math.max(.1, segmentAt('speed', effectProgress)?.value || 1);
          const frameDuration = Math.max(1, Math.round((duration * 1000 / sourceFrames.length) / frameSpeed));
          const previous = frames[frames.length - 1];
          let isExactDuplicate = Boolean(previous && previous.signature === (signature >>> 0) && previous.data.length === frameData.length);
          if (isExactDuplicate) {
            for (let byte = 0; byte < frameData.length; byte += 1) {
              if (previous.data[byte] !== frameData[byte]) { isExactDuplicate = false; break; }
            }
          }
          if (isExactDuplicate) previous.duration += frameDuration;
          else frames.push({ data: frameData, duration: frameDuration, signature: signature >>> 0, config: { lossless: 1, quality: 60 } });
        }
        if (frameSignatures.size < 2) throw new Error('선택한 구간에서 서로 다른 영상 프레임을 가져오지 못했습니다. 잠시 재생한 뒤 다시 시도해 주세요.');
        if (!isLiveSource && directOriginal && !directStateRestored) {
          const restoreRange = playerLiveFallback ? (getLiveSeekRange(directVideo) || directRange) : directRange;
          await waitForVideoSeek(directVideo, Math.max(restoreRange.start, Math.min(restoreRange.end - (playerLiveFallback ? .2 : 0), directOriginal.time)));
          directVideo.playbackRate = directOriginal.rate; directVideo.muted = directOriginal.muted; directStateRestored = true;
          if (!directOriginal.paused) directVideo.play().catch(() => {});
        }
        if (jobCancelled) throw new Error('WebP 작업을 취소했습니다.');
        updateTaskProgress('WebP 압축 작업을 시작하는 중...', null);
        const encoderHost = document.createElement('iframe');
        encoderHost.src = chrome.runtime.getURL('vendor/wasm-webp/encoder-host.html');
        encoderHost.style.cssText = 'display:none!important;width:0!important;height:0!important;border:0!important';
        const hostReady = new Promise((resolve, reject) => {
          encoderHost.addEventListener('load', resolve, { once: true });
          encoderHost.addEventListener('error', () => reject(new Error('WebP 압축 호스트를 시작하지 못했습니다.')), { once: true });
        });
        document.documentElement.appendChild(encoderHost);
        await hostReady;
        const channel = `webp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let replyHandler;
        const workerResult = await new Promise((resolve, reject) => {
          cancelActiveJob = () => { jobCancelled = true; reject(new Error('WebP 작업을 취소했습니다.')); };
          replyHandler = async event => {
            if (event.source !== encoderHost.contentWindow || event.data?.__chzzkWebpReply !== channel) return;
            const message = event.data || {};
            if (message.type === 'progress') updateTaskProgress(message.text, null);
            else if (message.type === 'error') reject(new Error(message.message));
            else if (message.type === 'done') { updateTaskProgress('WebP 생성 완료', 100); resolve(message); }
            else if (message.type === 'oversize') {
              restoreEditorLayers(true);
              const choice = await confirmFrameReduction(message.byteLength, message.frameCount);
              enterBackground();
              encoderHost.contentWindow.postMessage({ __chzzkWebpCommand: true, channel, type: choice }, '*');
            }
          };
          window.addEventListener('message', replyHandler);
          const workerFrames = frames.map(frame => ({ buffer: frame.data.buffer, duration: frame.duration }));
          encoderHost.contentWindow.postMessage({ __chzzkWebpCommand: true, channel, type: 'start', width: outWidth, height: outHeight, frames: workerFrames }, '*', workerFrames.map(frame => frame.buffer));
        }).finally(() => {
          cancelActiveJob = null;
          encoderHost.contentWindow?.postMessage({ __chzzkWebpCommand: true, channel, type: 'cancel' }, '*');
          if (replyHandler) window.removeEventListener('message', replyHandler);
          encoderHost.remove();
        });
        const bytes = new Uint8Array(workerResult.buffer);
        restoreEditorLayers(false);
        const encodedFrameCount = workerResult.frameCount;
        const finalWidth = workerResult.width || outWidth; const finalHeight = workerResult.height || outHeight;
        const blob = new Blob([bytes], { type: 'image/webp' });
        const rateKey = effects.cutout ? 'cutout' : 'normal';
        const measuredRate = blob.size / Math.max(1, finalWidth * finalHeight * encodedFrameCount);
        if (Number.isFinite(measuredRate) && measuredRate > 0) {
          estimateHistory[rateKey] = estimateHistory[rateKey] ? estimateHistory[rateKey] * .3 + measuredRate * .7 : measuredRate;
          chrome.storage.local.set({ webpEstimateRates: estimateHistory }).catch(() => {});
        }
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        const verificationImage = new Image();
        await new Promise((resolve, reject) => { verificationImage.onload = resolve; verificationImage.onerror = () => reject(new Error('생성된 WebP를 다시 읽지 못했습니다.')); verificationImage.src = dataUrl; });
        if (verificationImage.naturalWidth !== finalWidth || verificationImage.naturalHeight !== finalHeight) {
          throw new Error(`WebP 크기 검증 실패 (${verificationImage.naturalWidth}×${verificationImage.naturalHeight})`);
        }
        const resultSettings = saveEditorSettings('generated');
        const result = { blob, dataUrl, width: finalWidth, height: finalHeight, animated: true, frameCount: encodedFrameCount, fps: encodedFrameCount / Math.max(.001, frames.reduce((sum, frame) => sum + frame.duration, 0) / 1000), oversized: Boolean(workerResult.oversized), webpEditorSettings: resultSettings };
        webpResultEditorSettings.set(result, resultSettings);
        await onComplete(result);
        showToast(`움직이는 WebP를 만들었습니다. (${(blob.size / 1024 / 1024).toFixed(1)}MB)`); close();
      } catch (error) {
        if (editor.isConnected) restoreEditorLayers(true);
        minimizeButton.hidden = true;
        if (editor.isConnected) {
          console.error('[Chzzk VS] WebP 생성 실패:', error); status.textContent = `생성 실패: ${error.message || error}`;
          create.disabled = false; editor.querySelectorAll('input,select,button').forEach(el => { el.disabled = false; });
          if (!isLiveSource) directStateRestored = false;
          startPreview(Number(start.value));
        }
      } finally {
        liveJobAbort.abort(); await liveFrameIterator?.return().catch(() => {});
        cutoutTracker?.dispose();
        editor.classList.remove('chzzk-webp-busy');
        clearInterval(elapsedTimer);
        if (!editor.isConnected) releaseEditorCache();
      }
    });
  }

  // ─── 스트리머 및 방송 메타데이터 추출 ───
  function getStreamerMetadata(overrideType) {
    let streamer = '';
    let liveTitle = '';
    const pathname = window.location.pathname;
    const isClip = (overrideType === 'CLIP') || (overrideType !== 'LIVE' && /^\/(?:clips?|video|shorts?)\//i.test(pathname));

    if (isClip) {
      const clipTitleCandidates = [
        '[class*="clip_title"]',
        '[class*="clip_player"] h2',
        '[class*="clip_player"] [class*="title"]',
        'h2[class*="title"]',
        '[class*="video_title"]'
      ];
      for (const sel of clipTitleCandidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const txt = el.textContent.trim();
          if (txt && txt !== '치지직' && txt !== 'CHZZK') {
            liveTitle = txt;
            break;
          }
        }
      }

      const clipStreamerCandidates = [
        '[class*="clip_channel"] [class*="name"]',
        '[class*="clip_channel"]',
        '[class*="channel_name"]',
        '[class*="streamer_name"]',
        '[class*="video_channel"] [class*="name"]'
      ];
      for (const sel of clipStreamerCandidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const txt = el.textContent.trim();
          if (txt !== '치지직' && txt !== 'CHZZK' && txt !== '스튜디오' && txt.length > 1) {
            streamer = txt;
            break;
          }
        }
      }
    }

    const docTitle = document.title || '';
    const titleParts = docTitle.split('-').map(p => p.trim()).filter(Boolean);
    if (!streamer && titleParts.length >= 2) {
      if (titleParts[0] !== '치지직' && titleParts[0] !== 'CHZZK' && titleParts[0].length > 1) {
        streamer = titleParts[0];
      }
    }

    // SPA에서 다른 방송으로 이동하면 저장된 채널 값보다 현재 주소를 우선합니다.
    const routeChannelHash = pathname.match(/^\/live\/([a-f0-9]{32})(?:\/|$)/i)?.[1]?.toLowerCase() || '';
    const currentChannelHash = routeChannelHash || ChzzkVS.state.currentChannelHash;
    if (!streamer && currentChannelHash) {
      const channelLink = document.querySelector(
        `[class*="live_information"] a[href*="${currentChannelHash}"], [class*="video_information"] a[href*="${currentChannelHash}"], a[href*="${currentChannelHash}"][class*="channel"]`
      );
      if (channelLink && channelLink.textContent.trim()) {
        const txt = channelLink.textContent.trim();
        if (txt !== '치지직' && txt !== 'CHZZK' && txt !== '스튜디오' && !txt.includes('팔로우')) {
          streamer = txt;
        }
      }
    }

    if (!streamer) {
      const streamerCandidates = [
        '[class*="live_information_name"]',
        '[class*="live_information"] [class*="channel_name"]',
        '[class*="video_information"] [class*="channel_name"]',
        '[class*="streamer_name"]'
      ];
      for (const sel of streamerCandidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const txt = el.textContent.trim();
          if (txt !== '치지직' && txt !== 'CHZZK' && txt !== '스튜디오' && txt.length > 1) {
            streamer = txt;
            break;
          }
        }
      }
    }

    if (!liveTitle) {
      const titleCandidates = [
        'span[class*="video_title_name"]',
        'h2[class*="video_title"]',
        '[class*="video_title_text"]',
        '[class*="live_information"] [class*="title"]',
        '[class*="video_information"] [class*="title"]',
        '[class*="video_title"]'
      ];

      for (const selector of titleCandidates) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const text = el.textContent.trim();
          if (text !== '치지직' && text !== 'CHZZK' && text !== '스튜디오' && text.length > 0) {
            liveTitle = text;
            break;
          }
        }
      }
    }

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector('meta[name="twitter:title"]')?.content;
    if (ogTitle && ogTitle.includes('-')) {
      const ogParts = ogTitle.split('-').map(p => p.trim()).filter(Boolean);
      if (ogParts.length >= 2) {
        if (!streamer && ogParts[0] !== '치지직' && ogParts[0] !== 'CHZZK') {
          streamer = ogParts[0];
        }
        if (!liveTitle) {
          liveTitle = ogParts.slice(1).join(' - ');
        }
      } else if (!liveTitle) {
        liveTitle = ogTitle;
      }
    } else if (ogTitle && !liveTitle) {
      liveTitle = ogTitle;
    }

    const parts = docTitle.split('-').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      if (!streamer) streamer = parts[0];
      if (!liveTitle) liveTitle = parts.slice(1, parts.length - 1).join(' - ');
    } else if (parts.length === 2) {
      if (parts[1].includes('치지직') || parts[1].includes('CHZZK')) {
        if (!streamer) streamer = parts[0];
        if (!liveTitle) liveTitle = parts[0];
      } else {
        if (!streamer) streamer = parts[0];
        if (!liveTitle) liveTitle = parts[1];
      }
    } else if (parts.length === 1 && !liveTitle) {
      liveTitle = parts[0];
    }

    let cleanLiveTitle = (liveTitle || '')
      .replace(/\[중계\]/gi, '')
      .replace(/치지직\s*:\s*CHZZK/gi, '')
      .replace(/-\s*치지직/gi, '')
      .replace(/-\s*CHZZK/gi, '')
      .replace(/치지직/gi, '')
      .replace(/CHZZK/gi, '')
      .trim();

    if (streamer) {
      cleanLiveTitle = cleanLiveTitle
        .replace(new RegExp('^\\[' + streamer + '\\]\\s*', 'i'), '')
        .replace(new RegExp('^' + streamer + '\\s*[-:ㅣ|~]*\\s*', 'i'), '')
        .trim();
    }

    let postTitle = '';
    if (streamer && cleanLiveTitle) {
      postTitle = `${streamer} ${cleanLiveTitle}`;
    } else {
      postTitle = cleanLiveTitle || `${streamer} 방송`;
    }

    const ogImage = document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('meta[name="twitter:image"]')?.content ||
      document.querySelector('video')?.poster || '';

    let liveUrl = window.location.href.split('?')[0];
    if (!isClip && currentChannelHash) {
      liveUrl = `https://chzzk.naver.com/live/${currentChannelHash}`;
    }

    let foundChannelHash = currentChannelHash;
    if (!foundChannelHash) {
      const channelLinks = document.querySelectorAll('a[href*="/live/"], a[href^="/"]');
      for (const a of channelLinks) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/(?:live\/)?([a-f0-9]{32})/i);
        if (match) {
          foundChannelHash = match[1].toLowerCase();
          break;
        }
      }
    }

    return {
      streamer: streamer || '스트리머',
      liveTitle: cleanLiveTitle || (isClip ? '클립 영상' : '라이브 방송'),
      title: postTitle,
      liveUrl,
      channelHash: foundChannelHash,
      isClip,
      type: isClip ? 'CLIP' : 'LIVE',
      thumbnailUrl: ogImage
    };
  }

  // ─── __NEXT_DATA__ 파서 ───
  function extractNextData() {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el && el.textContent) {
        return JSON.parse(el.textContent);
      }
    } catch (e) { }
    return null;
  }

  // ─── 클립 페이지 스트리머 및 실시간 라이브 심층 분석 ───
  async function resolveClipStreamerAndLive(options = {}) {
    const pathname = window.location.pathname;
    const clipMatch = pathname.match(/\/(?:clips?|shorts?)\/([^/?#]+)/i);
    const videoMatch = pathname.match(/\/video\/([^/?#]+)/i);
    const clipId = clipMatch ? clipMatch[1] : '';
    const videoId = videoMatch ? videoMatch[1] : '';

    let streamer = '';
    let clipTitle = '';
    let channelId = ChzzkVS.state.currentChannelHash || '';

    const nextData = extractNextData();
    if (nextData && nextData.props && nextData.props.pageProps) {
      const p = nextData.props.pageProps;
      const c = p.clip || p.clipDetail || p.video || p.initialState?.clip;
      if (c) {
        clipTitle = c.clipTitle || c.videoTitle || c.title || '';
        channelId = channelId || c.channelId || c.ownerChannel?.channelId || c.channel?.channelId || '';
        streamer = streamer || c.ownerChannel?.channelName || c.channelName || c.channel?.channelName || '';
      }
      const ch = p.channel || p.channelDetail;
      if (ch) {
        channelId = channelId || ch.channelId || '';
        streamer = streamer || ch.channelName || '';
      }
    }

    if (!channelId || !streamer) {
      const clipContainers = document.querySelectorAll(
        '[class*="clip_channel"], [class*="clip_player"], [class*="video_information"], [class*="clip_information"], [class*="channel_area"], [class*="channel_info"], [class*="profile_info"]'
      );
      for (const container of clipContainers) {
        const link = container.querySelector('a[href*="/live/"], a[href^="/"]');
        if (link) {
          const href = link.getAttribute('href') || '';
          if (!href.startsWith('/lives') && !href.startsWith('/clips') && !href.startsWith('/categories') && !href.startsWith('/following')) {
            const match = href.match(/\/(?:live\/)?([a-f0-9]{32})/i);
            if (match) {
              channelId = channelId || match[1].toLowerCase();
            }
          }
        }
        const nameEl = container.querySelector('[class*="name"], [class*="channel_name"], [class*="streamer_name"]');
        if (nameEl && nameEl.textContent.trim()) {
          const t = nameEl.textContent.trim();
          if (t !== '치지직' && t !== 'CHZZK' && t.length > 1) {
            streamer = streamer || t;
          }
        }
      }
    }

    let isLive = false;
    let liveTitle = '';
    let liveUrl = channelId ? `https://chzzk.naver.com/live/${channelId}` : '';

    try {
      const bgResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'RESOLVE_CLIP_LIVE',
            payload: { clipId, videoId, channelId }
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res);
            }
          }
        );
      });

      if (bgResult && bgResult.success) {
        channelId = channelId || bgResult.targetChannelId || '';
        streamer = streamer || bgResult.streamerName || '';
        clipTitle = clipTitle || bgResult.clipTitle || '';
        isLive = Boolean(bgResult.isLive);
        liveTitle = bgResult.liveTitle || '';
        liveUrl = bgResult.liveUrl || (channelId ? `https://chzzk.naver.com/live/${channelId}` : '');
      }
    } catch (e) {
      console.warn('[Chzzk VS] 백그라운드 라이브 조회 실패:', e);
    }

    return {
      channelId,
      streamer: streamer || '스트리머',
      clipTitle: clipTitle || '클립 영상',
      streamerLiveInfo: isLive ? {
        isLive: true,
        liveTitle: liveTitle || '실시간 라이브 방송',
        liveUrl: liveUrl || `https://chzzk.naver.com/live/${channelId}`,
        channelId
      } : null
    };
  }

  // ─── 갤러리 글 초안 모달 (중계글 / 클립글 통합) ───
  async function openGalleryDraftModal(options = {}) {
    const routeType = /^\/(?:clips?|shorts?)\//i.test(location.pathname) ? 'CLIP' : 'LIVE';
    const requestedType = routeType === 'CLIP' ? 'CLIP' : (options.type || 'LIVE');
    const pageVideo = findMainVideoElement(requestedType);
    let modalOverlay = document.getElementById('chzzk-toolkit-gallery-modal');
    if (modalOverlay) modalOverlay.remove();
    webpEditorSessionSettings.clear();
    const webpCaptureAnchorTime = pageVideo?.currentTime;
    const webpCaptureFrames = rollingFrameCache.snapshot();

    const isClipRequested = requestedType === 'CLIP';
    showToast('중계 화면 캡쳐 중...');

    let captureResult = null;
    let hostedImageUrl = null;
    let stillTimelineCancelled = false;
    let releaseStillTimeline = () => { stillTimelineCancelled = true; };
    try {
      captureResult = await captureVideoFrame(isClipRequested ? 'CLIP' : 'LIVE');
    } catch (e) {
      console.warn('[Chzzk VS] 캡쳐 실패:', e);
      showToast('화면 캡처를 건너뛰고 작성창을 엽니다.');
    }

    const meta = getStreamerMetadata(requestedType);
    const isClip = meta.isClip;

    let streamerLiveInfo = null;
    if (isClipRequested) {
      try {
        const clipAnalysis = await resolveClipStreamerAndLive(options);
        if (clipAnalysis) {
          if (clipAnalysis.streamer && clipAnalysis.streamer !== '스트리머') {
            meta.streamer = clipAnalysis.streamer;
          }
          if (clipAnalysis.clipTitle && clipAnalysis.clipTitle !== '클립 영상') {
            meta.liveTitle = clipAnalysis.clipTitle;
          }
          streamerLiveInfo = clipAnalysis.streamerLiveInfo;
        }
      } catch (e) {
        console.warn('[Chzzk VS] 클립 실시간 분석 오류:', e);
      }
    }

    const defaultPostTitle = '';
    const defaultCardTitle = meta.liveTitle;
    const defaultBody = '';
    const formatCaptureSize = bytes => {
      const size = Number(bytes) || 0;
      if (!size) return '';
      return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(size / 1024)}KB`;
    };

    const DEFAULT_DESTS = [
      { id: 'virtual_streamer', name: '버츄얼 스트리머 미니 갤러리', url: 'https://gall.dcinside.com/mini/board/lists/?id=virtual_streamer' }
    ];

    let currentDestList = [...DEFAULT_DESTS];
    let currentSelectedUrl = DEFAULT_DESTS[0].url;
    let activeDest = DEFAULT_DESTS[0];
    let dcconFavorites = [];
    let dcconFolders = ['기본'];
    const selectedDccons = [];
    let dcconPosition = 'after';

    const savedDestinations = await chrome.storage.sync.get(['galleryDestinations', 'selectedGalleryUrl', 'dcconFavorites', 'dcconFolders', 'dcconFolderCovers']);
    const savedDcconPreviews = await chrome.storage.local.get({ dcconPreviewCache: {}, dcconFavorites: null, dcconFolders: null, dcconFolderCovers: null, dcconRecentIds: [] });
    const dcconPreviewCache = savedDcconPreviews.dcconPreviewCache || {};
    if (Array.isArray(savedDestinations.galleryDestinations) && savedDestinations.galleryDestinations.length) {
      currentDestList = savedDestinations.galleryDestinations.filter(item => item?.name && item?.url);
    }
    currentDestList = currentDestList.map(item => ({ ...item, name: String(item.name).replace(/(갤러리)\s*(마이너|미니)\s*$/gi, '$1').replace(/\s+(마이너|미니)(?=\s*갤러리|\s*$)/gi, '').replace(/\s+/g, ' ').trim() }));
    if (!currentDestList.length) currentDestList = [...DEFAULT_DESTS];
    currentSelectedUrl = currentDestList.some(item => item.url === savedDestinations.selectedGalleryUrl)
      ? savedDestinations.selectedGalleryUrl : currentDestList[0].url;
    activeDest = currentDestList.find(item => item.url === currentSelectedUrl) || currentDestList[0];
    dcconFavorites = Array.isArray(savedDcconPreviews.dcconFavorites) ? savedDcconPreviews.dcconFavorites : (Array.isArray(savedDestinations.dcconFavorites) ? savedDestinations.dcconFavorites : []);
    dcconFolders = Array.isArray(savedDcconPreviews.dcconFolders) && savedDcconPreviews.dcconFolders.length ? savedDcconPreviews.dcconFolders : (Array.isArray(savedDestinations.dcconFolders) && savedDestinations.dcconFolders.length ? savedDestinations.dcconFolders : ['기본']);
    const dcconFolderCovers = savedDcconPreviews.dcconFolderCovers && typeof savedDcconPreviews.dcconFolderCovers === 'object' ? savedDcconPreviews.dcconFolderCovers : (savedDestinations.dcconFolderCovers && typeof savedDestinations.dcconFolderCovers === 'object' ? savedDestinations.dcconFolderCovers : {});
    const getFolderCover = folder => dcconFavorites.find(item => (item.folder || '기본') === folder)?.url || '';
    const renderDcconPicker = () => {
      const pageSize = 24;
      const recentIds = Array.isArray(savedDcconPreviews.dcconRecentIds) ? savedDcconPreviews.dcconRecentIds : [];
      const allEntries = dcconFavorites.map((item, dcIndex) => ({ item, dcIndex }));
      const smileIcon = '<svg viewBox="0 0 40 40" aria-hidden="true" style="width:100%;height:100%;display:block"><circle cx="20" cy="20" r="18" fill="#b8bdc7"/><circle cx="14" cy="16" r="2.2" fill="#50545c"/><circle cx="26" cy="16" r="2.2" fill="#50545c"/><path d="M12 23.5c2.2 4.2 5.1 6.2 8 6.2s5.8-2 8-6.2" fill="none" stroke="#50545c" stroke-width="2.6" stroke-linecap="round"/></svg>';
      const starIcon = '<svg viewBox="0 0 40 40" aria-hidden="true" style="width:100%;height:100%;display:block"><rect x="2" y="2" width="36" height="36" rx="8" fill="#343944"/><path d="m20 7.5 3.8 7.8 8.6 1.2-6.2 6 1.5 8.5-7.7-4-7.7 4 1.5-8.5-6.2-6 8.6-1.2z" fill="#ffd45c" stroke="#fff0a6" stroke-width="1" stroke-linejoin="round"/></svg>';
      const pickerFolders = [{ key: '__recent__', label: '최근 사용', icon: smileIcon, entries: recentIds.map(id => allEntries.find(entry => entry.item.id === id)).filter(Boolean) }, { key: '__favorites__', label: '즐겨찾기', icon: starIcon, entries: allEntries.filter(entry => entry.item.favorite) }, ...dcconFolders.map(folder => ({ key: folder, label: folder, cover: getFolderCover(folder), entries: allEntries.filter(entry => (entry.item.folder || '기본') === folder) }))];
      const arrows = pickerFolders.length > 6;
      const folderButtons = pickerFolders.map(folder => `<button type="button" class="chzzk-tk-btn chzzk-tk-btn-sm" data-dccon-folder="${UTILS.escapeHtml(folder.key)}" title="${UTILS.escapeHtml(folder.label)}" style="width:44px;height:44px;min-width:44px;padding:3px;">${folder.icon || (folder.cover ? `<img src="${UTILS.escapeHtml(dcconPreviewCache[folder.cover] || folder.cover)}" alt="${UTILS.escapeHtml(folder.label)}" style="width:100%;height:100%;object-fit:contain;border-radius:5px;">` : '📁')}</button>`).join('');
      const panels = pickerFolders.map(folder => {
        const entries = folder.entries;
        const pages = Math.max(1, Math.ceil(entries.length / pageSize));
        const items = entries.map((entry, localIndex) => `<button type="button" data-add-dccon="${entry.dcIndex}" data-dccon-page-item="${Math.floor(localIndex / pageSize)}" title="${UTILS.escapeHtml(entry.item.name)}" style="display:${localIndex < pageSize ? 'block' : 'none'};width:100%;height:76px;box-sizing:border-box;padding:2px;border:1px solid #3d4350;border-radius:6px;background:#0f1115;cursor:pointer;"><img src="${UTILS.escapeHtml(dcconPreviewCache[entry.item.url] || entry.item.url)}" alt="${UTILS.escapeHtml(entry.item.name)}" style="display:block;width:100%;height:100%;object-fit:contain;"></button>`).join('');
        return `<div data-dccon-panel="${UTILS.escapeHtml(folder.key)}" data-page="0" data-pages="${pages}" style="display:none;position:absolute;left:0;top:50px;width:520px;max-height:380px;overflow:auto;box-sizing:border-box;padding:10px;background:#171a1f;border:1px solid #5965d8;border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.6);z-index:20;"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px;">${items}</div>${pages > 1 ? `<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:9px;"><button type="button" data-dccon-page-prev>‹</button><span data-dccon-page-label>1 / ${pages}</span><button type="button" data-dccon-page-next>›</button></div>` : ''}</div>`;
      }).join('');
      return `<div class="chzzk-dccon-folder-wrap" style="position:relative;display:flex;align-items:center;gap:5px;max-width:390px;">${arrows ? '<button type="button" data-folder-scroll="-1" style="min-width:28px;height:44px;">‹</button>' : ''}<div data-folder-strip style="display:flex;gap:6px;overflow:hidden;scroll-behavior:smooth;">${folderButtons}</div>${arrows ? '<button type="button" data-folder-scroll="1" style="min-width:28px;height:44px;">›</button>' : ''}${panels}</div>`;
    };

    if (captureResult && (captureResult.blob || captureResult.dataUrl)) {
      copyImageToClipboard(captureResult.blob || captureResult.dataUrl);
    }

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'chzzk-toolkit-gallery-modal';
    modalOverlay.className = 'chzzk-tk-modal-overlay';

    modalOverlay.innerHTML = `
      <div class="chzzk-tk-modal chzzk-tk-gallery-modal">
        <div class="chzzk-tk-modal-header">
          <div class="chzzk-tk-modal-title-group">
            <span style="font-size:18px;">📸</span>
            <span class="chzzk-tk-modal-title">중계글 작성</span>
            <select class="chzzk-tk-badge chzzk-tk-header-gallery-select" id="chzzk-gallery-dest-select" title="작성 갤러리 변경">
              ${currentDestList.map(d => `<option value="${UTILS.escapeHtml(d.url)}" ${d.url === currentSelectedUrl ? 'selected' : ''}>${UTILS.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
          <button class="chzzk-tk-modal-close" id="chzzk-gallery-modal-close">&times;</button>
        </div>

        <div class="chzzk-tk-modal-body">
          ${(streamerLiveInfo && streamerLiveInfo.isLive) ? `
            <div style="margin-bottom:12px; padding:10px 14px; background:rgba(0, 255, 163, 0.08); border:1px solid rgba(0, 255, 163, 0.3); border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:14px;">🔴</span>
              <span style="color:#00FFA3; font-weight:700;">스트리머가 <strong>현재 생방송 중</strong>입니다! (본문에 방송 링크 자동 첨부)</span>
            </div>
          ` : ''}

          <!-- 캡쳐 이미지 카드 -->
          <div class="chzzk-tk-gallery-preview-card">
            ${captureResult ? `
              <img src="${captureResult.dataUrl}" class="chzzk-tk-gallery-thumb" id="chzzk-gallery-preview-image" alt="${isClip ? '클립' : '라이브'} 화면 캡쳐">
              <div class="chzzk-still-timeline" id="chzzk-still-timeline" hidden><input type="range" id="chzzk-still-time-range" min="0" max="1" step="0.1" value="1"><span id="chzzk-still-time-label"></span></div>
              <div class="chzzk-tk-gallery-thumb-bar">
                <span class="chzzk-tk-gallery-res" id="chzzk-gallery-preview-res">${captureResult.width} × ${captureResult.height}${captureResult.blob?.size ? ` · ${formatCaptureSize(captureResult.blob.size)}` : ''}</span>
                <div class="chzzk-tk-gallery-thumb-actions">
                  <button type="button" class="chzzk-tk-btn chzzk-tk-btn-secondary chzzk-tk-btn-sm" id="chzzk-make-webp-btn" title="되감기 구간을 움직이는 WebP로 만들기">
                    🎞️ 움짤 만들기
                  </button>
                  <button type="button" class="chzzk-tk-btn chzzk-tk-btn-secondary chzzk-tk-btn-sm" id="chzzk-edit-webp-btn" title="현재 캡처 화면 편집">✏️ 편집</button>
                  <button type="button" class="chzzk-tk-btn chzzk-tk-btn-secondary chzzk-tk-btn-sm" id="chzzk-save-img-btn" title="PNG 파일 다운로드">
                    💾 저장
                  </button>
                </div>
              </div>
            ` : `
              <div class="chzzk-tk-gallery-no-thumb">
                <span>⚠️ 재생 중인 화면을 캡쳐하지 못했습니다.</span>
              </div>
            `}
          </div>

          <details style="margin-top:8px">
            <summary style="cursor:pointer;color:#aeb4c0">플레이어 진단</summary>
            <button type="button" class="chzzk-tk-btn chzzk-tk-btn-sm" id="chzzk-player-diagnose">진단 실행 / 새로고침</button>
            <textarea id="chzzk-player-diagnostic-result" readonly aria-label="플레이어 진단 결과" placeholder="진단 실행을 누르면 결과가 표시됩니다. 결과를 복사해서 보내주세요." style="display:block;box-sizing:border-box;width:100%;height:220px;margin-top:6px;background:#101114;color:#ddd;border:1px solid #454950;padding:8px"></textarea>
          </details>
          <!-- 게시판 관리는 확장 설정 팝업에서만 제공합니다.
          <div class="chzzk-tk-form-group">
            <div class="chzzk-tk-field-head">
              <span class="chzzk-tk-form-label">📌 작성 대상 게시판 (URL)</span>
              <button type="button" class="chzzk-tk-mini-copy-btn" id="chzzk-dest-manage-toggle-btn">⚙️ URL 등록/관리</button>
            </div>
            <select class="chzzk-tk-select" id="chzzk-gallery-dest-select">
              ${currentDestList.map(d => `
                <option value="${UTILS.escapeHtml(d.url)}" ${d.url === currentSelectedUrl ? 'selected' : ''}>
                  ${UTILS.escapeHtml(d.name)}
                </option>
              `).join('')}
              <option value="__ADD_NEW__">➕ 새 게시판 URL 직접 등록...</option>
            </select>

            <div class="chzzk-tk-dest-panel" id="chzzk-dest-panel" style="display: none;">
              <div class="chzzk-tk-dest-add-box">
                <div class="chzzk-tk-dest-form-title">➕ 새 게시판 URL 등록</div>
                <div class="chzzk-tk-dest-input-row">
                  <span class="chzzk-tk-dest-sublabel">이름</span>
                  <input type="text" class="chzzk-tk-input chzzk-tk-input-sm" id="chzzk-dest-add-name" placeholder="버츄얼 스트리머 미니 갤러리">
                </div>
                <div class="chzzk-tk-dest-input-row">
                  <span class="chzzk-tk-dest-sublabel">URL</span>
                  <div style="display:flex; gap:6px; width:100%;">
                    <input type="text" class="chzzk-tk-input chzzk-tk-input-sm" id="chzzk-dest-add-url" placeholder="갤러리 목록 또는 글쓰기 URL (https://...)" style="flex:1;">
                    <button type="button" class="chzzk-tk-btn chzzk-tk-btn-primary chzzk-tk-btn-sm" id="chzzk-dest-add-submit-btn">등록</button>
                  </div>
                </div>
              </div>
              <div class="chzzk-tk-dest-list-section">
                <div class="chzzk-tk-dest-list-head">
                  <span>📋 등록된 게시판 (${currentDestList.length})</span>
                  <span style="font-size:11px; color:#8C929E;">클릭하여 즉시 변경</span>
                </div>
                <div class="chzzk-tk-dest-item-list" id="chzzk-dest-item-list"></div>
              </div>
            </div>
          </div>

          -->
          <!-- 1. 글 제목 -->
          <div class="chzzk-tk-form-group">
            <div class="chzzk-tk-field-head">
              <span class="chzzk-tk-form-label">📝 글 제목</span>
            </div>
            <input type="text" class="chzzk-tk-input" id="chzzk-gallery-title" placeholder="글 제목을 입력하세요" value="${UTILS.escapeHtml(defaultPostTitle)}" autocomplete="off" autocorrect="off" spellcheck="false" required>
          </div>

          <!-- 3. 추가 본문 내용 -->
          <div class="chzzk-tk-form-group">
            <div class="chzzk-tk-field-head">
              <span class="chzzk-tk-form-label">📄 본문 내용</span>
            </div>
            <div id="chzzk-body-composer" style="display:flex;flex-direction:column;border:1px solid #3d4350;border-radius:9px;background:#101216;overflow:hidden;">
              <textarea class="chzzk-tk-textarea chzzk-tk-gallery-body-textarea" id="chzzk-gallery-body" placeholder="본문 내용 또는 디시콘을 입력하세요" style="border:0;border-radius:0;background:transparent;" required>${UTILS.escapeHtml(defaultBody)}</textarea>
              <div id="chzzk-selected-dccons" style="position:relative;display:flex;gap:6px;flex-wrap:wrap;padding:8px 30px 8px 10px;transition:transform .22s ease;"></div>
            </div>
          </div>
        </div>

        <div class="chzzk-tk-modal-footer">
          ${renderDcconPicker()}
          <div class="chzzk-tk-modal-btn-group">
            <a href="${currentSelectedUrl}" target="_blank" rel="noopener" class="chzzk-tk-btn chzzk-tk-btn-primary chzzk-tk-gallery-go-btn" id="chzzk-open-gallery-btn">
              작성
            </a>
          </div>
        </div>
      </div>
    `;

    const syncDraftToStorage = async (imgUrl, includeMedia = false) => {
      try {
        if (!chrome?.storage?.local?.set) return;
        const finalImgUrl = (imgUrl !== undefined) ? imgUrl : hostedImageUrl;
        await chrome.storage.local.set({
          chzzk_gallery_draft: {
            title: titleInput.value.trim(),
            cardTitle: meta.liveTitle,
            body: bodyTextarea.value.trim(),
            dccons: selectedDccons,
            dcconPosition,
            streamer: meta.streamer,
            liveTitle: meta.liveTitle,
            liveUrl: meta.liveUrl,
            isClip: meta.isClip,
            type: meta.type || (meta.isClip ? 'CLIP' : 'LIVE'),
            streamerLiveInfo: streamerLiveInfo || null,
            thumbnailUrl: meta.thumbnailUrl || null,
            hostedImageUrl: finalImgUrl,
            imageDataUrl: includeMedia ? captureResult?.dataUrl : null,
            imageDataUrls: includeMedia ? await globalThis.liveShotMediaShelf.urls(captureResult) : [],
            mediaShelfIds: includeMedia ? captureResult?.shelfSubmissionIds || [] : [],
            targetUrl: currentSelectedUrl,
            targetName: (currentDestList.find(item => item.url === currentSelectedUrl) || activeDest)?.name || '',
            autoSubmit: false,
            createdAt: Date.now()
          }
        });
        console.log('[Chzzk VS] 초안 스토리지 동기화 완료');
      } catch (e) {
        console.warn('[Chzzk VS] 초안 동기화 오류:', e);
      }
    };

    document.body.appendChild(modalOverlay);

    // 헤더를 잡고 작성창을 화면 안에서 자유롭게 이동할 수 있게 합니다.
    const modal = modalOverlay.querySelector('.chzzk-tk-gallery-modal');
    const dragHandle = modalOverlay.querySelector('.chzzk-tk-modal-header');
    const repositionOpenDcconPanel = () => {
      modalOverlay.querySelectorAll('[data-dccon-panel]').forEach(panel => {
        if (panel.style.display === 'none') return;
        const button = modal.querySelector(`[data-dccon-folder="${CSS.escape(panel.dataset.dcconPanel)}"]`);
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        panel.style.left = `${modalRect.left}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.width = `${modalRect.width}px`;
        panel.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 18)}px`;
      });
    };
    let dragState = null;
    dragHandle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, a, input, select')) return;
      const rect = modal.getBoundingClientRect();
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.top}px`;
      modal.style.right = 'auto';
      dragState = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener('pointermove', (event) => {
      if (!dragState) return;
      const maxLeft = Math.max(0, window.innerWidth - modal.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - modal.offsetHeight);
      modal.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - dragState.x))}px`;
      modal.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - dragState.y))}px`;
      requestAnimationFrame(repositionOpenDcconPanel);
    });
    const stopDragging = () => { dragState = null; };
    dragHandle.addEventListener('pointerup', stopDragging);
    dragHandle.addEventListener('pointercancel', stopDragging);

    const titleInput = modalOverlay.querySelector('#chzzk-gallery-title');
    const bodyTextarea = modalOverlay.querySelector('#chzzk-gallery-body');
    const selectedDcconList = modalOverlay.querySelector('#chzzk-selected-dccons');
    const bodyComposer = modalOverlay.querySelector('#chzzk-body-composer');
    const applyDcconPosition = (animate = false) => {
      const oldBody = bodyTextarea.getBoundingClientRect();
      const oldDccon = selectedDcconList.getBoundingClientRect();
      bodyTextarea.style.order = dcconPosition === 'before' ? '2' : '1';
      selectedDcconList.style.order = dcconPosition === 'before' ? '1' : '2';
      if (!animate) return;
      const newBody = bodyTextarea.getBoundingClientRect();
      const newDccon = selectedDcconList.getBoundingClientRect();
      bodyTextarea.animate([{ transform: `translateY(${oldBody.top - newBody.top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      selectedDcconList.animate([{ transform: `translateY(${oldDccon.top - newDccon.top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };
    let suppressDcconClickUntil = 0;
    const renderSelectedDccons = () => {
      selectedDcconList.innerHTML = selectedDccons.map((item, index) => `<button type="button" data-remove-dccon="${index}" title="클릭하여 제거 · 끌어서 이동" style="width:72px;height:72px;padding:2px;border:0;border-radius:7px;background:#101114;cursor:grab;touch-action:none;"><img src="${UTILS.escapeHtml(dcconPreviewCache[item.url] || item.url)}" alt="${UTILS.escapeHtml(item.name)}" draggable="false" style="width:100%;height:100%;object-fit:contain;pointer-events:none;"></button>`).join('') + (selectedDccons.length ? '<button type="button" data-dccon-grip title="잡아 올리거나 내려 본문과 위치 변경" style="position:absolute;top:8px;right:4px;bottom:8px;width:22px;border:0;border-radius:6px;background:#292d36;color:#d4d8e2;cursor:ns-resize;touch-action:none;font-size:18px;font-weight:800;">↕</button>' : '');
      selectedDcconList.querySelectorAll('[data-remove-dccon]').forEach(button => {
        button.addEventListener('click', () => { if (performance.now() < suppressDcconClickUntil) return; selectedDccons.splice(Number(button.dataset.removeDccon), 1); renderSelectedDccons(); syncDraftToStorage(); });
        button.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          const startIndex = Number(button.dataset.removeDccon); const startX = event.clientX; const startY = event.clientY;
          let dragging = false; let dragMode = null;
          try { button.setPointerCapture(event.pointerId); } catch (_) {}
          button.onpointermove = move => {
            const dx = move.clientX - startX; const dy = move.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) > 5) { dragging = true; dragMode = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal'; button.style.zIndex = '5'; button.style.opacity = '.82'; button.style.cursor = 'grabbing'; }
            if (!dragging) return;
            button.style.transform = `translate(${dx}px,${dy}px)`;
            if (dragMode === 'vertical') { const rect = bodyComposer.getBoundingClientRect(); const nextPosition = move.clientY < rect.top + rect.height / 2 ? 'before' : 'after'; if (nextPosition !== dcconPosition) { dcconPosition = nextPosition; applyDcconPosition(true); } }
          };
          const stop = up => {
            button.onpointermove = null; button.onpointerup = null; button.onpointercancel = null;
            if (!dragging) return;
            suppressDcconClickUntil = performance.now() + 350;
            let targetIndex = startIndex; let nearest = Infinity; const listRect = selectedDcconList.getBoundingClientRect();
            if (dragMode === 'horizontal' && up.clientX >= listRect.left && up.clientX <= listRect.right && up.clientY >= listRect.top && up.clientY <= listRect.bottom) selectedDcconList.querySelectorAll('[data-remove-dccon]').forEach(candidate => { if (candidate === button) return; const rect = candidate.getBoundingClientRect(); const distance = Math.hypot(up.clientX - (rect.left + rect.width / 2), up.clientY - (rect.top + rect.height / 2)); if (distance < nearest) { nearest = distance; targetIndex = Number(candidate.dataset.removeDccon); } });
            if (targetIndex !== startIndex) { const [moved] = selectedDccons.splice(startIndex, 1); selectedDccons.splice(targetIndex, 0, moved); }
            renderSelectedDccons(); syncDraftToStorage();
          };
          button.onpointerup = stop; button.onpointercancel = stop;
        });
      });
      const grip = selectedDcconList.querySelector('[data-dccon-grip]');
      if (grip) grip.addEventListener('pointerdown', event => { const rect = bodyComposer.getBoundingClientRect(); const boundary = rect.top + rect.height / 2; grip.setPointerCapture(event.pointerId); grip.onpointermove = move => { const nextPosition = move.clientY < boundary ? 'before' : 'after'; if (nextPosition !== dcconPosition) { dcconPosition = nextPosition; applyDcconPosition(true); syncDraftToStorage(); } }; const stop = () => { grip.onpointermove = null; grip.onpointerup = null; grip.onpointercancel = null; }; grip.onpointerup = stop; grip.onpointercancel = stop; });
      applyDcconPosition();
    };
    modalOverlay.querySelectorAll('[data-dccon-folder]').forEach(button => button.addEventListener('click', () => {
      const panel = modalOverlay.querySelector(`[data-dccon-panel="${CSS.escape(button.dataset.dcconFolder)}"]`);
      modalOverlay.querySelectorAll('[data-dccon-panel]').forEach(item => { if (item !== panel) item.style.display = 'none'; });
      if (!panel) return;
      const shouldOpen = panel.style.display === 'none';
      if (!shouldOpen) { panel.style.display = 'none'; return; }
      const rect = button.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      modalOverlay.appendChild(panel);
      panel.style.position = 'fixed';
      panel.style.left = `${modalRect.left}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.width = `${modalRect.width}px`;
      panel.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 18)}px`;
      panel.style.pointerEvents = 'auto';
      panel.style.display = 'block';
    }));
    modalOverlay.querySelectorAll('[data-folder-scroll]').forEach(button => button.addEventListener('click', () => {
      modalOverlay.querySelector('[data-folder-strip]')?.scrollBy({ left: Number(button.dataset.folderScroll) * 260, behavior: 'smooth' });
    }));
    const folderStrip = modalOverlay.querySelector('[data-folder-strip]');
    if (folderStrip) { let folderDrag = null; let folderScrollFrame = 0; folderStrip.addEventListener('pointerdown', event => { folderDrag = { pointerId: event.pointerId, x: event.clientX, left: folderStrip.scrollLeft, next: folderStrip.scrollLeft, moved: false }; }); folderStrip.addEventListener('pointermove', event => { if (!folderDrag) return; const delta = event.clientX - folderDrag.x; if (!folderDrag.moved && Math.abs(delta) > 3) { folderDrag.moved = true; folderStrip.style.scrollBehavior = 'auto'; try { folderStrip.setPointerCapture(folderDrag.pointerId); } catch (_) {} } if (!folderDrag.moved) return; folderDrag.next = folderDrag.left - delta; if (!folderScrollFrame) folderScrollFrame = requestAnimationFrame(() => { folderScrollFrame = 0; if (folderDrag) folderStrip.scrollLeft = folderDrag.next; }); }); const stopFolderDrag = event => { if (!folderDrag) return; if (folderDrag.moved) { event.preventDefault(); event.stopPropagation(); folderStrip.style.scrollBehavior = 'smooth'; } folderDrag = null; }; folderStrip.addEventListener('pointerup', stopFolderDrag); folderStrip.addEventListener('pointercancel', stopFolderDrag); folderStrip.addEventListener('dragstart', event => event.preventDefault()); }
    const changeDcconPage = (button, delta) => {
      const panel = button.closest('[data-dccon-panel]');
      const pages = Number(panel?.dataset.pages || 1);
      const page = Math.max(0, Math.min(pages - 1, Number(panel?.dataset.page || 0) + delta));
      if (!panel) return;
      panel.dataset.page = String(page);
      panel.querySelectorAll('[data-dccon-page-item]').forEach(item => { item.style.display = Number(item.dataset.dcconPageItem) === page ? 'block' : 'none'; });
      const label = panel.querySelector('[data-dccon-page-label]');
      if (label) label.textContent = `${page + 1} / ${pages}`;
    };
    modalOverlay.querySelectorAll('[data-dccon-page-prev]').forEach(button => button.addEventListener('click', () => changeDcconPage(button, -1)));
    modalOverlay.querySelectorAll('[data-dccon-page-next]').forEach(button => button.addEventListener('click', () => changeDcconPage(button, 1)));
    modalOverlay.querySelectorAll('[data-add-dccon]').forEach(button => button.addEventListener('click', () => {
      const item = dcconFavorites[Number(button.dataset.addDccon)];
      if (item) {
        selectedDccons.push(item);
        chrome.storage.local.get({ dcconRecentIds: [] }).then(data => chrome.storage.local.set({ dcconRecentIds: [item.id, ...data.dcconRecentIds.filter(id => id !== item.id)].slice(0, 48) }));
      }
      renderSelectedDccons();
      syncDraftToStorage();
      modalOverlay.querySelectorAll('[data-dccon-panel]').forEach(panel => { panel.style.display = 'none'; });
      bodyTextarea.focus();
    }));
    const saveImgBtn = modalOverlay.querySelector('#chzzk-save-img-btn');
    const makeWebpBtn = modalOverlay.querySelector('#chzzk-make-webp-btn');
    const editWebpBtn = modalOverlay.querySelector('#chzzk-edit-webp-btn');
    const openGalleryBtn = modalOverlay.querySelector('#chzzk-open-gallery-btn');
    modalOverlay.querySelector('#chzzk-player-diagnose').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      const video = findMainVideoElement(requestedType);
      const report = globalThis.LiveShotPlayerDiagnostics(video);
      const output = modalOverlay.querySelector('#chzzk-player-diagnostic-result');
      output.value = '플레이어 및 로그인 상태의 영상 정보 제공 여부를 확인 중입니다…';
      try {
        const channelId = location.pathname.match(/^\/live\/([a-f0-9]{32})/)?.[1];
        const authenticatedPlayback = channelId ? await globalThis.LiveShotAuthenticatedPlaybackCheck(channelId) : { status: 'not-live' };
        output.value = JSON.stringify({ version: chrome.runtime.getManifest().version, ...report, authenticatedPlayback }, null, 2);
      } finally { button.disabled = false; }
    });
    const destSelect = modalOverlay.querySelector('#chzzk-gallery-dest-select');
    const destBadge = modalOverlay.querySelector('#chzzk-gallery-dest-badge');
    const destManageToggleBtn = modalOverlay.querySelector('#chzzk-dest-manage-toggle-btn');
    const destPanel = modalOverlay.querySelector('#chzzk-dest-panel');
    const destAddNameInput = modalOverlay.querySelector('#chzzk-dest-add-name');
    const destAddUrlInput = modalOverlay.querySelector('#chzzk-dest-add-url');
    const destAddSubmitBtn = modalOverlay.querySelector('#chzzk-dest-add-submit-btn');
    const destItemList = modalOverlay.querySelector('#chzzk-dest-item-list');

    const setupStillTimeline = async () => {
      if (!captureResult) return;
      const timeline = modalOverlay.querySelector('#chzzk-still-timeline'); const range = modalOverlay.querySelector('#chzzk-still-time-range');
      const label = modalOverlay.querySelector('#chzzk-still-time-label'); const preview = modalOverlay.querySelector('#chzzk-gallery-preview-image');
      const resolution = modalOverlay.querySelector('#chzzk-gallery-preview-res');
      let frames = []; let video = null; let ownedVideo = null; let sourceStart = 0; let sourceEnd = 0; let originalVideoState = null; let liveStill = null;
      const isLivePage = /^\/live\//.test(window.location.pathname); const isClipPage = /^\/(?:clips?|shorts?)\//i.test(window.location.pathname);
      const isReplayPage = /^\/video\//.test(window.location.pathname); let renderTimer = 0; let renderSerial = 0; let renderBusy = false; let renderPending = false;
      const formatTime = value => {
        const safe = Math.max(0, Number(value) || 0); const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60);
        const seconds = `${String(Math.floor(safe % 60)).padStart(2, '0')}.${Math.floor((safe % 1) * 10)}`;
        return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : minutes ? `${minutes}:${seconds}` : seconds;
      };
      const commitCanvas = async canvas => {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('선택 프레임 변환 실패');
        const dataUrl = canvas.toDataURL('image/png'); captureResult = { dataUrl, blob, width: canvas.width, height: canvas.height };
        preview.src = dataUrl; resolution.textContent = `${canvas.width} × ${canvas.height}`; hostedImageUrl = null; await syncDraftToStorage(null);
      };
      try {
        if (isLivePage) {
          liveStill = await globalThis.LiveShotLiveStream.open();
          if (liveStill) { sourceEnd = liveStill.end / 1000; sourceStart = sourceEnd - liveStill.available; }
        } else if (isClipPage) {
          rollingFrameCache.ensure(); frames = rollingFrameCache.stillSnapshot();
          if (frames.length >= 2) { sourceStart = frames[0].time / 1000; sourceEnd = frames[frames.length - 1].time / 1000; }
          else {
            ownedVideo = await createClipSourceVideo(); video = ownedVideo; sourceEnd = video.duration;
            const pageVideo = getAllVideosAcrossShadowRoots(document).filter(item => !item.dataset?.chzzkVsClipSource)[0];
            video.currentTime = Math.max(0, Math.min(sourceEnd, pageVideo?.currentTime || 0));
          }
        } else if (isReplayPage) {
          rollingFrameCache.ensure(); frames = rollingFrameCache.stillSnapshot(); if (frames.length < 2) return;
          sourceStart = frames[0].time / 1000; sourceEnd = frames[frames.length - 1].time / 1000;
        } else return;
        const available = sourceEnd - sourceStart; if (!(available > .1)) return;
        if (stillTimelineCancelled || !modalOverlay.isConnected) {
          liveStill?.dispose();
          if (ownedVideo) { ownedVideo.pause(); ownedVideo.removeAttribute('src'); ownedVideo.load(); ownedVideo.remove(); }
          if (video && originalVideoState) { video.currentTime = originalVideoState.time; video.playbackRate = originalVideoState.rate; if (!originalVideoState.paused) video.play().catch(() => {}); }
          return;
        }
        range.min = '0'; range.max = available.toFixed(2); range.step = '0.1';
        range.value = frames.length ? available.toFixed(2) : Math.max(0, Math.min(available, (video?.currentTime || sourceEnd) - sourceStart)).toFixed(2);
        const findTimelineFrame = point => {
          const target = (sourceStart + point) * 1000; let frame = frames[0];
          for (const candidate of frames) { if (Math.abs(candidate.time - target) < Math.abs(frame.time - target)) frame = candidate; }
          return frame;
        };
        const updateLabel = () => {
          const point = Number(range.value);
          if (isLivePage) { label.textContent = available - point < .15 ? '현재' : `-${(available-point).toFixed(1)}초`; }
          else if (frames.length) {
            const frame = findTimelineFrame(point); label.textContent = (isLivePage || isReplayPage) ? (available - point < .15 ? '현재' : `-${(available - point).toFixed(1)}초`) : formatTime(frame.mediaTime);
          } else label.textContent = formatTime(sourceStart + point);
        };
        const renderPoint = async () => {
          if (renderBusy) { renderPending = true; renderSerial += 1; return; }
          renderBusy = true;
          const serial = ++renderSerial; const point = Number(range.value); updateLabel();
          try {
            const canvas = document.createElement('canvas');
            if (liveStill) {
              const bitmap = await liveStill.still(available - point);
              if (serial !== renderSerial || stillTimelineCancelled) { bitmap.close(); return; }
              canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
            } else if (frames.length) {
              const frame = findTimelineFrame(point);
              const bitmap = await createImageBitmap(frame.blob); if (serial !== renderSerial) { bitmap.close(); return; }
              canvas.width = frame.width; canvas.height = frame.height; canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
            } else {
              if (isLivePage) {
                const range = getLiveSeekRange(video); const target = sourceStart + point;
                if (!range || target < range.start || target > range.end) throw new Error('되감기 구간이 만료되었습니다. 작성창을 다시 열어 주세요.');
              }
              await waitForVideoSeek(video, sourceStart + point); if (serial !== renderSerial) return;
              canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
            }
            if (serial === renderSerial && modalOverlay.isConnected) await commitCanvas(canvas);
          } catch (error) { console.warn('[Chzzk VS] 일반 캡처 구간 이동 실패:', error); if (!stillTimelineCancelled) showToast(error.message); }
          finally { renderBusy = false; if (renderPending && !stillTimelineCancelled && modalOverlay.isConnected) { renderPending = false; void renderPoint(); } }
        };
        range.addEventListener('input', () => { updateLabel(); clearTimeout(renderTimer); renderTimer = setTimeout(renderPoint, 90); });
        range.addEventListener('change', () => { clearTimeout(renderTimer); renderPoint(); }); updateLabel(); timeline.hidden = false;
        releaseStillTimeline = () => {
          stillTimelineCancelled = true;
          clearTimeout(renderTimer); renderSerial += 1;
          liveStill?.dispose(); liveStill = null;
          if (ownedVideo) { ownedVideo.pause(); ownedVideo.removeAttribute('src'); ownedVideo.load(); ownedVideo.remove(); ownedVideo = null; }
          if (video && originalVideoState) {
            const returnTime = isLivePage ? (getLiveSeekRange(video)?.end || originalVideoState.time) : originalVideoState.time;
            video.currentTime = returnTime; video.playbackRate = originalVideoState.rate; if (!originalVideoState.paused) video.play().catch(() => {});
          }
          video = null;
        };
      } catch (error) { liveStill?.dispose(); console.warn('[Chzzk VS] 일반 캡처 구간 바 준비 실패:', error); }
    };
    setupStillTimeline();


    function normalizeUrl(inputUrl) {
      if (!inputUrl || typeof inputUrl !== 'string') return '';
      let u = inputUrl.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) {
        u = 'https://' + u;
      }
      try {
        const parsed = new URL(u);
        if (!parsed.hostname.endsWith('dcinside.com')) return '';
        if (parsed.hostname.includes('dcinside.com')) {
          if (parsed.pathname.includes('/board/lists')) {
            parsed.pathname = parsed.pathname.replace('/board/lists', '/board/write');
          } else if (parsed.pathname.includes('/board/view')) {
            parsed.pathname = parsed.pathname.replace('/board/view', '/board/write');
          }
        }
        return parsed.toString();
      } catch {
        return u;
      }
    }

    function getWriteUrl(inputUrl) {
      const base = normalizeUrl(inputUrl);
      if (!base) return '';
      return base.includes('#') ? base : (base + '#chzzk_draft=1');
    }

    function renderDestSelectOptions() {
      destSelect.innerHTML = `
        ${currentDestList.map(d => `
          <option value="${UTILS.escapeHtml(d.url)}" ${d.url === currentSelectedUrl ? 'selected' : ''}>
            ${UTILS.escapeHtml(d.name)}
          </option>
        `).join('')}
      `;
      const cur = currentDestList.find(d => d.url === currentSelectedUrl) || currentDestList[0];
      if (cur && destBadge) {
        destBadge.textContent = cur.name || cur.id || '게시판';
      }
      if (openGalleryBtn) {
        openGalleryBtn.href = getWriteUrl(currentSelectedUrl);
      }
    }

    function renderDestManagerList() {
      if (!destItemList) return;
      destItemList.innerHTML = currentDestList.map((item, idx) => `
        <div class="chzzk-tk-dest-item ${item.url === currentSelectedUrl ? 'active' : ''}">
          <div class="chzzk-tk-dest-item-info">
            <span class="chzzk-tk-dest-item-name">${UTILS.escapeHtml(item.name)}</span>
            <span class="chzzk-tk-dest-item-url" title="${UTILS.escapeHtml(item.url)}">${UTILS.escapeHtml(item.url)}</span>
          </div>
          <div class="chzzk-tk-dest-item-actions">
            <button type="button" class="chzzk-tk-dest-use-btn" data-url="${UTILS.escapeHtml(item.url)}">
              ${item.url === currentSelectedUrl ? '✓ 선택됨' : '선택'}
            </button>
            ${currentDestList.length > 1 ? `
              <button type="button" class="chzzk-tk-dest-del-btn" data-index="${idx}" title="삭제">🗑️</button>
            ` : ''}
          </div>
        </div>
      `).join('');

      destItemList.querySelectorAll('.chzzk-tk-dest-use-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const targetUrl = btn.getAttribute('data-url');
          if (targetUrl) {
            currentSelectedUrl = targetUrl;
            openGalleryBtn.href = getWriteUrl(currentSelectedUrl);
            await chrome.storage.sync.set({ selectedGalleryUrl: currentSelectedUrl });
            renderDestSelectOptions();
            renderDestManagerList();
            syncDraftToStorage();
          }
        });
      });

      destItemList.querySelectorAll('.chzzk-tk-dest-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-index'));
          if (isNaN(idx) || currentDestList.length <= 1) return;
          const removed = currentDestList.splice(idx, 1)[0];
          if (removed.url === currentSelectedUrl) {
            currentSelectedUrl = currentDestList[0].url;
            openGalleryBtn.href = getWriteUrl(currentSelectedUrl);
          }
          await chrome.storage.sync.set({
            galleryDestinations: currentDestList,
            selectedGalleryUrl: currentSelectedUrl
          });
          showToast(`'${removed.name}' 게시판이 삭제되었습니다.`);
          renderDestSelectOptions();
          renderDestManagerList();
          syncDraftToStorage();
        });
      });
    }

    if (destSelect) {
      renderDestSelectOptions();
      destSelect.addEventListener('change', async () => {
        const val = destSelect.value;
        if (val === '__ADD_NEW__') {
          if (destPanel) destPanel.style.display = 'block';
          if (destManageToggleBtn) destManageToggleBtn.textContent = '▲ 닫기';
          renderDestManagerList();
          if (destAddNameInput) destAddNameInput.focus();
          destSelect.value = currentSelectedUrl;
        } else {
          currentSelectedUrl = val;
          if (openGalleryBtn) openGalleryBtn.href = getWriteUrl(currentSelectedUrl);
          const cur = currentDestList.find(d => d.url === currentSelectedUrl);
          if (cur && destBadge) {
            destBadge.textContent = cur.name || cur.id || '게시판';
          }
          await chrome.storage.sync.set({ selectedGalleryUrl: currentSelectedUrl });
          syncDraftToStorage();
          showToast(`게시판이 '${cur ? cur.name : '선택된 URL'}'(으)로 변경되었습니다.`);
        }
      });
    }

    if (destManageToggleBtn && destPanel) {
      destManageToggleBtn.addEventListener('click', () => {
        const isShowing = destPanel.style.display !== 'none';
        destPanel.style.display = isShowing ? 'none' : 'block';
        destManageToggleBtn.textContent = isShowing ? '⚙️ URL 등록/관리' : '▲ 닫기';
        if (!isShowing) {
          renderDestManagerList();
        }
      });
    }

    if (destAddSubmitBtn) {
      destAddSubmitBtn.addEventListener('click', async () => {
        const name = destAddNameInput ? destAddNameInput.value.trim() : '';
        const rawUrl = destAddUrlInput ? destAddUrlInput.value.trim() : '';
        if (!rawUrl) {
          showToast('게시판 URL을 입력해 주세요.');
          if (destAddUrlInput) destAddUrlInput.focus();
          return;
        }
        const validUrl = normalizeUrl(rawUrl);
        if (!validUrl) {
          showToast('디시인사이드 갤러리 URL만 등록할 수 있습니다.');
          if (destAddUrlInput) destAddUrlInput.focus();
          return;
        }
        const finalName = name || (validUrl.includes('id=') ? validUrl.split('id=')[1].split('&')[0] + ' 갤러리' : '새 게시판');

        const existing = currentDestList.find(d => d.url === validUrl);
        if (existing) {
          existing.name = finalName;
        } else {
          currentDestList.push({
            id: finalName,
            name: finalName,
            url: validUrl
          });
        }

        currentSelectedUrl = validUrl;
        if (openGalleryBtn) openGalleryBtn.href = getWriteUrl(currentSelectedUrl);
        await chrome.storage.sync.set({
          galleryDestinations: currentDestList,
          selectedGalleryUrl: currentSelectedUrl
        });

        if (destAddNameInput) destAddNameInput.value = '';
        if (destAddUrlInput) destAddUrlInput.value = '';
        showToast(`'${finalName}' 게시판이 등록되었습니다.`);
        renderDestSelectOptions();
        renderDestManagerList();
        syncDraftToStorage();
      });
    }

    if (makeWebpBtn) {
      let hasAnimatedResult = Boolean(captureResult?.animated);
      let fixedWebpSettings = captureResult?.webpEditorSettings ? { ...captureResult.webpEditorSettings, crop: { ...captureResult.webpEditorSettings.crop } } : null;
      const applyEditedResult = async result => {
        if (result.animated) { releaseStillTimeline(); const stillTimeline = modalOverlay.querySelector('#chzzk-still-timeline'); if (stillTimeline) stillTimeline.hidden = true; }
        captureResult = result; const preview = modalOverlay.querySelector('#chzzk-gallery-preview-image'); const resolution = modalOverlay.querySelector('#chzzk-gallery-preview-res');
        if (preview) preview.src = result.dataUrl;
        if (resolution) resolution.textContent = `${result.width} × ${result.height} · ${formatCaptureSize(result.blob?.size)} · ${result.animated ? `${result.fps ? `${result.fps.toFixed(1)}fps · ` : ''}WebP` : 'PNG'}`;
        if (saveImgBtn) { saveImgBtn.title = `${result.animated ? 'WebP' : 'PNG'} 파일 다운로드`; saveImgBtn.textContent = '💾 저장'; }
        await syncDraftToStorage(null);
      };
      globalThis.liveShotMediaShelf.mount(modalOverlay, '#chzzk-gallery-preview-image', () => captureResult, async result => {
        hasAnimatedResult = Boolean(result.animated); fixedWebpSettings = null;
        await applyEditedResult(result);
        if(editWebpBtn)editWebpBtn.disabled=Boolean(result.shelfPreviewOnly);
        if(saveImgBtn)saveImgBtn.disabled=Boolean(result.shelfPreviewOnly);
      });
      let webpEditorOpenPending = false;
      const openWebpEditor = (editingExisting = false, fromMake = false) => {
        if (editingExisting && captureResult?.fromShelf) { showToast('임시저장 움짤은 원본 영상 연결이 없어 재편집할 수 없습니다. 첨부와 저장은 가능합니다.'); return; }
        if (webpEditorOpenPending || document.getElementById('chzzk-webp-editor')) return null;
        webpEditorOpenPending = true;
        const captureBar = modalOverlay.querySelector('#chzzk-still-timeline');
        if (captureBar) captureBar.style.setProperty('display', 'none', 'important');
        const sourceKind = /^\/video\//.test(window.location.pathname) ? 'replay' : /^\/(?:clips?|shorts?)\//i.test(window.location.pathname) ? 'clip' : 'live';
        const opening = openAnimatedWebpEditor(async result => {
          if (result.webpEditorSettings) fixedWebpSettings = { ...result.webpEditorSettings, crop: { ...result.webpEditorSettings.crop } };
          hasAnimatedResult = true; editWebpBtn.title = '만든 움짤의 구간과 화면을 다시 편집'; await applyEditedResult(result);
        }, { captureAnchorTime: webpCaptureAnchorTime, cachedFrames: webpCaptureFrames, sourcePlatform: 'chzzk', sourceKind, draftPreviewAnimated: Boolean(captureResult?.animated), settingsMode: editingExisting ? 'edit' : 'make', returnToMake: fromMake, editResult: editingExisting ? captureResult : null, initialSettings: editingExisting || fromMake ? fixedWebpSettings : null, onEditRequested: settings => { fixedWebpSettings = { ...settings, crop: { ...settings.crop } }; setTimeout(() => openWebpEditor(true, true), 0); }, onBackRequested: () => setTimeout(() => openWebpEditor(false, true), 0), onSettingsSaved: (settings, reason) => { if (reason === 'generated') { fixedWebpSettings = settings; if (captureResult?.animated) captureResult.webpEditorSettings = settings; } } });
        Promise.resolve(opening).then(() => { if (!document.getElementById('chzzk-webp-editor')) captureBar?.style.removeProperty('display'); }).finally(() => { webpEditorOpenPending = false; });
        return opening;
      };
      makeWebpBtn.addEventListener('click', () => openWebpEditor(false));
      editWebpBtn?.addEventListener('click', () => { if (hasAnimatedResult) openWebpEditor(true); else openStillImageEditor(captureResult, applyEditedResult); });
    }

    if (saveImgBtn && captureResult) {
      saveImgBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `chzzk_${meta.streamer}_${Date.now()}.${captureResult.animated ? 'webp' : 'png'}`;
        link.href = captureResult.dataUrl;
        link.click();
        showToast('이미지가 다운로드되었습니다.');
      });
    }

    titleInput.addEventListener('input', () => syncDraftToStorage());
    bodyTextarea.addEventListener('input', () => syncDraftToStorage());

    openGalleryBtn.href = getWriteUrl(currentSelectedUrl);

    openGalleryBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      if (captureResult?.animated && Number(captureResult.blob?.size) > 20 * 1024 * 1024) {
        showToast(`움짤 용량이 ${(captureResult.blob.size / 1024 / 1024).toFixed(1)}MB로 20MB를 초과해 글을 작성할 수 없습니다. 크기나 프레임을 줄여 주세요.`);
        return;
      }
      const hasDccon = selectedDccons.length > 0;
      if (!titleInput.value.trim() || (!bodyTextarea.value.trim() && !hasDccon)) {
        (!titleInput.value.trim() ? titleInput : bodyTextarea).focus();
        showToast('글 제목과 본문 내용 또는 디시콘을 입력해 주세요.');
        return;
      }
      openGalleryBtn.classList.add('is-loading');
      openGalleryBtn.textContent = '준비 중...';
      await syncDraftToStorage(null, true);
      chrome.runtime.sendMessage({ type: 'OPEN_URL', url: getWriteUrl(currentSelectedUrl), popup: true });
      modalOverlay.dataset.pendingPost = '1';
      modalOverlay.style.setProperty('display', 'none', 'important');
    });

    const handleDraftEnter = (event) => {
      if (event.key === 'Tab' && event.currentTarget === bodyTextarea) {
        event.preventDefault();
        titleInput.focus();
        return;
      }
      if (event.key !== 'Enter' || event.isComposing) return;
      if (event.shiftKey && event.currentTarget === bodyTextarea) {
        event.preventDefault();
        event.stopPropagation();
        bodyTextarea.setRangeText('\n', bodyTextarea.selectionStart, bodyTextarea.selectionEnd, 'end');
        bodyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (event.shiftKey) return;
      event.preventDefault();
      openGalleryBtn.click();
    };
    titleInput.addEventListener('keydown', handleDraftEnter, true);
    bodyTextarea.addEventListener('keydown', handleDraftEnter, true);

    const closeModal = (isCancel = true) => {
      releaseStillTimeline();
      if (isCancel) {
        chrome.storage?.local?.remove('chzzk_gallery_draft');
      }
      modalOverlay.remove();
    };
    modalOverlay.querySelector('#chzzk-gallery-modal-close').addEventListener('click', () => closeModal(true));
    modalOverlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(true);
      }
    });
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal(true);
    });

    syncDraftToStorage();
    titleInput.focus();
  }

  function restorePendingDraft() {
    const overlay = document.getElementById('chzzk-toolkit-gallery-modal');
    if (!overlay?.dataset.pendingPost) return false;
    overlay.style.removeProperty('display');
    delete overlay.dataset.pendingPost;
    const submit = overlay.querySelector('#chzzk-open-gallery-btn');
    if (submit) { submit.classList.remove('is-loading'); submit.textContent = '작성'; }
    (overlay.querySelector('#chzzk-gallery-title') || overlay.querySelector('#chzzk-gallery-body'))?.focus();
    return true;
  }

  function finishPendingDraft() {
    const overlay = document.getElementById('chzzk-toolkit-gallery-modal');
    if (overlay?.dataset.pendingPost) overlay.remove();
  }

  // ChzzkVS 네임스페이스 등록
  ChzzkVS.gallery = {
    openStillImageEditor,
    openAnimatedWebpEditor,
    resetWebpEditorSettings: () => webpEditorSessionSettings.clear(),
    canUseYouTubeDvr,
    getRecentStillFrames: () => { rollingFrameCache.ensure(); return rollingFrameCache.stillSnapshot(); },
    getRecentAnimatedFrames: () => { rollingFrameCache.ensure(); return rollingFrameCache.snapshot(); },
    openGalleryDraftModal,
    restorePendingDraft,
    finishPendingDraft,
    captureVideoFrame,
    copyImageToClipboard,
    getStreamerMetadata,
    resolveClipStreamerAndLive,
    findMainVideoElement
  };
})();

globalThis.liveShotMediaShelf = {
  async read() {
    const stored=await chrome.storage.local.get('liveShotMediaIndex');
    if(stored.liveShotMediaIndex)return stored.liveShotMediaIndex;
    // One-time migration: keep originals until both the new records and index are saved.
    const legacy=(await chrome.storage.local.get('liveShotMediaShelf')).liveShotMediaShelf || [];
    const index=[];
    for(const item of legacy){
      await chrome.storage.local.set({['liveShotMedia:'+item.id]:{dataUrl:item.dataUrl}});
      index.push({id:item.id,thumbnail:item.thumbnail});
    }
    await chrome.storage.local.set({liveShotMediaIndex:index});
    await chrome.storage.local.remove('liveShotMediaShelf');return index;
  },
  async urls(current) {
    const urls=[],ids=[];for(const item of await this.read()){
      const key='liveShotMedia:'+item.id,record=(await chrome.storage.local.get(key))[key];
      if(record?.dataUrl){urls.push(record.dataUrl);ids.push(item.id);}
    }
    if(current)current.shelfSubmissionIds=ids;
    return [...new Set([...urls,current?.shelfPreviewOnly ? null : current?.dataUrl].filter(Boolean))];
  },
  mount(root, selector, current, load) {
    const preview=root.querySelector(selector); if(!preview)return;
    let pausedSource=null,selectionRevision=0;
    const freezePreview=()=>{
      const result=current();if(!result?.animated || pausedSource===result.dataUrl || !preview.complete || !preview.naturalWidth)return;
      const still=document.createElement('canvas');still.width=preview.naturalWidth;still.height=preview.naturalHeight;
      still.getContext('2d').drawImage(preview,0,0);preview.src=still.toDataURL('image/png');pausedSource=result.dataUrl;
    };
    preview.style.cursor='pointer';preview.title='움짤 클릭: 재생 / 정지';
    preview.addEventListener('click',()=>{
      const result=current();if(!result?.animated)return;
      if(pausedSource===result.dataUrl){preview.src=result.dataUrl;pausedSource=null;return;}
      if(!preview.complete||!preview.naturalWidth)return;
      const canvas=document.createElement('canvas');canvas.width=preview.naturalWidth;canvas.height=preview.naturalHeight;
      canvas.getContext('2d').drawImage(preview,0,0);pausedSource=result.dataUrl;preview.src=canvas.toDataURL('image/png');
    });
    const panel=document.createElement('div');panel.className='liveshot-media-shelf';panel.style.cssText='padding:8px;display:flex;flex-direction:column;gap:8px;align-items:flex-start';
    const add=document.createElement('button');add.type='button';add.textContent='＋ 임시저장';
    add.style.cssText=`appearance:none;background:#292632;color:#ded8ed;border:1px solid ${location.hostname.endsWith('youtube.com') ? '#FF4444' : '#00d98b'};border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit`;
    panel.style.width='100%';panel.style.boxSizing='border-box';panel.style.minWidth='0';
    const list=document.createElement('div');list.className='liveshot-media-shelf-list';list.style.cssText='display:flex;flex-wrap:nowrap;gap:8px;width:100%;max-width:100%;overflow-x:auto;min-width:0;touch-action:pan-y;cursor:grab';
    let scrollDrag=null,suppressClickUntil=0;
    list.addEventListener('pointerdown',event=>{if(event.button!==0)return;scrollDrag={id:event.pointerId,x:event.clientX,left:list.scrollLeft,moved:false};});
    list.addEventListener('pointermove',event=>{if(!scrollDrag||event.pointerId!==scrollDrag.id)return;const dx=event.clientX-scrollDrag.x;if(!scrollDrag.moved&&Math.abs(dx)<6)return;scrollDrag.moved=true;list.setPointerCapture(event.pointerId);list.scrollLeft=scrollDrag.left-dx;event.preventDefault();});
    const stopScroll=()=>{if(scrollDrag?.moved)suppressClickUntil=performance.now()+300;scrollDrag=null;};
    list.addEventListener('pointerup',stopScroll);list.addEventListener('pointercancel',stopScroll);list.addEventListener('lostpointercapture',stopScroll);
    list.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    const note=document.createElement('small');note.textContent='저장한 짤 + 현재 짤을 함께 첨부 · 창을 닫아도 유지';
    const heading=document.createElement('div');heading.style.cssText='display:flex;align-items:center;gap:8px';heading.append(add,note);
    panel.append(heading,list);preview.parentElement.append(panel);
    const render=async()=>{list.replaceChildren();const items=await this.read();add.textContent=`＋ 임시저장(${items.length}/10)`;for(const item of items){
      const card=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button'),select=document.createElement('button');
      card.style.cssText='flex:0 0 auto;display:flex;align-items:center;position:relative';remove.style.cssText='position:absolute;right:0;top:0;z-index:1;border:0;border-radius:50%;background:#333b;color:white;cursor:pointer';
      if(item.thumbnail)img.src=item.thumbnail;img.style.cssText='width:60px;height:48px;object-fit:contain';
      select.type='button';select.title='작성창에 불러오기';select.append(img);
      select.style.cssText='appearance:none;background:transparent;border:0;border-radius:6px;padding:0;cursor:pointer;line-height:0;overflow:hidden';
      img.draggable=false;
      select.onclick=async()=>{select.disabled=true;try{
        freezePreview();
        const revision=++selectionRevision;
        const key='liveShotMedia:'+item.id,record=(await chrome.storage.local.get(key))[key];
        if(!record?.dataUrl)throw new Error('저장된 이미지를 찾지 못했습니다.');
        const blob=await (await fetch(record.dataUrl)).blob();
        const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=record.dataUrl;});
        if(revision!==selectionRevision)return;
        let frameCount=record.frameCount,fps=record.fps;
        if(!fps && blob.type==='image/webp'){
          const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);frameCount=0;let durationMs=0;
          for(let p=12;p+8<=bytes.length;){const size=view.getUint32(p+4,true);if(p+8+size>bytes.length)break;if(String.fromCharCode(...bytes.subarray(p,p+4))==='ANMF' && size>=16){frameCount++;durationMs+=bytes[p+20]+(bytes[p+21]<<8)+(bytes[p+22]<<16);}p+=8+size+(size%2);}fps=durationMs?frameCount*1000/durationMs:0;
        }
        await load({dataUrl:record.dataUrl,blob,width:image.naturalWidth,height:image.naturalHeight,frameCount,fps,animated:record.animated ?? blob.type==='image/webp',fromShelf:true,shelfId:item.id});
        const still=document.createElement('canvas');still.width=image.naturalWidth;still.height=image.naturalHeight;still.getContext('2d').drawImage(image,0,0);
        preview.src=still.toDataURL('image/png');pausedSource=record.dataUrl;image.src='';
        note.textContent='원본 화질 미리보기 · 큰 이미지를 클릭하면 움짤 재생';
      }catch(error){note.textContent=error.message || '불러오기 실패';}finally{select.disabled=false;}};
      remove.type='button';remove.textContent='×';remove.title='임시저장 삭제';
      remove.onpointerdown=event=>event.stopPropagation();
      remove.onclick=async event=>{event.preventDefault();event.stopPropagation();remove.disabled=true;try{await chrome.storage.local.set({liveShotMediaIndex:(await this.read()).filter(entry=>entry.id!==item.id)});await chrome.storage.local.remove('liveShotMedia:'+item.id);await render();}catch(error){note.textContent=error.message;remove.disabled=false;}};card.append(select,remove);list.append(card);
    }};
    add.onclick=async()=>{add.disabled=true;try{const result=current();if(!result?.dataUrl)return;
      if(result.blob?.size>20*1024*1024)throw new Error('20MB 이하로 줄인 뒤 저장해 주세요.');
      const items=await this.read();if(result.shelfId && items.some(item=>item.id===result.shelfId))return;
      if(items.length>=10)throw new Error('임시저장은 최대 10개입니다.');
      const thumb=document.createElement('canvas');thumb.width=80;thumb.height=60;thumb.getContext('2d').drawImage(preview,0,0,80,60);
      const id=crypto.randomUUID(),key='liveShotMedia:'+id;
      await chrome.storage.local.set({[key]:{dataUrl:result.dataUrl,animated:Boolean(result.animated),frameCount:result.frameCount || 0,fps:result.fps || 0}});
      items.push({id,thumbnail:thumb.toDataURL('image/png')});
      try{await chrome.storage.local.set({liveShotMediaIndex:items});}catch(error){await chrome.storage.local.remove(key);throw error;}
      result.shelfId=id;await render();
    }catch(error){note.textContent=error.message;}finally{add.disabled=false;}};
    render().catch(error=>{note.textContent=error.message;});
  }
};
