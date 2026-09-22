/** 라이브샷 - 중계도우미 부트스트랩 */
(function () {
  'use strict';
  window.ChzzkVS = window.ChzzkVS || {};
  const detected = ChzzkVS.UTILS.detectPageType();
  ChzzkVS.state = { currentPageType: detected.pageType, currentChannelHash: detected.channelHash };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'POST_STATUS') {
      if (message.success) ChzzkVS.gallery?.finishPendingDraft?.();
      ChzzkVS.showToast(message.success ? '중계글 등록이 완료되었습니다.' : `자동 등록을 확인해 주세요: ${message.reason || '사용자 확인 필요'}`, 5000);
      sendResponse({ success: true });
      return;
    }
    if (message?.type === 'POST_CANCELLED_RESTORE') {
      const restored = ChzzkVS.gallery?.restorePendingDraft?.();
      if (restored) ChzzkVS.showToast('취소한 중계글 내용을 복원했습니다.', 3000);
      sendResponse({ success: Boolean(restored) });
      return;
    }
    if (message?.type !== 'OPEN_GALLERY_DRAFT') return;
    if (!ChzzkVS.gallery?.openGalleryDraftModal) {
      sendResponse({ success: false, error: '중계글 작성 기능을 불러오지 못했습니다.' });
      return;
    }
    ChzzkVS.gallery.openGalleryDraftModal({ type: 'LIVE' });
    sendResponse({ success: true });
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isTyping = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
    if (!isTyping && !event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'KeyW') {
      event.preventDefault();
      ChzzkVS.gallery?.openGalleryDraftModal({ type: 'LIVE' });
      return;
    }
    if (event.altKey && event.code === 'KeyS') {
      event.preventDefault();
      ChzzkVS.gallery?.openGalleryDraftModal({ type: 'LIVE' });
    }
  });
  const render = () => ChzzkVS.ui?.renderHeaderToolkitButton();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
  setInterval(() => { if (!document.hidden) render(); }, 1500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
})();
