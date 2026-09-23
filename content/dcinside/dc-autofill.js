/**
 * ============================================================================
 * [라이브샷] 디시인사이드 중계글 자동 입력
 * 
 * @file        content/dc-autofill.js
 * @description 디시인사이드 글쓰기 폼 자동 채우기 스크립트 (DC Inside Auto-Fill Script)
 * @author      LiveShot
 * @version     1.0.0
 * @updated     2026-09-04
 * 
 * [화면 및 주요 기능 설명]
 * 1. 디시인사이드 글쓰기 페이지 진입 시 저장된 초안(Draft) 데이터 확인
 * 2. 제목 입력창 및 스마트에디터 본문에 치지직 캡처/텍스트 자동 주입
 * 3. 캡처 이미지 붙여넣기 안내 플로팅 배너 및 원클릭 이미지 주입 UI 제공
 * 4. 글 작성 완료 또는 만료 시 스토리지 초안 데이터 자동 정리
 * ============================================================================
 */

(function () {
  'use strict';
  if(globalThis.__liveShotDcDraftLoaded)return;
  globalThis.__liveShotDcDraftLoaded=true;

  // 글쓰기 페이지 확인 (/board/write/, /mini/board/write/, /mgallery/board/write/, /write 등)
  const isWritePage = window.location.pathname.includes('/write') || window.location.href.includes('/write');
  if (!isWritePage) {
    if (window.location.pathname.includes('/view/')) {
      chrome.runtime.sendMessage({ type: 'POST_SUCCESS' });
    }
    return;
  }

  console.log('[Chzzk VS DC] 글쓰기 페이지 감지, 초안 자동 완성 시작');

  // HTML 특수문자 이스케이프 헬퍼
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 유튜브 Video ID 추출 헬퍼
  function extractYouTubeVideoId(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) {
        return u.pathname.slice(1).split('/')[0].split('?')[0];
      }
      if (u.pathname.startsWith('/live/')) {
        return u.pathname.replace('/live/', '').split('/')[0].split('?')[0];
      }
      if (u.pathname.startsWith('/watch')) {
        return u.searchParams.get('v') || '';
      }
    } catch (e) { }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : '';
  }

  // 스트리머/채널명 중복 텍스트 정제 헬퍼
  function cleanStreamerName(raw) {
    if (!raw) return '스트리머';
    let name = String(raw).replace(/\s+/g, ' ').trim();
    if (!name) return '스트리머';

    // 1. 공백 기준 단어 반복 ("YTN YTN" -> "YTN")
    const words = name.split(' ');
    if (words.length >= 2 && words.length % 2 === 0) {
      const half = words.length / 2;
      const first = words.slice(0, half).join(' ');
      const second = words.slice(half).join(' ');
      if (first.toLowerCase() === second.toLowerCase()) {
        name = first;
      }
    }

    // 2. 전체 문자열 반복 ("YTN YTN")
    const doubleMatch = name.match(/^(.+?)\s+\1$/i);
    if (doubleMatch) {
      name = doubleMatch[1];
    }

    return name || '스트리머';
  }

  function disableAutoJjalbang() {
    const textLabels = Array.from(document.querySelectorAll('label, button, [role="checkbox"], [role="switch"]'))
      .filter(element => /자동\s*짤방/i.test((element.textContent || '').replace(/\s+/g, ' ')));
    for (const element of textLabels) {
      const control = element.control || element.querySelector('input[type="checkbox"]') ||
        (element.getAttribute('for') ? document.getElementById(element.getAttribute('for')) : null) || element;
      const isActive = control.matches?.('input[type="checkbox"]')
        ? control.checked
        : control.getAttribute?.('aria-checked') === 'true' || control.getAttribute?.('aria-pressed') === 'true' || /\bon\b|active|checked|selected/.test(String(control.className));
      if (isActive) (element.control ? element : control).click();
      return true;
    }

    const controls = Array.from(document.querySelectorAll('input, button, [role="checkbox"], [role="switch"]'));
    for (const control of controls) {
      const label = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
      const hint = [
        control.id, control.name, control.className, control.value, control.title,
        control.getAttribute('aria-label'), label?.textContent, control.parentElement?.textContent
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ');
      if (!/자동\s*짤방|auto[_-]?jjal/i.test(hint)) continue;

      const isCheckbox = control.matches('input[type="checkbox"]');
      const isActive = isCheckbox
        ? control.checked
        : control.getAttribute('aria-checked') === 'true' || control.getAttribute('aria-pressed') === 'true' || /\bon\b|active|checked|selected/.test(String(control.className));
      if (isActive) control.click();
      return true;
    }
    return false;
  }

  async function checkAndApplyDraft() {
    try {
      // 확장프로그램을 통해 명시적으로 열린 글쓰기 페이지인지 확인 (#chzzk_draft=1)
      const isExtensionDraft = window.location.hash.includes('chzzk_draft=1') || window.location.search.includes('chzzk_draft=1');
      if (!isExtensionDraft) {
        return;
      }

      const draftId = new URLSearchParams(location.hash.slice(1)).get('draftId') || new URLSearchParams(location.search).get('draftId');
      const draftKey = draftId && /^[a-f0-9-]{36}$/i.test(draftId) ? 'liveshot_draft_' + draftId : 'chzzk_gallery_draft';
      const data = await chrome.storage.local.get(draftKey);
      const draft = data[draftKey];

      // 초안 데이터를 읽은 즉시 1회성으로 스토리지에서 삭제 (다른 창이나 중복 실행 방지)
      chrome.storage.local.remove(draftKey);

      // URL 주소창의 해시 마커 깔끔하게 정리
      if (window.location.hash.includes('chzzk_draft=1')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      if (!draft || !draft.createdAt) {
        console.log('[Chzzk VS DC] 유효한 초안 데이터가 없습니다.');
        return;
      }

      // 5분 이내에 생성된 초안만 적용
      const elapsed = Date.now() - draft.createdAt;
      if (elapsed > 5 * 60 * 1000) {
        return;
      }

      // 확장 프로그램 캡처 이미지와 충돌하지 않도록 갤러리 자동짤방을 먼저 해제합니다.
      if (disableAutoJjalbang()) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      console.log('[Chzzk VS DC] 초안 적용 시작:', draft);

      // 1. 제목 계산 (팝업에서 사용자가 직접 입력한 제목이 있을 때만 적용, 기본값은 비움)
      const targetTitle = (draft.title && draft.title.trim()) || '';

      // 2. 본문 HTML 계산 (치지직 / 유튜브 플랫폼별 카드 동적 분기 + 추가 본문)
      const liveUrl = draft.liveUrl || '';
      const isYoutube = Boolean(draft.platform === 'YOUTUBE' || (liveUrl && (liveUrl.includes('youtube.com') || liveUrl.includes('youtu.be'))));
      if (isYoutube) {
        await new Promise(resolve => chrome.runtime.sendMessage({ type: 'INSTALL_YOUTUBE_CONFIRM' }, () => resolve()));
      }
      const isClip = !isYoutube && Boolean(draft.isClip === true || draft.type === 'CLIP' || (liveUrl && (liveUrl.includes('/clips/') || liveUrl.includes('/video/'))));
      const liveTitleText = draft.cardTitle || draft.liveTitle || (isClip ? '클립 영상' : (isYoutube ? '유튜브 라이브 방송' : '라이브 방송'));
      const streamerName = cleanStreamerName(draft.streamer || (isYoutube ? '유튜버' : '스트리머'));

      const platformLabel = isYoutube ? 'YOUTUBE' : 'CHZZK';
      const platformColor = isYoutube ? '#FF0000' : '#00C73C';
      const clipBadgeHtml = '<span style="background:#8B5CF6; color:#FFFFFF; font-size:10px; font-weight:800; padding:1px 5px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.2;">CLIP</span>';
      const liveBadgeHtml = '<span style="background:#FF0000; color:#FFFFFF; font-size:10px; font-weight:800; padding:1px 5px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.2;">LIVE</span>';

      const linkActionText = isYoutube ? '유튜브에서 시청하기 ↗' : (isClip ? '치지직 클립 시청하기 ↗' : '치지직 실시간 라이브 시청하기 ↗');
      const cardBorderColor = isYoutube ? '#FF0000' : (isClip ? '#8B5CF6' : '#00C73C');

      const streamerLiveInfo = draft.streamerLiveInfo;
      const hasActiveLive = !isYoutube && isClip && streamerLiveInfo && streamerLiveInfo.isLive && streamerLiveInfo.liveUrl;
      const currentGalleryId = new URL(window.location.href).searchParams.get('id') || '';
      let expectedGalleryId = '';
      try { expectedGalleryId = new URL(draft.targetUrl || window.location.href).searchParams.get('id') || ''; } catch (_) { }
      const galleryMatches = !expectedGalleryId || !currentGalleryId || expectedGalleryId === currentGalleryId;
      const galleryDisplayName = draft.targetName || currentGalleryId || '현재 갤러리';

      // 페이지 로딩 즉시 갤러리 확인 화면을 표시하고, 입력 완료 전까지 완료 버튼을 잠급니다.
      document.documentElement.style.setProperty('min-width', '0', 'important');
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.body.style.setProperty('min-width', '0', 'important');
      document.body.style.setProperty('width', '100vw', 'important');
      document.body.style.setProperty('overflow', 'hidden', 'important');
      const confirmLayer = document.createElement('div');
      confirmLayer.id = 'chzzk-gallery-confirm-layer';
      confirmLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:#f5f6f8;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic","Segoe UI",sans-serif;';
      confirmLayer.innerHTML = `<div style="width:100%;max-width:400px;min-height:210px;padding:24px 18px 76px;border:1px solid ${galleryMatches ? '#cbd1d8' : '#e05252'};border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.14);box-sizing:border-box;text-align:center;"><strong style="display:block;margin-bottom:9px;color:#222;font-size:15px;">현재 글쓰기 갤러리</strong><div style="color:${galleryMatches ? '#5965d8' : '#c62828'};font-size:17px;font-weight:800;line-height:1.35;word-break:keep-all;">${escapeHtml(galleryDisplayName)}</div><div id="chzzk-confirm-status" style="margin-top:7px;color:#555;font-size:13px;">${galleryMatches ? '이미지 업로드와 글쓰기를 준비하고 있습니다…' : '선택한 갤러리와 주소가 다릅니다.'}</div><button type="button" id="chzzk-use-dccon" disabled style="margin-top:12px;padding:6px 12px;border:1px solid #c3c7cf;border-radius:6px;background:#eee;color:#888;font-weight:700;">디시콘 사용</button></div>`;
      document.body.appendChild(confirmLayer);
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.id = 'chzzk-confirm-cancel';
      cancelButton.tabIndex = 0;
      cancelButton.textContent = '취소';
      cancelButton.style.cssText = 'position:fixed;z-index:2147483647;left:calc(50% - 122px);bottom:38px;width:116px;height:42px;border:1px solid #aeb5bd;border-radius:7px;background:#fff;color:#333;font-weight:700;cursor:pointer;';
      cancelButton.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'CANCEL_POST' }));
      document.body.appendChild(cancelButton);
      const pendingButton = document.createElement('button');
      pendingButton.type = 'button';
      pendingButton.id = 'chzzk-confirm-pending';
      pendingButton.textContent = '준비 중';
      pendingButton.setAttribute('aria-disabled', 'true');
      pendingButton.style.cssText = 'position:fixed;z-index:2147483647;left:calc(50% + 6px);bottom:38px;width:116px;height:42px;border:1px solid #b8bdc5;border-radius:7px;background:#d9dce1;color:#777;font-weight:700;';
      pendingButton.addEventListener('click', event => event.preventDefault());
      document.body.appendChild(pendingButton);
      const dcconButton = document.getElementById('chzzk-use-dccon');
      dcconButton?.remove();
      let selectedConfirmButton = pendingButton;
      const setConfirmFocus = button => {
        [cancelButton, pendingButton, document.getElementById('chzzk-confirm-done')].filter(Boolean).forEach(item => {
          item.style.setProperty('outline', item === button ? '3px solid #5965d8' : 'none', 'important');
          if (item === button) item.style.setProperty('outline-offset', '3px', 'important');
        });
        selectedConfirmButton = button;
        button?.focus({ preventScroll: true });
      };
      setConfirmFocus(pendingButton);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelButton.click();
          return;
        }
        if (event.key === 'Enter' && selectedConfirmButton === pendingButton) {
          event.preventDefault();
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const doneButton = document.getElementById('chzzk-confirm-done');
        const target = event.key === 'ArrowLeft' ? cancelButton : (doneButton || pendingButton);
        event.preventDefault();
        setConfirmFocus(target);
      }, true);

      // 1. 유튜브 플레이어 임베드 박스 (카드 상단에 실제 영상 재생 플레이어만 깔끔하게 삽입)
      let youtubeEmbedHtml = '';
      if (isYoutube) {
        const videoId = draft.videoId || extractYouTubeVideoId(liveUrl);
        if (videoId) {
          youtubeEmbedHtml = `<div class="yt_thum_box"><div class="yt_movie"><embed src="https://www.youtube.com/v/${videoId}" type="application/x-shockwave-flash" width="560" height="315" allowfullscreen="true"></div></div>`;
        }
      }

      // 2. 기본 정보 카드 (치지직 클립/라이브 또는 유튜브 라이브)
      const primaryCardHtml = liveUrl ? `
<div class="chzzk-og-card" contenteditable="false" style="max-width:560px; margin:12px 0 14px; padding:14px 18px; background:rgba(128,128,128,0.08); border:1px solid rgba(128,128,128,0.25); border-left:5px solid ${cardBorderColor}; border-radius:8px; font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif; text-align:left; user-select:none; box-sizing:border-box;">
  <div style="margin-bottom:6px; font-size:12px; line-height:1.2;">
    <span style="color:${platformColor}; font-weight:800; letter-spacing:0.3px;">${platformLabel}</span>
    ${isClip ? clipBadgeHtml : liveBadgeHtml}
    <span style="opacity:0.4; margin:0 6px;">|</span>
    <strong style="font-size:13px; font-weight:700;">${escapeHtml(streamerName)}</strong>
  </div>
  <div style="font-size:14px; font-weight:700; line-height:1.45; margin:6px 0 10px; word-break:break-all;">
    ${escapeHtml(liveTitleText)}
  </div>
  <div style="padding-top:6px; border-top:1px dashed rgba(128,128,128,0.25);">
    <a href="${liveUrl}" target="_blank" rel="noopener" style="color:${cardBorderColor}; font-size:13px; font-weight:700; text-decoration:none; display:inline-block; margin-top:2px;">
      ${linkActionText}
    </a>
  </div>
</div>` : '';

      // 3. 실시간 생방송 추가 카드 (클립 글 작성 시 해당 스트리머가 방송 중일 때 추가 생성)
      const liveExtraCardHtml = hasActiveLive ? `
<div class="chzzk-og-card" contenteditable="false" style="max-width:560px; margin:12px 0 16px; padding:14px 18px; background:rgba(128,128,128,0.08); border:1px solid rgba(128,128,128,0.25); border-left:5px solid #00C73C; border-radius:8px; font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif; text-align:left; user-select:none; box-sizing:border-box;">
  <div style="margin-bottom:6px; font-size:12px; line-height:1.2;">
    <span style="color:#00C73C; font-weight:800; letter-spacing:0.3px;">CHZZK</span>
    ${liveBadgeHtml}
    <span style="opacity:0.4; margin:0 6px;">|</span>
    <strong style="font-size:13px; font-weight:700;">${escapeHtml(streamerName)}</strong>
    <span style="background:rgba(225,29,72,0.15); color:#E11D48; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:6px;">현재 생방송 중</span>
  </div>
  <div style="font-size:14px; font-weight:700; line-height:1.45; margin:6px 0 10px; word-break:break-all;">
    ${escapeHtml(streamerLiveInfo.liveTitle || '실시간 라이브 방송')}
  </div>
  <div style="padding-top:6px; border-top:1px dashed rgba(128,128,128,0.25);">
    <a href="${streamerLiveInfo.liveUrl}" target="_blank" rel="noopener" style="color:#00C73C; font-size:13px; font-weight:700; text-decoration:none; display:inline-block; margin-top:2px;">
      치지직 실시간 라이브 시청하기 ↗
    </a>
  </div>
</div>` : '';

      // 치지직은 편집 가능한 하이퍼링크로, 유튜브는 디시 자체 소스코드 변환이
      // 동작하도록 원본 URL 문자열로 삽입합니다.
      // 이미지는 외부 URL로 삽입하지 않고 디시의 정식 파일 첨부 입력란으로 업로드합니다.
      const imageHtml = '';
      const primaryLinkHtml = liveUrl
        ? (isYoutube
          ? `<p>${escapeHtml(liveUrl)}</p>`
          : `<p><a href="${escapeHtml(liveUrl)}" target="_blank" rel="noopener">${escapeHtml(liveTitleText || linkActionText)}</a></p>`)
        : '';
      const liveExtraLinkHtml = hasActiveLive
        ? `<p><a href="${escapeHtml(streamerLiveInfo.liveUrl)}" target="_blank" rel="noopener">${escapeHtml(streamerLiveInfo.liveTitle || '치지직 실시간 라이브')}</a></p>`
        : '';
      const fullCardsHtml = draft.insertHyperlink === false ? imageHtml : `${imageHtml}${primaryLinkHtml}${liveExtraLinkHtml}${primaryLinkHtml || liveExtraLinkHtml ? '<p><br></p>' : ''}`;
      const legacyDccon = draft.dccon && typeof draft.dccon === 'object' ? draft.dccon : null;
      const savedDccons = Array.isArray(draft.dccons) ? draft.dccons : (legacyDccon ? [legacyDccon] : []);
      const dcconHtmlParts = [];
      savedDccons.forEach(savedDccon => {
        if (!savedDccon || typeof savedDccon !== 'object') return;
        let dcconUrl = '';
        try {
          const parsedDccon = new URL(String(savedDccon.url || '').trim());
          if (parsedDccon.hostname.endsWith('dcinside.com') && /\/dccon\.php$/i.test(parsedDccon.pathname)) dcconUrl = parsedDccon.href;
        } catch (_) { }
        if (!dcconUrl) return;
        const dcconName = String(savedDccon.name || '디시콘').trim();
        const dcconDetail = String(savedDccon.detail || '').replace(/[^0-9]/g, '');
        dcconHtmlParts.push(`<img class="written_dccon" src="${escapeHtml(dcconUrl)}" conalt="${escapeHtml(dcconName)}" alt="${escapeHtml(dcconName)}" con_alt="${escapeHtml(dcconName)}" title="${escapeHtml(dcconName)}"${dcconDetail ? ` detail="${dcconDetail}"` : ''} data-dcconoverstatus="true" style="display:inline-block;vertical-align:top;">`);
      });
      const dcconHtml = dcconHtmlParts.length ? `<p>${dcconHtmlParts.join('')}</p>` : '';
      const extraText = (draft.body || '').trim();
      const extraHtml = extraText ? `<p>${escapeHtml(extraText).replace(/\n/g, '<br>')}</p><p><br></p>` : '';
      const cardsHtml = !extraText && dcconHtml ? fullCardsHtml.replace(/<p><br><\/p>$/, '') : fullCardsHtml;
      const finalBodyHtml = draft.dcconPosition === 'before' ? `${cardsHtml}${dcconHtml}${extraHtml}` : `${cardsHtml}${extraHtml}${dcconHtml}`;

      async function createCaptureFile(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const extension = blob.type === 'image/jpeg' ? 'jpg' : (blob.type === 'image/webp' ? 'webp' : 'png');
        return new File([blob], `chzzk_capture_${crypto.randomUUID()}.${extension}`, { type: blob.type || 'image/png' });
      }

      const captureFiles = (await Promise.all((draft.imageDataUrls || [draft.imageDataUrl]).map(createCaptureFile))).filter(Boolean);
      const captureFile = captureFiles[0];
      let imageDone = !captureFile;
      let imageAttempting = false;

      function placeEditorCaretAtStart(editor, doc) {
        try {
          editor.focus();
          const range = doc.createRange();
          const selection = doc.defaultView?.getSelection();
          range.selectNodeContents(editor);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        } catch (_) { }
      }

      function collectDocuments(rootDoc = document, result = []) {
        if (!rootDoc || result.includes(rootDoc)) return result;
        result.push(rootDoc);
        rootDoc.querySelectorAll('iframe').forEach(frame => {
          try { if (frame.contentDocument) collectDocuments(frame.contentDocument, result); } catch (_) { }
        });
        return result;
      }

      async function clearAutoJjalbangFromEditor() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          disableAutoJjalbang();
          const docs = collectDocuments();
          const editors = docs.flatMap(doc => Array.from(doc.querySelectorAll('body.se2_input_area, .note-editable, .se2_input_area[contenteditable="true"]')));
          if (editors.length) {
            // 새 글쓰기 페이지의 기존 내용은 자동짤방뿐이므로 링크 삽입 전에 완전히 비웁니다.
            editors.forEach(editor => {
              editor.innerHTML = '<p><br></p>';
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));
            });
            const memo = document.querySelector('#memo, textarea[name="memo"], textarea[name="content"], textarea#content');
            if (memo) {
              memo.value = '';
              memo.dispatchEvent(new Event('input', { bubbles: true }));
              memo.dispatchEvent(new Event('change', { bubbles: true }));
            }
            console.log('[Chzzk VS DC] 자동짤방 제거 완료, 링크 삽입 시작');
            return true;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
      }

      async function waitForNativeUpload(beforeImages, fileName, timeout = 6000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const docs = collectDocuments();
          const hasNewEditorImage = docs.some(doc => Array.from(doc.querySelectorAll('body.se2_input_area img, .note-editable img, .se2_input_area[contenteditable="true"] img, [contenteditable="true"] img, [class*="attach"] img, [class*="upload"] img')).some(image => {
            const src = image.currentSrc || image.src || '';
            return src && !beforeImages.has(src) && !/dccon\.php/i.test(src) && !image.classList.contains('written_dccon');
          }));
          const hasAttachmentName = docs.some(doc => Array.from(doc.querySelectorAll('[class*="attach"], [class*="file"], [id*="attach"], [id*="file"]')).some(element => (element.textContent || '').includes(fileName)));
          if (captureFiles.length > 1) {
            const sources = new Set(docs.flatMap(doc => Array.from(doc.querySelectorAll('body.se2_input_area img, .note-editable img, [contenteditable="true"] img')).filter(image => !image.classList.contains('written_dccon')).map(image => image.currentSrc || image.src)).filter(src => src && !beforeImages.has(src) && !/dccon\.php/i.test(src)));
            if (sources.size >= captureFiles.length) return true;
          } else if (hasNewEditorImage || hasAttachmentName) return true;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        return false;
      }

      let nativeUploadSent=false;
      let webpPasteAttempted=false;
      async function applyNativeImageUpload() {
        if (imageDone || !captureFile) return true;
        if(nativeUploadSent)return false;
        const docs = collectDocuments();
        // WebP cannot use ClipboardItem in the screenshot path. Deliver the file
        // to the editor's paste handler before trying a generic file input.
        if(!webpPasteAttempted && captureFiles.some(file=>file.type==='image/webp')){
          webpPasteAttempted=true;
          for(const doc of docs){
            const target=doc.querySelector('body.se2_input_area, .note-editable, .se2_input_area[contenteditable="true"]');if(!target)continue;
            placeEditorCaretAtStart(target,doc);
            const before=new Set(docs.flatMap(item=>Array.from(item.querySelectorAll('img')).map(img=>img.currentSrc||img.src)));
            const transfer=new DataTransfer();captureFiles.forEach(file=>transfer.items.add(file));
            const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
            const handled=!target.dispatchEvent(paste)||paste.defaultPrevented;
            if(handled){
              nativeUploadSent=true;
              const status=document.getElementById('chzzk-confirm-status');if(status)status.textContent='움짤 전달 완료 · 본문 삽입을 확인하고 있습니다…';
              imageDone=await waitForNativeUpload(before,captureFile.name,60000);
              if(!imageDone&&status)status.textContent='움짤 본문 삽입을 확인하지 못했습니다. 취소 후 다시 시도해 주세요.';
              return imageDone;
            }
          }
        }
        for (const doc of docs) {
          const editor = doc.querySelector('body.se2_input_area, .note-editable, [contenteditable="true"], .se2_input_area');
          if (editor) {
            placeEditorCaretAtStart(editor, doc);
            break;
          }
        }
        for (const doc of docs) {
          const inputs = Array.from(doc.querySelectorAll('input[type="file"]'));
          const ranked = inputs.map(el => {
            const accept = (el.accept || '').toLowerCase();
            const hint = `${el.id} ${el.name} ${el.className}`.toLowerCase();
            const parentHint = `${el.parentElement?.id || ''} ${el.parentElement?.className || ''}`.toLowerCase();
            let score = 0;
            if (accept.includes('image')) score += 30;
            if (/image|photo|file|upload|attach/.test(hint)) score += 20;
            if (el.closest('form[id*="write"], form[name*="write"], .write_wrap, [class*="editor"], [id*="editor"]')) score += 60;
            if (/auto|setting|profile|avatar/.test(`${hint} ${parentHint}`)) score -= 80;
            return { el, score };
          }).sort((a, b) => b.score - a.score);
          const input = ranked[0]?.score > 0 ? ranked[0].el : null;
          if (!input) continue;
          try {
            const beforeImages = new Set(docs.flatMap(item => Array.from(item.querySelectorAll('body.se2_input_area img, .note-editable img, .se2_input_area[contenteditable="true"] img, [contenteditable="true"] img')).map(image => image.currentSrc || image.src || '')).filter(Boolean));
            const transfer = new DataTransfer();
            captureFiles.forEach(file => transfer.items.add(file));
            const originalAccept = input.getAttribute('accept');
            if (captureFile.type === 'image/webp' && !(input.accept || '').toLowerCase().includes('webp')) {
              input.setAttribute('accept', `${input.accept || 'image/*'},image/webp,.webp`);
            }
            input.multiple = captureFiles.length > 1 || input.multiple;
            input.files = transfer.files;
            nativeUploadSent=true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (originalAccept === null) input.removeAttribute('accept'); else input.setAttribute('accept', originalAccept);
            input.dataset.chzzkCaptureAttached = '1';
            if (await waitForNativeUpload(beforeImages, captureFile.name, 60000)) {
              imageDone = true;
              console.log('[Chzzk VS DC] 디시 정식 이미지 첨부 및 업로드 완료 확인');
              return true;
            }
            const uploadStatus=document.getElementById('chzzk-confirm-status');if(uploadStatus)uploadStatus.textContent='파일 전달 후 업로드 완료를 확인하지 못했습니다. 취소 후 다시 시도해 주세요.';
            return false; // A slow upload must not be submitted again via drop/paste.
            const editor = docs.flatMap(item => Array.from(item.querySelectorAll('body.se2_input_area, .note-editable, [contenteditable="true"], .se2_input_area')))[0];
            if (editor) {
              const dropTransfer = new DataTransfer(); captureFiles.forEach(file => dropTransfer.items.add(file));
              editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropTransfer }));
              if (await waitForNativeUpload(beforeImages, captureFile.name, 4000)) {
                imageDone = true;
                console.log('[Chzzk VS DC] 드롭 방식 WebP 업로드 완료 확인');
                return true;
              }
              const pasteTransfer = new DataTransfer(); captureFiles.forEach(file => pasteTransfer.items.add(file));
              editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pasteTransfer }));
              if (await waitForNativeUpload(beforeImages, captureFile.name, 4000)) {
                imageDone = true;
                console.log('[Chzzk VS DC] paste 이벤트 방식 WebP 업로드 완료 확인');
                return true;
              }
            }
          } catch (error) {
            console.warn('[Chzzk VS DC] 이미지 첨부 입력 실패:', error);
          }
        }
        return false;
      }

      // Upload all screenshots together in the page's native uploader context,
      // then insert by response file_temp_no in the original shelf order.
      let screenshotUploadStarted = false;
      async function uploadScreenshotsInOrder() {
        if (screenshotUploadStarted) return imageDone;
        screenshotUploadStarted = true;
        imageAttempting = true;
        const status = document.getElementById('chzzk-confirm-status');
        try {
          const urls = (draft.imageDataUrls || [draft.imageDataUrl]).filter(url => typeof url === 'string' && url.startsWith('data:image/'));
          if (urls.length !== captureFiles.length) throw new Error('첨부 파일 목록을 확인하지 못했습니다.');
          if (status) status.textContent = `스크린샷 ${urls.length}장 동시 업로드를 준비하고 있습니다…`;
          const result = await chrome.runtime.sendMessage({
            type: 'UPLOAD_SCREENSHOT_BATCH',
            files: urls.map((dataUrl, index) => ({ dataUrl, name: captureFiles[index].name })),
          });
          if (!result?.ok || result.count !== captureFiles.length) throw new Error(result?.error || '스크린샷 업로드 결과를 확인하지 못했습니다.');
          imageDone = true;
          return true;
        } catch (error) {
          if (status) status.textContent = error.message;
          return false;
        } finally { imageAttempting = false; }
      }

      async function applyImageLikeBroadcastHelper() {
        if (imageDone || !captureFile || imageAttempting) return imageDone;
        if (captureFiles.length) return uploadScreenshotsInOrder();
        if (captureFiles.length > 1) return applyNativeImageUpload();
        imageAttempting = true;
        try {
          // 중계 도우미 방식: 이미지 클립보드를 에디터에 붙여넣어 디시 자체 업로더를 호출합니다.
          if (captureFile.type !== 'image/webp' && navigator.clipboard?.write && window.ClipboardItem) {
            await navigator.clipboard.write([
              new ClipboardItem({ [captureFile.type || 'image/png']: captureFile })
            ]);
            const docs = collectDocuments();
            for (const doc of docs) {
              const editor = doc.querySelector('body.se2_input_area, .note-editable, [contenteditable="true"], .se2_input_area');
              if (!editor) continue;
              // 업로드 이미지가 항상 링크와 본문보다 위에 들어가도록 시작 위치에 삽입합니다.
              placeEditorCaretAtStart(editor, doc);
              const pasted = doc.execCommand && doc.execCommand('paste');
              if (pasted) {
                imageDone = true;
                console.log('[Chzzk VS DC] 클립보드 붙여넣기로 디시 이미지 업로더 호출 완료');
                return true;
              }
              try {
                const transfer = new DataTransfer();
                transfer.items.add(captureFile);
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: transfer
                });
                const handled = !editor.dispatchEvent(pasteEvent) || pasteEvent.defaultPrevented;
                if (handled) {
                  imageDone = true;
                  console.log('[Chzzk VS DC] 디시 에디터 paste 이벤트로 이미지 전달 완료');
                  return true;
                }
              } catch (_) { }
            }
          }
        } catch (error) {
          console.warn('[Chzzk VS DC] 클립보드 이미지 자동 삽입 실패, 파일 첨부 방식 시도:', error);
        } finally {
          imageAttempting = false;
        }
        return await applyNativeImageUpload();
      }

      // A. 제목 입력 함수
      const applyTitle = () => {
        if (!targetTitle) return true;
        const subjectInput = document.querySelector(
          '#subject, input[name="subject"], input[class*="subject"], input[class*="write_title"], input[placeholder*="제목"], input[name*="subject"]'
        );
        if (subjectInput) {
          if (!subjectInput.value || subjectInput.value !== targetTitle) {
            subjectInput.value = targetTitle;
          }
          subjectInput.setAttribute('autocomplete', 'off');
          subjectInput.setAttribute('autocorrect', 'off');
          subjectInput.setAttribute('spellcheck', 'false');

          // DC Inside placeholder 라벨 숨김
          const placeholderLabels = document.querySelectorAll(
            'label[for="subject"], label.placeholder, .placeholder_subject, .placeholder_title, [class*="placeholder"], [class*="placeholder_msg"]'
          );
          placeholderLabels.forEach(lbl => {
            lbl.style.display = 'none';
            lbl.style.visibility = 'hidden';
            lbl.style.opacity = '0';
          });

          subjectInput.dispatchEvent(new Event('focus', { bubbles: true }));
          subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
          subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
          subjectInput.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }
        return false;
      };

      let isBodyApplied = false;

      // B. 메인 월드 SmartEditor2 API 주입 스크립트 실행
      const injectMainWorldEditorScript = () => {
        try {
          const script = document.createElement('script');
          script.textContent = `
            (function() {
              if (window.__chzzk_se_applied) return;
              const html = ${JSON.stringify(finalBodyHtml)};
              function setSE() {
                try {
                  if (window.__chzzk_se_applied) return true;
                  if (window.oEditors && window.oEditors.getById) {
                    const editor = window.oEditors.getById["memo"] || Object.values(window.oEditors.getById)[0];
                    if (editor && typeof editor.exec === 'function') {
                      // 이미 본문에 이미지가 붙여넣어졌거나 카드가 있으면 덮어쓰지 않음
                      const iframe = document.querySelector('#se2_iframe, iframe[name*="se2"], iframe[src*="SmartEditor"]');
                      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
                      const body = doc?.querySelector('body.se2_input_area, body[contenteditable="true"]');
                      if (body && (body.querySelector('.chzzk-og-card') || body.querySelector('img'))) {
                        window.__chzzk_se_applied = true;
                        return true;
                      }

                      editor.exec("SET_IR", [html]);
                      window.__chzzk_se_applied = true;
                      try {
                        editor.exec("FOCUS");
                        if (doc && doc.defaultView) {
                          const targetBody = doc.querySelector('body.se2_input_area, body[contenteditable="true"]');
                          const lastP = targetBody ? targetBody.querySelector('p:last-of-type, p:last-child') : null;
                          if (lastP) {
                            const range = doc.createRange();
                            const sel = doc.defaultView.getSelection();
                            range.selectNodeContents(lastP);
                            range.collapse(false);
                            sel.removeAllRanges();
                            sel.addRange(range);
                          }
                        }
                      } catch(fErr) {}
                      return true;
                    }
                  }
                } catch(e) {}
                return false;
              }
              if (!setSE()) {
                let cnt = 0;
                const tm = setInterval(() => {
                  cnt++;
                  if (setSE() || cnt > 20 || window.__chzzk_se_applied) {
                    clearInterval(tm);
                  }
                }, 150);
              }
            })();
          `;
          (document.head || document.documentElement).appendChild(script);
          script.remove();
        } catch (e) { }
      };

      // C. 직접 DOM iframe 탐색 (중첩 iframe 포함) 및 입력
      const applyToIframes = (parentDoc) => {
        if (isBodyApplied) return true;
        let applied = false;
        const iframes = (parentDoc || document).querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
              // 중첩 iframe 탐색 (SmartEditor2 Skin 내부의 se2_iframe)
              if (applyToIframes(doc)) {
                applied = true;
                isBodyApplied = true;
                return true;
              }

              const targetBody = doc.querySelector('body.se2_input_area, body[contenteditable="true"], .se2_input_area');
              if (targetBody) {
                // 이미 카드나 사용자가 붙여넣은 이미지가 들어있는 경우 절대 덮어쓰지 않음
                if (targetBody.querySelector('.chzzk-og-card') || targetBody.querySelector('img')) {
                  isBodyApplied = true;
                  return true;
                }

                targetBody.innerHTML = finalBodyHtml;
                targetBody.dispatchEvent(new Event('input', { bubbles: true }));
                targetBody.dispatchEvent(new Event('change', { bubbles: true }));

                // 커서를 카드 바깥 하단 문단으로 포커스
                try {
                  const lastP = targetBody.querySelector('p:last-of-type, p:last-child');
                  if (lastP && doc.defaultView) {
                    const range = doc.createRange();
                    const sel = doc.defaultView.getSelection();
                    range.selectNodeContents(lastP);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    if (typeof lastP.focus === 'function') lastP.focus();
                  }
                } catch (posErr) { }

                applied = true;
                isBodyApplied = true;
                return true;
              }
            }
          } catch (e) { }
        }
        return applied;
      };

      // D. 일반 textarea 및 contenteditable 요소 입력
      const applyToTextareas = () => {
        if (isBodyApplied) return true;
        let applied = false;

        const memoTextarea = document.querySelector('#memo, textarea[name="memo"], textarea[class*="memo"], textarea[name="content"], textarea#content');
        if (memoTextarea) {
          if (memoTextarea.value && memoTextarea.value.includes('chzzk-og-card')) {
            isBodyApplied = true;
            return true;
          }
          memoTextarea.value = finalBodyHtml;
          memoTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          memoTextarea.dispatchEvent(new Event('change', { bubbles: true }));
          applied = true;
          isBodyApplied = true;
        }

        const contentEditable = document.querySelector('.note-editable, [contenteditable="true"]:not(body), div.write_content, div.editor_body');
        if (contentEditable) {
          if (contentEditable.querySelector('.chzzk-og-card') || contentEditable.querySelector('img')) {
            isBodyApplied = true;
            return true;
          }
          contentEditable.innerHTML = finalBodyHtml;
          contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
          contentEditable.dispatchEvent(new Event('change', { bubbles: true }));
          applied = true;
          isBodyApplied = true;
        }

        return applied;
      };

      let submitPrepared = false;
      async function finishAndPrepareSubmit() {
        if (submitPrepared) return;
        submitPrepared = true;
        await chrome.storage.local.remove(draftKey);
        await new Promise(resolve => setTimeout(resolve, 5000));

        const subject = document.querySelector('#subject, input[name="subject"], input[class*="subject"], input[placeholder*="제목"]');
        const writeForm = subject?.closest('form') || document.querySelector('form#write, form[name*="write"], form[action*="write"]');
        const root = writeForm || document;
        const candidates = Array.from(root.querySelectorAll('button, input[type="submit"], input[type="button"]'))
          .filter(button => ((button.textContent || button.value || '').trim() === '등록'));
        const submitButton = candidates[candidates.length - 1];
        if (!submitButton || submitButton.disabled) {
          chrome.runtime.sendMessage({ type: 'POST_NEEDS_ATTENTION', reason: '등록 버튼 위치를 확인해 주세요.' });
          return;
        }

        pendingButton.remove();
        if (dcconButton) {
          dcconButton.disabled = false;
          dcconButton.style.background = '#fff';
          dcconButton.style.color = '#5965d8';
          dcconButton.style.borderColor = '#5965d8';
        }
        const status = document.getElementById('chzzk-confirm-status');
        if (status) status.textContent = galleryMatches ? '글쓰기 준비가 완료되었습니다.' : '선택한 갤러리와 주소가 다릅니다.';
        submitButton.id = 'chzzk-confirm-done';
        submitButton.style.cssText += 'position:fixed!important;z-index:2147483647!important;left:calc(50% + 6px)!important;bottom:38px!important;width:116px!important;height:42px!important;margin:0!important;border-radius:7px!important;outline:none!important;';
        submitButton.disabled = !galleryMatches;
        const originalSubmitLabel = (submitButton.textContent || submitButton.value || '등록').trim();
        const setSubmitLabel = label => {
          if (submitButton.tagName === 'INPUT') submitButton.value = label;
          else submitButton.textContent = label;
        };
        const showRegistering = () => {
          if (status) {
            status.textContent = '등록 중…';
            status.style.color = '#5965d8';
            status.style.fontWeight = '800';
          }
          setSubmitLabel('등록 중…');
        };
        const processingLayer = document.createElement('div');
        processingLayer.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483647;background:#f5f6f8;align-items:center;justify-content:center;color:#5965d8;font:900 32px -apple-system,BlinkMacSystemFont,"Malgun Gothic","Segoe UI",sans-serif;letter-spacing:-1px;';
        processingLayer.textContent = '등록 중…';
        document.body.appendChild(processingLayer);
        const showProcessingScreen = () => { processingLayer.style.display = 'flex'; };
        const hideProcessingScreen = () => { processingLayer.style.display = 'none'; };
        submitButton.addEventListener('focus', () => {
          submitButton.style.setProperty('outline', '3px solid #5965d8', 'important');
          submitButton.style.setProperty('outline-offset', '3px', 'important');
        });
        submitButton.addEventListener('blur', () => {
          if (selectedConfirmButton !== submitButton) submitButton.style.setProperty('outline', 'none', 'important');
        });
        cancelButton.addEventListener('focus', () => {
          cancelButton.style.setProperty('outline', '3px solid #5965d8', 'important');
          cancelButton.style.setProperty('outline-offset', '3px', 'important');
        });
        cancelButton.addEventListener('blur', () => {
          if (selectedConfirmButton !== cancelButton) cancelButton.style.setProperty('outline', 'none', 'important');
        });
        submitButton.addEventListener('pointerdown', showRegistering, { capture: true });
        submitButton.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') showRegistering();
        }, { capture: true });
        let submitReady=false,submitPreparing=false;
        submitButton.addEventListener('click', async event => {
          if(!submitReady){
            event.preventDefault();event.stopImmediatePropagation();if(submitPreparing)return;submitPreparing=true;
            try{const response=await chrome.runtime.sendMessage({ type:'POST_CONFIRM_WAIT',mediaShelfIds:imageDone?draft.mediaShelfIds || []:[] });if(!response?.success)throw new Error('등록 준비 확인에 실패했습니다.');submitReady=true;submitButton.click();}
            catch(error){if(status)status.textContent=error.message;}
            finally{submitPreparing=false;}return;
          }
          showRegistering();
          chrome.runtime.sendMessage({ type: 'POST_CONFIRM_WAIT', mediaShelfIds: imageDone ? draft.mediaShelfIds || [] : [] });
          setTimeout(showProcessingScreen, isYoutube ? 350 : 0);
          setTimeout(() => {
            if (!window.location.pathname.includes('/write') || !submitButton.isConnected) return;
            hideProcessingScreen();
            setSubmitLabel(originalSubmitLabel);
            if (status) {
              status.textContent = '글쓰기 준비가 완료되었습니다.';
              status.style.color = '#555';
              status.style.fontWeight = '400';
            }
          }, 1800);
        }, { capture: true });
        chrome.runtime.sendMessage({ type: 'POST_READY' });
        setTimeout(() => setConfirmFocus(submitButton), 180);

        if (dcconButton) {
          dcconButton.addEventListener('click', () => {
            confirmLayer.style.display = 'none';
            cancelButton.style.display = 'none';
            submitButton.style.display = 'none';
            document.documentElement.style.setProperty('overflow', 'auto', 'important');
            document.body.style.setProperty('overflow', 'auto', 'important');
            chrome.runtime.sendMessage({ type: 'RESIZE_POST_WINDOW', mode: 'expanded' });

            const returnButton = document.createElement('button');
            returnButton.type = 'button';
            returnButton.textContent = '확인창으로 돌아가기';
            returnButton.style.cssText = 'position:fixed;right:18px;top:18px;z-index:2147483647;padding:10px 14px;border:2px solid #5965d8;border-radius:8px;background:#fff;color:#5965d8;font-weight:800;cursor:pointer;';
            returnButton.addEventListener('click', () => {
              returnButton.remove();
              confirmLayer.style.display = 'flex';
              cancelButton.style.display = '';
              submitButton.style.display = '';
              document.documentElement.style.setProperty('overflow', 'hidden', 'important');
              document.body.style.setProperty('overflow', 'hidden', 'important');
              chrome.runtime.sendMessage({ type: 'RESIZE_POST_WINDOW', mode: 'compact' });
              setTimeout(() => setConfirmFocus(submitButton), 180);
            });
            document.body.appendChild(returnButton);

            setTimeout(() => {
              const dcconControl = Array.from(document.querySelectorAll('button, a, input[type="button"]'))
                .find(element => /디시콘/.test((element.textContent || element.value || '').trim()) && element !== dcconButton);
              dcconControl?.focus({ preventScroll: false });
              dcconControl?.scrollIntoView({ block: 'center' });
            }, 300);
          });
        }
        console.log('[Chzzk VS DC] 입력 완료, 실제 등록 버튼 클릭 대기');
      }

      // 메인 월드 SmartEditor2 스크립트 1회 실행
      disableAutoJjalbang();
      await clearAutoJjalbangFromEditor();
      injectMainWorldEditorScript();

      // 최초 시도
      let titleDone = applyTitle();
      let bodyDone = applyToIframes() || applyToTextareas();
      await applyImageLikeBroadcastHelper();

      if (titleDone && bodyDone && imageDone) {
        finishAndPrepareSubmit();
        return;
      }

      // 로딩 지연을 대비한 폴링 (성공 즉시 인터벌 중단 및 스토리지 삭제)
      let attempts = 0;
      let polling = false;
      const interval = setInterval(async () => {
        if (polling || imageAttempting) return;
        polling = true;
        attempts++;
        try {
          disableAutoJjalbang();
          if (!titleDone) titleDone = applyTitle();
          if (!isBodyApplied) bodyDone = applyToIframes() || applyToTextareas();
          if (!imageDone) await applyImageLikeBroadcastHelper();

          if (titleDone && isBodyApplied && imageDone) {
            clearInterval(interval);
            finishAndPrepareSubmit();
          } else if (attempts >= 1) {
            clearInterval(interval);
            chrome.runtime.sendMessage({ type: 'POST_NEEDS_ATTENTION', reason: imageDone ? '글쓰기 입력을 완료하지 못했습니다.' : 'WebP 이미지 업로드를 확인하지 못했습니다.' });
          }
        } finally { polling = false; }
      }, 150);

    } catch (e) {
      console.error('[Chzzk VS DC] 초안 적용 오류:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndApplyDraft);
  } else {
    checkAndApplyDraft();
  }
})();
