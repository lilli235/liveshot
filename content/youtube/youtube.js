/**
 * ============================================================================
 * [라이브샷] YouTube 캡처 및 중계글 작성 모듈
 * 
 * @file        content/youtube/youtube-capture.js
 * @description 유튜브 라이브 화면 원클릭 캡처 및 디시인사이드 중계글 자동 작성 연동
 * @author      LiveShot
 * @version     1.0.0
 * @updated     2026-09-05
 * ============================================================================
 */

(function () {
  'use strict';

  console.log('[Chzzk VS YouTube] 유튜브 라이브 연동 모듈 로드 완료');

  // ─── 토스트 알림 헬퍼 ───
  function showToast(message, duration = 2500) {
    let toast = document.getElementById('yt-chzzk-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yt-chzzk-toast';
      toast.className = 'yt-draft-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toast.__hideTimer);
    toast.__hideTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // ─── HTML 이스케이프 헬퍼 ───
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── 클립보드 이미지 복사 헬퍼 ───
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
        return true;
      }
    } catch (err) {
      console.warn('[Chzzk VS YouTube] 클립보드 복사 실패:', err);
    }
    return false;
  }

  // ─── 유튜브 비디오 엘리먼트 탐색 ───
  function findYouTubeVideo() {
    const activeShort = document.querySelector('ytd-reel-video-renderer[is-active] video, ytd-reel-video-renderer[active] video, ytd-shorts[is-active] video');
    if (activeShort?.videoWidth && activeShort.getClientRects().length) return activeShort;
    const videos = Array.from(document.querySelectorAll('video.html5-main-video, #movie_player video, video'));
    return videos.filter(video => {
      const rect = video.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
      return Number(!b.paused) - Number(!a.paused) || br.width * br.height - ar.width * ar.height;
    })[0] || videos[0] || null;
  }

  function hasPlayableYouTubeVideo() {
    const routeHasPlayer = location.pathname === '/watch' || /^\/(?:live|shorts|embed)\//i.test(location.pathname);
    const video = findYouTubeVideo();
    return Boolean(routeHasPlayer && video?.isConnected && video.videoWidth && video.videoHeight);
  }

  // ─── 채널명/스트리머명 중복 제거 및 정제 헬퍼 ───
  function cleanChannelName(raw) {
    if (!raw) return '';
    let name = String(raw).replace(/\s+/g, ' ').trim();
    if (!name) return '';
    
    // 1. 공백 기준 단어 중복 (예: "YTN YTN" -> "YTN")
    const words = name.split(' ');
    if (words.length >= 2 && words.length % 2 === 0) {
      const half = words.length / 2;
      const first = words.slice(0, half).join(' ');
      const second = words.slice(half).join(' ');
      if (first.toLowerCase() === second.toLowerCase()) {
        name = first;
      }
    }
    
    // 2. 글자 자체 반복 (예: "YTN YTN")
    const spaceDoubleMatch = name.match(/^(.+?)\s+\1$/i);
    if (spaceDoubleMatch) {
      name = spaceDoubleMatch[1];
    }

    return name.trim();
  }

  // ─── 유튜브 라이브/영상 메타데이터 추출 ───
  function getYouTubeMetadata() {
    let title = '';
    let streamer = '';
    let liveUrl = window.location.href;

    // 1. 방송 제목
    const titleEl = document.querySelector(
      'ytd-reel-video-renderer[is-active] #overlay #title, ytd-reel-video-renderer[is-active] [id="title"], #title h1 yt-formatted-string, #title h1, h1.ytd-watch-metadata yt-formatted-string, h1.title, #above-the-fold #title'
    );
    if (titleEl) {
      title = (titleEl.innerText || titleEl.textContent || '').trim();
    }
    if (!title) {
      title = document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
    }

    // 2. 채널명 (스트리머/유튜버) - 자식 text 링크 태그 최우선 탐색
    const channelAnchor = document.querySelector(
      'ytd-reel-video-renderer[is-active] #channel-name a, ytd-reel-video-renderer[is-active] a[href^="/@"], #owner #channel-name a, ytd-channel-name #text a, ytd-channel-name a.yt-formatted-string, #upload-info #channel-name a, #owner-name a'
    );
    if (channelAnchor) {
      streamer = cleanChannelName(channelAnchor.innerText || channelAnchor.textContent);
    }

    if (!streamer) {
      const channelEl = document.querySelector(
        'ytd-channel-name #text, #owner #channel-name, #upload-info #channel-name, ytd-video-owner-renderer #channel-name'
      );
      if (channelEl) {
        streamer = cleanChannelName(channelEl.innerText || channelEl.textContent);
      }
    }

    if (!streamer) {
      streamer = '유튜버';
    }

    // 3. 간결한 라이브 URL 및 Video ID 생성
    let videoId = '';
    try {
      const urlObj = new URL(window.location.href);
      const v = urlObj.searchParams.get('v');
      if (v) {
        videoId = v;
        liveUrl = `https://www.youtube.com/watch?v=${v}`;
      } else if (urlObj.pathname.startsWith('/live/')) {
        videoId = urlObj.pathname.replace('/live/', '').split('/')[0].split('?')[0];
        liveUrl = `https://www.youtube.com/watch?v=${videoId}`;
      } else if (urlObj.pathname.startsWith('/shorts/')) {
        videoId = urlObj.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
        liveUrl = `https://www.youtube.com/shorts/${videoId}`;
      }
    } catch (e) { }

    if (!videoId) {
      const match = window.location.href.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|shorts\/))([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
    }

    return { title, streamer, liveUrl, videoId };
  }

  // ─── 유튜브 비디오 프레임 캡처 엔진 ───
  async function captureYouTubeFrame() {
    const video = findYouTubeVideo();
    if (!video) {
      showToast('재생 중인 유튜브 비디오를 찾을 수 없습니다.');
      return null;
    }

    // 1단계: Canvas 직접 캡처 시도 (100% 원본 해상도)
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
          return { dataUrl, blob, width: w, height: h };
        }
      } catch (corsErr) {
        console.warn('[Chzzk VS YouTube] Canvas 직접 캡처 실패, 탭 캡처 폴백 진행:', corsErr);
      }
    }

    // 2단계: 백그라운드 탭 캡처 + 비디오 영역 크롭
    try {
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
        const rect = video.getBoundingClientRect();

        const cropX = Math.max(0, rect.left * scaleX);
        const cropY = Math.max(0, rect.top * scaleY);
        const cropW = Math.min(img.naturalWidth - cropX, rect.width * scaleX);
        const cropH = Math.min(img.naturalHeight - cropY, rect.height * scaleY);

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const dataUrl = canvas.toDataURL('image/png');
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        return { dataUrl, blob, width: cropW, height: cropH };
      }
    } catch (e) {
      console.error('[Chzzk VS YouTube] 탭 캡처 오류:', e);
    }

    showToast('비디오 화면 캡처에 실패했습니다.');
    return null;
  }

  // ─── 디시 글쓰기 연동 모달 오픈 ───
  let youtubeDraftRevision = 0;
  async function openYouTubeDraftModal() {
    if (!hasPlayableYouTubeVideo()) {
      showToast('재생 중인 플레이어가 없어 중계글을 작성할 수 없습니다.');
      return false;
    }
    const revision = ++youtubeDraftRevision;
    document.getElementById('yt-chzzk-draft-modal-overlay')?.remove();
    window.ChzzkVS?.gallery?.resetWebpEditorSettings?.();
    const webpCaptureAnchorTime = findYouTubeVideo()?.currentTime;
    const webpCaptureFrames = window.ChzzkVS?.gallery?.getRecentAnimatedFrames?.() || [];

    showToast('유튜브 화면 캡처 중...');
    let captureResult = await captureYouTubeFrame();
    if (!captureResult || revision !== youtubeDraftRevision) return;

    // 클립보드에 이미지 즉시 복사
    copyImageToClipboard(captureResult.blob || captureResult.dataUrl);

    const meta = getYouTubeMetadata();
    let destinations = [
      { id: 'virtual_streamer', name: '버츄얼 스트리머 미니 갤러리', url: 'https://gall.dcinside.com/mini/board/lists/?id=virtual_streamer' }
    ];
    const savedDestinations = await chrome.storage.sync.get(['galleryDestinations', 'selectedGalleryUrl', 'dcconFavorites', 'dcconFolders', 'dcconFolderCovers']);
    const savedDcconPreviews = await chrome.storage.local.get({ dcconPreviewCache: {}, dcconFavorites: null, dcconFolders: null, dcconFolderCovers: null, dcconRecentIds: [] });
    const dcconPreviewCache = savedDcconPreviews.dcconPreviewCache || {};
    if (Array.isArray(savedDestinations.galleryDestinations) && savedDestinations.galleryDestinations.length) {
      destinations = savedDestinations.galleryDestinations.filter(item => item?.name && item?.url);
    }
    destinations = destinations.map(item => ({ ...item, name: String(item.name).replace(/(갤러리)\s*(마이너|미니)\s*$/gi, '$1').replace(/\s+(마이너|미니)(?=\s*갤러리|\s*$)/gi, '').replace(/\s+/g, ' ').trim() }));
    let selectedUrl = destinations.some(item => item.url === savedDestinations.selectedGalleryUrl)
      ? savedDestinations.selectedGalleryUrl : destinations[0].url;
    let activeDest = destinations.find(item => item.url === selectedUrl) || destinations[0];
    const dcconFavorites = Array.isArray(savedDcconPreviews.dcconFavorites) ? savedDcconPreviews.dcconFavorites : (Array.isArray(savedDestinations.dcconFavorites) ? savedDestinations.dcconFavorites : []);
    const dcconFolders = Array.isArray(savedDcconPreviews.dcconFolders) && savedDcconPreviews.dcconFolders.length ? savedDcconPreviews.dcconFolders : (Array.isArray(savedDestinations.dcconFolders) && savedDestinations.dcconFolders.length ? savedDestinations.dcconFolders : ['기본']);
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
      const folderButtons = pickerFolders.map(folder => `<button type="button" class="yt-draft-mini-btn" data-yt-dccon-folder="${escapeHtml(folder.key)}" title="${escapeHtml(folder.label)}" style="width:44px;height:44px;min-width:44px;padding:3px;">${folder.icon || (folder.cover ? `<img src="${escapeHtml(dcconPreviewCache[folder.cover] || folder.cover)}" alt="${escapeHtml(folder.label)}" style="width:100%;height:100%;object-fit:contain;border-radius:5px;">` : '📁')}</button>`).join('');
      const panels = pickerFolders.map(folder => {
        const entries = folder.entries;
        const pages = Math.max(1, Math.ceil(entries.length / pageSize));
        const items = entries.map((entry, localIndex) => `<button type="button" data-yt-add-dccon="${entry.dcIndex}" data-yt-dccon-page-item="${Math.floor(localIndex / pageSize)}" title="${escapeHtml(entry.item.name)}" style="display:${localIndex < pageSize ? 'block' : 'none'};width:100%;height:76px;box-sizing:border-box;padding:2px;border:1px solid #3d4350;border-radius:6px;background:#0f1115;cursor:pointer;"><img src="${escapeHtml(dcconPreviewCache[entry.item.url] || entry.item.url)}" alt="${escapeHtml(entry.item.name)}" style="display:block;width:100%;height:100%;object-fit:contain;"></button>`).join('');
        return `<div data-yt-dccon-panel="${escapeHtml(folder.key)}" data-page="0" data-pages="${pages}" style="display:none;position:absolute;left:0;top:50px;width:520px;max-height:380px;overflow:auto;box-sizing:border-box;padding:10px;background:#171a1f;color:#fff;border:1px solid #5965d8;border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.6);z-index:20;"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px;">${items}</div>${pages > 1 ? `<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:9px;color:#fff;"><button type="button" data-yt-dccon-page-prev style="background:#292d36;color:#fff;border:1px solid #4a5060;border-radius:5px;">‹</button><span data-yt-dccon-page-label style="color:#fff;">1 / ${pages}</span><button type="button" data-yt-dccon-page-next style="background:#292d36;color:#fff;border:1px solid #4a5060;border-radius:5px;">›</button></div>` : ''}</div>`;
      }).join('');
      return `<div style="position:relative;display:flex;align-items:center;gap:5px;max-width:390px;">${arrows ? '<button type="button" class="yt-draft-mini-btn" data-yt-folder-scroll="-1" style="min-width:28px;height:44px;padding:3px;">‹</button>' : ''}<div data-yt-folder-strip style="display:flex;gap:6px;overflow:hidden;scroll-behavior:smooth;">${folderButtons}</div>${arrows ? '<button type="button" class="yt-draft-mini-btn" data-yt-folder-scroll="1" style="min-width:28px;height:44px;padding:3px;">›</button>' : ''}${panels}</div>`;
    };
    const selectedDccons = [];
    let dcconPosition = 'after';

    const overlay = document.createElement('div');
    overlay.id = 'yt-chzzk-draft-modal-overlay';
    overlay.className = 'yt-draft-modal-overlay';

    overlay.innerHTML = `
      <div class="yt-draft-modal">
        <div class="yt-draft-header">
          <div class="yt-draft-title-group">
            <span style="font-size:18px;">📸</span>
            <span class="yt-draft-title">중계글 작성</span>
            <select class="yt-draft-badge" id="yt-draft-gallery-select" title="작성 갤러리 변경">
              ${destinations.map(d => `<option value="${escapeHtml(d.url)}" ${d.url === selectedUrl ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
          <button class="yt-draft-close" id="yt-draft-modal-close">&times;</button>
        </div>

        <div class="yt-draft-body">
          <!-- 캡쳐 이미지 프리뷰 -->
          <div class="yt-draft-preview-wrap">
            <img class="yt-draft-preview-img" src="${captureResult.dataUrl}" alt="유튜브 화면 캡쳐">
            <div class="yt-draft-capture-timeline" id="yt-draft-capture-timeline" hidden><input type="range" id="yt-draft-capture-range" min="0" max="1" step="0.1" value="1"><span id="yt-draft-capture-label">현재</span></div>
            <div class="yt-draft-thumb-bar">
              <span class="yt-draft-res">${captureResult.width} × ${captureResult.height}</span>
              <div class="yt-draft-thumb-actions">
                <button type="button" class="yt-draft-mini-btn" id="yt-make-webp-btn" title="영상 구간을 움직이는 WebP로 만들기">🎞️ 움짤 만들기</button>
                <button type="button" class="yt-draft-mini-btn" id="yt-edit-webp-btn" title="현재 캡처 화면 편집">✏️ 편집</button>
                <button type="button" class="yt-draft-mini-btn" id="yt-save-img-btn" title="PNG 파일 다운로드">
                  💾 저장
                </button>
              </div>
            </div>
          </div>

          <!-- 게시판 선택 (임시 비활성화: 버스갤 고정)
          <div class="yt-draft-form-group">
            <div class="yt-draft-field-head">
              <span class="yt-draft-form-label">📌 작성 대상 게시판 (URL)</span>
            </div>
            <select class="yt-draft-select" id="yt-draft-gallery-select">
              ${destinations.map(d => `<option value="${escapeHtml(d.url)}" ${d.url === selectedUrl ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
          -->

          <!-- 1. 글 제목 -->
          <div class="yt-draft-form-group">
            <div class="yt-draft-field-head">
              <span class="yt-draft-form-label">📝 글 제목</span>
            </div>
            <input type="text" class="yt-draft-input" id="yt-draft-title-input" placeholder="글 제목을 입력하세요" value="" autocomplete="off" autocorrect="off" spellcheck="false" required>
          </div>

          <!-- 3. 추가 본문 내용 -->
          <div class="yt-draft-form-group">
            <div class="yt-draft-field-head">
              <span class="yt-draft-form-label">📄 본문 내용</span>
            </div>
            <div id="yt-body-composer" style="display:flex;flex-direction:column;border:1px solid #3d4350;border-radius:9px;background:#101216;overflow:hidden;">
              <textarea class="yt-draft-textarea" id="yt-draft-body-input" placeholder="본문 내용 또는 디시콘을 입력하세요" style="border:0;border-radius:0;background:transparent;" required></textarea>
              <div id="yt-selected-dccons" style="position:relative;display:flex;gap:6px;flex-wrap:wrap;padding:8px 30px 8px 10px;transition:transform .22s ease;"></div>
            </div>
          </div>
        </div>

        <div class="yt-draft-footer">
          ${renderDcconPicker()}
          <div class="yt-draft-btn-group">
            <button type="button" class="yt-draft-btn yt-draft-btn-primary" id="yt-draft-submit-btn">
              작성
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const draftModal = overlay.querySelector('.yt-draft-modal');
    const dragHandle = overlay.querySelector('.yt-draft-header');
    const repositionOpenDcconPanel = () => {
      overlay.querySelectorAll('[data-yt-dccon-panel]').forEach(panel => {
        if (panel.style.display === 'none') return;
        const button = draftModal.querySelector(`[data-yt-dccon-folder="${CSS.escape(panel.dataset.ytDcconPanel)}"]`);
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const modalRect = draftModal.getBoundingClientRect();
        panel.style.left = `${modalRect.left}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.width = `${modalRect.width}px`;
        panel.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 18)}px`;
      });
    };
    let dragState = null;
    dragHandle.addEventListener('pointerdown', event => {
      if (event.target.closest('button, a, input, select')) return;
      const rect = draftModal.getBoundingClientRect();
      draftModal.style.setProperty('left', `${rect.left}px`, 'important');
      draftModal.style.setProperty('top', `${rect.top}px`, 'important');
      draftModal.style.setProperty('right', 'auto', 'important');
      dragState = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener('pointermove', event => {
      if (!dragState) return;
      draftModal.style.setProperty('left', `${Math.max(0, Math.min(window.innerWidth - draftModal.offsetWidth, event.clientX - dragState.x))}px`, 'important');
      draftModal.style.setProperty('top', `${Math.max(0, Math.min(window.innerHeight - draftModal.offsetHeight, event.clientY - dragState.y))}px`, 'important');
      requestAnimationFrame(repositionOpenDcconPanel);
    });
    dragHandle.addEventListener('pointerup', () => { dragState = null; });
    dragHandle.addEventListener('pointercancel', () => { dragState = null; });

    const closeModal = (isCancel = true) => {
      if (isCancel) {
        chrome.storage?.local?.remove('chzzk_gallery_draft');
      }
      overlay.remove();
    };

    overlay.querySelector('#yt-draft-modal-close').addEventListener('click', () => closeModal(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(true);
    });

    const gallerySelect = overlay.querySelector('#yt-draft-gallery-select');
    const titleInput = overlay.querySelector('#yt-draft-title-input');
    const bodyInput = overlay.querySelector('#yt-draft-body-input');
    const selectedDcconList = overlay.querySelector('#yt-selected-dccons');
    const bodyComposer = overlay.querySelector('#yt-body-composer');
    const setupCaptureTimeline = async () => {
      const timeline = overlay.querySelector('#yt-draft-capture-timeline');
      const range = overlay.querySelector('#yt-draft-capture-range');
      const label = overlay.querySelector('#yt-draft-capture-label');
      const player = findYouTubeVideo();
      const youtubePlayer = player?.closest('.html5-video-player');
      const liveBadge = youtubePlayer?.querySelector('.ytp-live-badge');
      let publishedState = {};
      try { publishedState = JSON.parse(document.documentElement.dataset.chzzkVsYoutubePlayerState || '{}'); } catch (_) {}
      const isLivePlayer = Boolean(player) && (typeof publishedState.isLive === 'boolean' ? publishedState.isLive : (!Number.isFinite(player.duration) || youtubePlayer?.classList.contains('ytp-live') || Boolean(liveBadge && liveBadge.getClientRects().length)));
      const candidateSeekStart = player?.seekable?.length ? player.seekable.start(player.seekable.length - 1) : 0;
      const candidateSeekEnd = player?.seekable?.length ? player.seekable.end(player.seekable.length - 1) : player?.duration;
      const hasRewindRange = isLivePlayer
        ? Boolean(window.ChzzkVS?.gallery?.canUseYouTubeDvr?.())
        : Number.isFinite(candidateSeekEnd) && candidateSeekEnd - candidateSeekStart >= .1;
      if (player && (!isLivePlayer || hasRewindRange) && timeline && range && label) {
        const fullStart = candidateSeekStart; const fullEnd = candidateSeekEnd;
        const anchor = Math.max(fullStart, Math.min(fullEnd, webpCaptureAnchorTime ?? player.currentTime));
        const seekEnd = anchor;
        const seekStart = Math.max(fullStart, seekEnd - 15);
        if (Number.isFinite(seekEnd) && seekEnd - seekStart > .1) {
          const available = seekEnd - seekStart;
          range.min = '0'; range.max = available.toFixed(2); range.step = '0.1'; range.value = Math.max(0, Math.min(available, (webpCaptureAnchorTime ?? player.currentTime) - seekStart)).toFixed(2); timeline.hidden = false;
          let renderTimer = 0; let renderSerial = 0; let dragging = false;
          const formatTime = seconds => { const safe = Math.max(0, Number(seconds) || 0); const h = Math.floor(safe / 3600); const m = Math.floor((safe % 3600) / 60); const s = String(Math.floor(safe % 60)).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`; };
          const updateLabel = () => { const ago = available - Number(range.value); label.textContent = ago < .15 ? '현재' : `-${ago.toFixed(1)}초`; };
          const renderPlayerFrame = async () => {
            const serial = ++renderSerial;
            if (player.seeking) await new Promise(resolve => player.addEventListener('seeked', resolve, { once: true }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (serial !== renderSerial || !overlay.isConnected) return;
            const canvas = document.createElement('canvas'); canvas.width = player.videoWidth; canvas.height = player.videoHeight;
            canvas.getContext('2d').drawImage(player, 0, 0); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob || serial !== renderSerial) return;
            const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
            captureResult = { dataUrl, blob, width: canvas.width, height: canvas.height };
            const preview = overlay.querySelector('.yt-draft-preview-img'); const resolution = overlay.querySelector('.yt-draft-res');
            if (preview) preview.src = dataUrl; if (resolution) resolution.textContent = `${canvas.width} × ${canvas.height}`;
          };
          const seekFromBar = () => { player.currentTime = seekStart + Number(range.value); updateLabel(); clearTimeout(renderTimer); renderTimer = setTimeout(renderPlayerFrame, 70); };
          range.addEventListener('pointerdown', () => { dragging = true; });
          range.addEventListener('pointerup', () => { dragging = false; seekFromBar(); });
          range.addEventListener('pointercancel', () => { dragging = false; });
          range.addEventListener('input', seekFromBar); range.addEventListener('change', seekFromBar);
          player.addEventListener('timeupdate', () => { if (!dragging && timeline.isConnected) { range.value = String(Math.max(0, Math.min(available, player.currentTime - seekStart))); updateLabel(); } });
          updateLabel(); return;
        }
      }
      let frames = window.ChzzkVS?.gallery?.getRecentStillFrames?.() || [];
      if (frames.length < 2) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        frames = window.ChzzkVS?.gallery?.getRecentStillFrames?.() || [];
      }
      if (frames.length < 2 || !timeline || !range || !label) return;
      const firstTime = frames[0].time; const lastTime = frames[frames.length - 1].time;
      const available = Math.max(.1, (lastTime - firstTime) / 1000);
      range.max = available.toFixed(1); range.value = available.toFixed(1); timeline.hidden = false;
      let renderTimer = 0; let renderSerial = 0;
      const selectedFrame = () => {
        const target = firstTime + Number(range.value) * 1000;
        return frames.reduce((best, frame) => Math.abs(frame.time - target) < Math.abs(best.time - target) ? frame : best, frames[0]);
      };
      const updateLabel = () => {
        const ago = available - Number(range.value);
        label.textContent = ago < .15 ? '현재' : `-${ago.toFixed(1)}초`;
      };
      const renderFrame = async () => {
        const serial = ++renderSerial; const frame = selectedFrame(); const bitmap = await createImageBitmap(frame.blob);
        const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (serial !== renderSerial || !blob || !overlay.isConnected) return;
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        captureResult = { dataUrl, blob, width: canvas.width, height: canvas.height };
        const preview = overlay.querySelector('.yt-draft-preview-img'); const resolution = overlay.querySelector('.yt-draft-res');
        if (preview) preview.src = dataUrl; if (resolution) resolution.textContent = `${canvas.width} × ${canvas.height}`;
      };
      range.addEventListener('input', () => { updateLabel(); clearTimeout(renderTimer); renderTimer = setTimeout(renderFrame, 70); });
      range.addEventListener('change', () => { clearTimeout(renderTimer); renderFrame(); }); updateLabel();
    };
    setupCaptureTimeline().catch(error => console.warn('[Chzzk VS YouTube] 캡처 바 준비 실패:', error));
    const applyDcconPosition = (animate = false) => {
      const oldBody = bodyInput.getBoundingClientRect();
      const oldDccon = selectedDcconList.getBoundingClientRect();
      bodyInput.style.order = dcconPosition === 'before' ? '2' : '1';
      selectedDcconList.style.order = dcconPosition === 'before' ? '1' : '2';
      if (!animate) return;
      const newBody = bodyInput.getBoundingClientRect();
      const newDccon = selectedDcconList.getBoundingClientRect();
      bodyInput.animate([{ transform: `translateY(${oldBody.top - newBody.top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      selectedDcconList.animate([{ transform: `translateY(${oldDccon.top - newDccon.top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };
    let suppressDcconClickUntil = 0;
    const renderSelectedDccons = () => {
      selectedDcconList.innerHTML = selectedDccons.map((item, index) => `<button type="button" data-yt-remove-dccon="${index}" title="클릭하여 제거 · 끌어서 이동" style="width:72px;height:72px;padding:2px;border:0;border-radius:7px;background:#101114;cursor:grab;touch-action:none;"><img src="${escapeHtml(dcconPreviewCache[item.url] || item.url)}" alt="${escapeHtml(item.name)}" draggable="false" style="width:100%;height:100%;object-fit:contain;pointer-events:none;"></button>`).join('') + (selectedDccons.length ? '<button type="button" data-yt-dccon-grip title="잡아 올리거나 내려 본문과 위치 변경" style="position:absolute;top:8px;right:4px;bottom:8px;width:22px;border:0;border-radius:6px;background:#292d36;color:#d4d8e2;cursor:ns-resize;touch-action:none;font-size:18px;font-weight:800;">↕</button>' : '');
      selectedDcconList.querySelectorAll('[data-yt-remove-dccon]').forEach(button => {
        button.addEventListener('click', () => { if (performance.now() < suppressDcconClickUntil) return; selectedDccons.splice(Number(button.dataset.ytRemoveDccon), 1); renderSelectedDccons(); });
        button.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          const startIndex = Number(button.dataset.ytRemoveDccon); const startX = event.clientX; const startY = event.clientY;
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
            if (dragMode === 'horizontal' && up.clientX >= listRect.left && up.clientX <= listRect.right && up.clientY >= listRect.top && up.clientY <= listRect.bottom) selectedDcconList.querySelectorAll('[data-yt-remove-dccon]').forEach(candidate => { if (candidate === button) return; const rect = candidate.getBoundingClientRect(); const distance = Math.hypot(up.clientX - (rect.left + rect.width / 2), up.clientY - (rect.top + rect.height / 2)); if (distance < nearest) { nearest = distance; targetIndex = Number(candidate.dataset.ytRemoveDccon); } });
            if (targetIndex !== startIndex) { const [moved] = selectedDccons.splice(startIndex, 1); selectedDccons.splice(targetIndex, 0, moved); }
            renderSelectedDccons();
          };
          button.onpointerup = stop; button.onpointercancel = stop;
        });
      });
      const grip = selectedDcconList.querySelector('[data-yt-dccon-grip]');
      if (grip) grip.addEventListener('pointerdown', event => { const rect = bodyComposer.getBoundingClientRect(); const boundary = rect.top + rect.height / 2; grip.setPointerCapture(event.pointerId); grip.onpointermove = move => { const nextPosition = move.clientY < boundary ? 'before' : 'after'; if (nextPosition !== dcconPosition) { dcconPosition = nextPosition; applyDcconPosition(true); } }; const stop = () => { grip.onpointermove = null; grip.onpointerup = null; grip.onpointercancel = null; }; grip.onpointerup = stop; grip.onpointercancel = stop; });
      applyDcconPosition();
    };
    overlay.querySelectorAll('[data-yt-dccon-folder]').forEach(button => button.addEventListener('click', () => {
      const panel = overlay.querySelector(`[data-yt-dccon-panel="${CSS.escape(button.dataset.ytDcconFolder)}"]`);
      overlay.querySelectorAll('[data-yt-dccon-panel]').forEach(item => { if (item !== panel) item.style.display = 'none'; });
      if (!panel) return;
      const shouldOpen = panel.style.display === 'none';
      if (!shouldOpen) { panel.style.display = 'none'; return; }
      const rect = button.getBoundingClientRect();
      const modalRect = draftModal.getBoundingClientRect();
      overlay.appendChild(panel);
      panel.style.position = 'fixed';
      panel.style.left = `${modalRect.left}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.width = `${modalRect.width}px`;
      panel.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 18)}px`;
      panel.style.pointerEvents = 'auto';
      panel.style.display = 'block';
    }));
    overlay.querySelectorAll('[data-yt-folder-scroll]').forEach(button => button.addEventListener('click', () => {
      overlay.querySelector('[data-yt-folder-strip]')?.scrollBy({ left: Number(button.dataset.ytFolderScroll) * 260, behavior: 'smooth' });
    }));
    const folderStrip = overlay.querySelector('[data-yt-folder-strip]');
    if (folderStrip) { let folderDrag = null; let folderScrollFrame = 0; folderStrip.addEventListener('pointerdown', event => { folderDrag = { pointerId: event.pointerId, x: event.clientX, left: folderStrip.scrollLeft, next: folderStrip.scrollLeft, moved: false }; }); folderStrip.addEventListener('pointermove', event => { if (!folderDrag) return; const delta = event.clientX - folderDrag.x; if (!folderDrag.moved && Math.abs(delta) > 3) { folderDrag.moved = true; folderStrip.style.scrollBehavior = 'auto'; try { folderStrip.setPointerCapture(folderDrag.pointerId); } catch (_) {} } if (!folderDrag.moved) return; folderDrag.next = folderDrag.left - delta; if (!folderScrollFrame) folderScrollFrame = requestAnimationFrame(() => { folderScrollFrame = 0; if (folderDrag) folderStrip.scrollLeft = folderDrag.next; }); }); const stopFolderDrag = event => { if (!folderDrag) return; if (folderDrag.moved) { event.preventDefault(); event.stopPropagation(); folderStrip.style.scrollBehavior = 'smooth'; } folderDrag = null; }; folderStrip.addEventListener('pointerup', stopFolderDrag); folderStrip.addEventListener('pointercancel', stopFolderDrag); folderStrip.addEventListener('dragstart', event => event.preventDefault()); }
    const changeDcconPage = (button, delta) => {
      const panel = button.closest('[data-yt-dccon-panel]');
      const pages = Number(panel?.dataset.pages || 1);
      const page = Math.max(0, Math.min(pages - 1, Number(panel?.dataset.page || 0) + delta));
      if (!panel) return;
      panel.dataset.page = String(page);
      panel.querySelectorAll('[data-yt-dccon-page-item]').forEach(item => { item.style.display = Number(item.dataset.ytDcconPageItem) === page ? 'block' : 'none'; });
      const label = panel.querySelector('[data-yt-dccon-page-label]');
      if (label) label.textContent = `${page + 1} / ${pages}`;
    };
    overlay.querySelectorAll('[data-yt-dccon-page-prev]').forEach(button => button.addEventListener('click', () => changeDcconPage(button, -1)));
    overlay.querySelectorAll('[data-yt-dccon-page-next]').forEach(button => button.addEventListener('click', () => changeDcconPage(button, 1)));
    overlay.querySelectorAll('[data-yt-add-dccon]').forEach(button => button.addEventListener('click', () => { const item = dcconFavorites[Number(button.dataset.ytAddDccon)]; if (item) { selectedDccons.push(item); chrome.storage.local.get({ dcconRecentIds: [] }).then(data => chrome.storage.local.set({ dcconRecentIds: [item.id, ...data.dcconRecentIds.filter(id => id !== item.id)].slice(0, 48) })); } renderSelectedDccons(); overlay.querySelectorAll('[data-yt-dccon-panel]').forEach(panel => { panel.style.display = 'none'; }); bodyInput.focus(); }));
    const submitBtn = overlay.querySelector('#yt-draft-submit-btn');
    const destBadge = overlay.querySelector('#yt-gallery-dest-badge');
    titleInput.focus();

    if (gallerySelect) {
      gallerySelect.addEventListener('change', async () => {
        selectedUrl = gallerySelect.value;
        const selected = destinations.find(d => d.url === gallerySelect.value);
        if (selected && destBadge) {
          destBadge.textContent = selected.name || '게시판';
        }
        await chrome.storage.sync.set({ selectedGalleryUrl: selectedUrl });
      });
    }

    // 이미지 저장 (다운로드)
    let hasAnimatedResult = Boolean(captureResult?.animated);
    let fixedWebpSettings = captureResult?.webpEditorSettings ? { ...captureResult.webpEditorSettings, crop: { ...captureResult.webpEditorSettings.crop } } : null;
    const applyEditedYouTubeResult = result => {
      captureResult = result; const preview = overlay.querySelector('.yt-draft-preview-img'); const resolution = overlay.querySelector('.yt-draft-res'); const saveButton = overlay.querySelector('#yt-save-img-btn');
      if (result.animated) { const captureBar = overlay.querySelector('#yt-draft-capture-timeline'); if (captureBar) { captureBar.hidden = true; captureBar.style.setProperty('display', 'none', 'important'); } }
      if (preview) preview.src = result.dataUrl;
      if (resolution) resolution.textContent = `${result.width} × ${result.height} · ${(result.blob.size / 1024 / 1024).toFixed(1)}MB · ${result.animated ? `${result.fps ? `${result.fps.toFixed(1)}fps · ` : ''}WebP` : 'PNG'}`;
      if (saveButton) { saveButton.title = `${result.animated ? 'WebP' : 'PNG'} 파일 다운로드`; saveButton.textContent = '💾 저장'; }
    };
    globalThis.liveShotMediaShelf.mount(overlay, '.yt-draft-preview-img', () => captureResult, result => {
      hasAnimatedResult = Boolean(result.animated); fixedWebpSettings = null; applyEditedYouTubeResult(result);
      overlay.querySelector('#yt-edit-webp-btn').disabled=Boolean(result.shelfPreviewOnly);
      overlay.querySelector('#yt-save-img-btn').disabled=Boolean(result.shelfPreviewOnly);
    });
    const openWebpEditorForYouTube = (editingExisting = false, fromMake = false) => {
      if (editingExisting && captureResult?.fromShelf) { showToast('임시저장 움짤은 원본 영상 연결이 없어 재편집할 수 없습니다. 첨부와 저장은 가능합니다.'); return; }
      if (overlay.dataset.webpOpening === 'true' || document.getElementById('chzzk-webp-editor')) return null;
      overlay.dataset.webpOpening = 'true';
      const openEditor = window.ChzzkVS?.gallery?.openAnimatedWebpEditor;
      if (!openEditor) { delete overlay.dataset.webpOpening; showToast('WebP 편집기를 불러오지 못했습니다.'); return; }
      const captureBar = overlay.querySelector('#yt-draft-capture-timeline');
      if (captureBar) captureBar.style.setProperty('display', 'none', 'important');
      const opening = openEditor(async result => {
        if (result.webpEditorSettings) fixedWebpSettings = { ...result.webpEditorSettings, crop: { ...result.webpEditorSettings.crop } };
        hasAnimatedResult = true; overlay.querySelector('#yt-edit-webp-btn').title = '만든 움짤의 구간과 화면을 다시 편집'; applyEditedYouTubeResult(result);
      }, { captureAnchorTime: webpCaptureAnchorTime, cachedFrames: webpCaptureFrames, draftModal: overlay, sourcePlatform: 'youtube', draftPreviewAnimated: Boolean(captureResult?.animated), settingsMode: editingExisting ? 'edit' : 'make', returnToMake: fromMake, editResult: editingExisting ? captureResult : null, initialSettings: editingExisting ? fixedWebpSettings : null, onEditRequested: settings => { fixedWebpSettings = { ...settings, crop: { ...settings.crop } }; setTimeout(() => openWebpEditorForYouTube(true, true), 0); }, onBackRequested: () => setTimeout(() => openWebpEditorForYouTube(false), 0), onSettingsSaved: (settings, reason) => { if (reason === 'generated') { fixedWebpSettings = settings; if (captureResult?.animated) captureResult.webpEditorSettings = settings; } } });
      Promise.resolve(opening).then(() => { if (!document.getElementById('chzzk-webp-editor')) captureBar?.style.removeProperty('display'); }).finally(() => { delete overlay.dataset.webpOpening; });
      return opening;
    };
    overlay.querySelector('#yt-make-webp-btn').addEventListener('click', () => openWebpEditorForYouTube(false));
    overlay.querySelector('#yt-edit-webp-btn').addEventListener('click', () => { if (hasAnimatedResult) openWebpEditorForYouTube(true); else window.ChzzkVS?.gallery?.openStillImageEditor?.(captureResult, applyEditedYouTubeResult); });
    overlay.querySelector('#yt-save-img-btn').addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `YouTube_${meta.streamer || 'Live'}_${Date.now()}.${captureResult.animated ? 'webp' : 'png'}`;
      link.href = captureResult.dataUrl;
      link.click();
      showToast('이미지를 저장했습니다.');
    });

    // 디시 글쓰기 이동 및 자동 채우기 스토리지 저장
    submitBtn.addEventListener('click', async () => {
      if (captureResult?.animated && Number(captureResult.blob?.size) > 20 * 1024 * 1024) {
        showToast(`움짤 용량이 ${(captureResult.blob.size / 1024 / 1024).toFixed(1)}MB로 20MB를 초과해 글을 작성할 수 없습니다. 크기나 프레임을 줄여 주세요.`);
        return;
      }
      const targetGalleryUrl = (gallerySelect && gallerySelect.value) || selectedUrl;
      const customTitle = titleInput.value.trim();
      const customBody = bodyInput.value.trim();
      if (!customTitle || (!customBody && !selectedDccons.length)) {
        (!customTitle ? titleInput : bodyInput).focus();
        showToast('글 제목과 본문 내용 또는 디시콘을 입력해 주세요.');
        return;
      }

      // 디시 글쓰기 페이지 URL 계산
      let writeUrl = targetGalleryUrl;
      if (writeUrl.includes('/lists')) {
        writeUrl = writeUrl.replace('/lists', '/write');
      } else if (!writeUrl.includes('/write')) {
        writeUrl = writeUrl.replace(/\/?$/, '/write');
      }

      if (writeUrl.includes('dcinside.com') && !writeUrl.includes('#')) {
        writeUrl = writeUrl + '#chzzk_draft=1';
      }

      // 초안 데이터 구성 (dc-autofill.js 호환)
      const draftPayload = {
        platform: 'YOUTUBE',
        streamer: meta.streamer,
        liveTitle: meta.title,
        cardTitle: meta.title,
        liveUrl: meta.liveUrl,
        videoId: meta.videoId,
        title: customTitle,
        body: customBody,
        dccons: selectedDccons,
        dcconPosition,
        imageDataUrl: captureResult.dataUrl,
        imageDataUrls: await globalThis.liveShotMediaShelf.urls(captureResult),
        mediaShelfIds: captureResult.shelfSubmissionIds || [],
        imageUrl: '',
        targetUrl: targetGalleryUrl,
        targetName: (destinations.find(item => item.url === targetGalleryUrl) || activeDest)?.name || '',
        autoSubmit: false,
        createdAt: Date.now(),
        isClip: false
      };

      await chrome.storage.local.set({ chzzk_gallery_draft: draftPayload });
      await chrome.storage.sync.set({ selectedGalleryUrl: targetGalleryUrl });

      showToast('작은 디시 등록 창을 엽니다...');
      overlay.dataset.pendingPost = '1';
      overlay.style.setProperty('display', 'none', 'important');
      chrome.runtime.sendMessage({ type: 'OPEN_URL', url: writeUrl, popup: true });
    });

    // 댓글 작성창처럼 Enter로 등록하고, Alt+Enter는 본문 줄바꿈으로 사용합니다.
    const handleDraftEnter = (e) => {
      if (e.key === 'Tab' && e.currentTarget === bodyInput) {
        e.preventDefault();
        titleInput.focus();
        return;
      }
      if (e.key !== 'Enter' || e.isComposing) return;
      if (e.shiftKey && e.currentTarget === bodyInput) {
        e.preventDefault();
        e.stopPropagation();
        bodyInput.setRangeText('\n', bodyInput.selectionStart, bodyInput.selectionEnd, 'end');
        bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (e.shiftKey) return;
      e.preventDefault();
      submitBtn.click();
    };
    titleInput.addEventListener('keydown', handleDraftEnter, true);
    bodyInput.addEventListener('keydown', handleDraftEnter, true);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ─── PIP 모드 토글 ───
  async function toggleYouTubePiP() {
    try {
      const video = findYouTubeVideo();
      if (!video) {
        showToast('재생 중인 비디오를 찾을 수 없습니다.');
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showToast('PIP 모드가 종료되었습니다.');
      } else {
        await video.requestPictureInPicture();
        showToast('PIP 모드가 시작되었습니다.');
      }
    } catch (err) {
      console.error('[Chzzk VS YouTube] PIP 전환 실패:', err);
      showToast('PIP 모드 전환에 실패했습니다.');
    }
  }

  // ─── 상단 헤더 YouTube VS 메뉴 버튼 및 드롭다운 주입 ───
  let ytShowQuickWidget = true;

  async function loadYouTubeSettings() {
    try {
      const data = await chrome.storage.sync.get({ showYoutubeQuickWidget: true });
      ytShowQuickWidget = Boolean(data.showYoutubeQuickWidget !== false);
      injectYouTubeHeaderMenu();
    } catch (e) {}
  }

  function injectYouTubeHeaderMenu() {
    const existing = document.getElementById('yt-chzzk-header-btn-wrap');

    // 토글이 꺼져 있으면 헤더 버튼 제거
    if (!ytShowQuickWidget) {
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      const button = existing.querySelector('#yt-chzzk-header-btn');
      const enabled = hasPlayableYouTubeVideo();
      if (button) { button.disabled = !enabled; button.title = enabled ? '중계글 작성' : '재생 중인 플레이어가 없습니다'; button.style.opacity = enabled ? '' : '.45'; }
      return;
    }

    // 유튜브 상단 헤더 우측 버튼 영역 탐색
    const headerEnd = document.querySelector(
      '#masthead #end #buttons, ytd-masthead #end #buttons, #masthead #end, ytd-masthead #end'
    );
    if (!headerEnd) return;

    const wrap = document.createElement('div');
    wrap.id = 'yt-chzzk-header-btn-wrap';
    wrap.style.cssText = 'position: relative; display: inline-flex; align-items: center;';

    wrap.innerHTML = `
      <button type="button" class="yt-chzzk-header-btn" id="yt-chzzk-header-btn" title="중계글 작성">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="13" viewBox="0 0 68 48" style="flex-shrink: 0; vertical-align: middle;">
          <path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.64 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#FF0000"/>
          <path d="M45 24 27 14v20" fill="#FFFFFF"/>
        </svg>
        <span>중계글 작성</span>
      </button>
    `;

    headerEnd.insertBefore(wrap, headerEnd.firstChild);

    const btn = wrap.querySelector('#yt-chzzk-header-btn');
    const enabled = hasPlayableYouTubeVideo();
    btn.disabled = !enabled;
    btn.title = enabled ? '중계글 작성' : '재생 중인 플레이어가 없습니다';
    btn.style.opacity = enabled ? '' : '.45';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openYouTubeDraftModal();
    });
  }

  // 실시간 스토리지 변경 감지 (헤더 버튼 ON/OFF 실시간 반영)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.showYoutubeQuickWidget !== undefined) {
      ytShowQuickWidget = Boolean(changes.showYoutubeQuickWidget.newValue !== false);
      injectYouTubeHeaderMenu();
    }
  });

  // ─── 유튜브 플레이어 컨트롤 바 캡처 버튼 주입 ───
  function injectYouTubeControlsButton() {
    if (document.getElementById('ytp-chzzk-capture-btn')) return;

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    const btn = document.createElement('button');
    btn.id = 'ytp-chzzk-capture-btn';
    btn.className = 'ytp-button ytp-chzzk-capture-btn';
    btn.title = 'YouTube VS 중계글 작성 (Ctrl+Shift+X)';
    btn.setAttribute('aria-label', 'YouTube VS 중계글 작성');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/>
        <path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9Zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5Z"/>
      </svg>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openYouTubeDraftModal();
    });

    rightControls.insertBefore(btn, rightControls.firstChild);
  }

  // ─── 유튜브 영상 하단 액션바(좋아요/공유 옆) 📸 버튼 주입 ───
  function injectYouTubeActionButton() {
    if (document.getElementById('yt-chzzk-action-btn')) return;

    const actions = document.querySelector(
      '#actions #top-level-buttons-computed, ytd-watch-metadata #actions #top-level-buttons-computed, #above-the-fold #actions #top-level-buttons-computed'
    );
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id = 'yt-chzzk-action-btn';
    btn.className = 'yt-chzzk-action-btn';
    btn.title = 'YouTube VS 중계글 작성 (Ctrl+Shift+X)';
    btn.innerHTML = `
      <span style="font-size: 15px; line-height: 1;">📸</span>
      <span>중계글 작성</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openYouTubeDraftModal();
    });

    actions.appendChild(btn);
  }

  // ─── 단축키 리스너 (Ctrl + Shift + X, P) ───
  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 텍스트 입력 중에는 단축키 무시
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X' || e.key === 'ㅌ')) {
          e.preventDefault();
          openYouTubeDraftModal();
        }
        return;
      }

      if (e.code === 'KeyW') {
        e.preventDefault();
        openYouTubeDraftModal();
        return;
      }

    });
  }

  // ─── 팝업 및 확장프로그램 메시지 수신 ───
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === 'POST_CANCELLED_RESTORE') {
      const pending = document.getElementById('yt-chzzk-draft-modal-overlay');
      if (pending?.dataset.pendingPost) {
        pending.style.removeProperty('display');
        delete pending.dataset.pendingPost;
        pending.querySelector('#yt-draft-submit-btn')?.focus();
        showToast('취소한 중계글 내용을 복원했습니다.');
      }
      sendResponse({ success: Boolean(pending) });
      return;
    }
    if (request?.type === 'POST_STATUS') {
      if (request.success) document.getElementById('yt-chzzk-draft-modal-overlay')?.remove();
      sendResponse({ success: true });
      return;
    }
    if (!request || !request.action) return;

    if (request.action === 'PING') {
      const meta = getYouTubeMetadata();
      sendResponse({
        status: 'PONG',
        platform: 'YOUTUBE',
        pageType: 'LIVE',
        title: meta.title,
        streamer: meta.streamer
      });
      return true;
    }

    if (request.action === 'OPEN_DRAFT_MODAL' || request.action === 'OPEN_GALLERY_DRAFT') {
      openYouTubeDraftModal();
      sendResponse({ success: true });
      return true;
    }

  });

  // ─── 초기화 및 감시 루프 ───
  function initYouTubeCapture() {
    setupShortcuts();
    loadYouTubeSettings();

    // 유튜브 플레이어 및 상단 헤더, 액션 버튼 생성 감지 (SPA 페이지 이동 대응)
    const runInjections = () => {
      injectYouTubeHeaderMenu();
    };

    runInjections();
    // Hidden tabs do not need repeated header DOM queries. Refresh on return.
    setInterval(() => { if (!document.hidden) runInjections(); }, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) runInjections();
    });

    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(runInjections, 400);
      setTimeout(runInjections, 1200);
    });

    console.log('[Chzzk VS YouTube] 유튜브 라이브 캡처 및 단축키(Ctrl+Shift+X) 등록 완료');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initYouTubeCapture);
  } else {
    initYouTubeCapture();
  }
})();
