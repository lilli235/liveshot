/** 치지직 상단 중계글 작성 버튼 */
window.ChzzkVS = window.ChzzkVS || {};
(function () {
  function renderHeaderToolkitButton() {
    chrome.storage.sync.get({ showQuickWidget: true }, ({ showQuickWidget }) => {
      const old = document.getElementById('chzzk-toolkit-header-wrapper');
      if (!showQuickWidget) { old?.remove(); return; }
      const enabled = true;
      if (old) {
        const button = old.querySelector('button');
        if (button) { button.disabled = !enabled; button.title = enabled ? '중계글 작성' : '재생 중인 플레이어가 없습니다'; }
        return;
      }
      const studio = document.querySelector('a[href*="studio.chzzk.naver.com"], header a[href*="studio"]');
      const area = studio?.parentElement || document.querySelector('header [class*="user_area"], header [class*="service_area"], [class*="gnb_right"]');
      if (!area) return;
      const wrapper = document.createElement('div');
      wrapper.id = 'chzzk-toolkit-header-wrapper';
      wrapper.innerHTML = `<button type="button" class="chzzk-tk-header-btn" title="중계글 작성"><img src="/favicon.ico" alt="" width="18" height="18" style="display:block;border-radius:4px"><span>중계글 작성</span></button>`;
      const button = wrapper.querySelector('button');
      button.disabled = !enabled;
      button.title = enabled ? '중계글 작성' : '재생 중인 플레이어가 없습니다';
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        const type = /^\/(?:clips?|shorts?)\//i.test(location.pathname) ? 'CLIP' : 'LIVE';
        ChzzkVS.gallery?.openGalleryDraftModal({ type });
      });
      studio ? area.insertBefore(wrapper, studio) : area.prepend(wrapper);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.showQuickWidget) {
      document.getElementById('chzzk-toolkit-header-wrapper')?.remove();
      renderHeaderToolkitButton();
    }
  });
  ChzzkVS.ui = { renderHeaderToolkitButton };
})();
