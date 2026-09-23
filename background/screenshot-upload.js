/**
 * Runs in the DC write page's MAIN world through chrome.scripting.
 * Protocol verified against /_js/editor_common.js?v=260721 (2026-09-23).
 * Uploads only; never clicks or calls the article submission endpoint.
 */
async function liveShotUploadScreenshotBatch(files) {
  const fail = message => ({ ok: false, error: message });
  if (location.hostname !== 'gall.dcinside.com' || !location.pathname.includes('/write')) return fail('디시 글쓰기 페이지가 아닙니다.');
  if (window.__liveShotScreenshotBatch) return fail('이미 이미지/움짤을 업로드하고 있습니다.');
  if (!Array.isArray(files) || !files.length || files.length > 50 ||
      files.some(file => typeof file?.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(file.dataUrl))) {
    return fail('이미지/움짤 파일 형식이나 개수가 올바르지 않습니다.');
  }
  const editor = document.querySelector('.note-editable');
  const jq = window.jQuery;
  const attachImage = window.attach;
  const id = document.querySelector('#id')?.value;
  const rKey = document.querySelector('#r_key')?.value;
  const galleryNo = document.querySelector('#gallery_no')?.value;
  const galleryType = window._GALLERY_TYPE_;
  if (!editor || typeof attachImage !== 'function' || !jq?.fn?.summernote ||
      !Array.isArray(window.attachments) || !id || !rKey || !galleryNo || !galleryType) {
    return fail('디시 편집기 업로드 연결을 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }
  const existingCount = window.attachments.length;
  const maxFiles = Number(window.upload_count_file) || 50;
  if (existingCount + files.length > maxFiles) return fail('디시 첨부 파일 개수 제한을 초과했습니다.');
  window.__liveShotScreenshotBatch = true;
  const controller = new AbortController();
  const pagehide = () => controller.abort();
  window.addEventListener('pagehide', pagehide, { once: true });
  const status = text => {
    const node = document.getElementById('chzzk-confirm-status');
    if (node) node.textContent = text;
  };
  const batchTimeout = setTimeout(() => controller.abort(), 120000);
  let completed = 0;
  let inserted = 0;
  let orderedBlock = null;
  try {
    status(`이미지/움짤 동시 업로드 중 (0/${files.length})…`);
    // A separate request owns each source index. Server-renamed filenames and
    // out-of-order responses cannot change the ordering of these results.
    const results = await Promise.all(files.map(async (entry, index) => {
      const response = await fetch(entry.dataUrl, { signal: controller.signal });
      const blob = await response.blob();
      if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error(`이미지/움짤 ${index + 1}: 파일 크기를 확인해 주세요.`);
      const file = new File([blob], entry.name || `liveshot_${index + 1}.png`, { type: blob.type });
      const form = new FormData();
      form.append('files[]', file);
      form.append('id', id);
      form.append('r_key', rKey);
      form.append('gall_no', galleryNo);
      form.append('_GALLTYPE_', galleryType);
      const uploaded = await fetch('https://upimg.dcinside.com/upimg_file.php?id=' + encodeURIComponent(id), {
        method: 'POST', body: form, signal: controller.signal,
        // Same cross-origin credential behavior as the site's $.ajax uploader.
        credentials: 'same-origin',
      });
      if (!uploaded.ok) throw new Error(`이미지/움짤 ${index + 1}: 업로드 서버 오류 (${uploaded.status})`);
      const data = await uploaded.json();
      const item = data?.files?.[0];
      if (!item || item.error) throw new Error(`이미지/움짤 ${index + 1}: ${String(item?.error || '업로드 응답이 올바르지 않습니다.').slice(0, 180)}`);
      const imageurl = item.web__url || item.web2__url || item.url;
      let url;
      try { url = new URL(imageurl); } catch (_) { throw new Error('업로드 이미지 주소를 확인하지 못했습니다.'); }
      if (!/^https?:$/.test(url.protocol) || !/(^|\.)dcinside\.(com|co\.kr)$/i.test(url.hostname) ||
          item.file_temp_no == null || String(item.file_temp_no) === '') {
        throw new Error('첨부 고유번호 또는 이미지 주소를 확인하지 못했습니다.');
      }
      if (controller.signal.aborted) throw new Error('업로드가 취소되었습니다.');
      completed++;
      status(`이미지/움짤 동시 업로드 중 (${completed}/${files.length})…`);
      return {
        imageurl, filename: item.name || file.name, filesize: item.size || file.size,
        imagealign: 'L', originalurl: item.url, thumburl: item._s_url,
        file_temp_no: item.file_temp_no, mp4: item.mp4 || '',
      };
    }));
    const ids = results.map(item => String(item.file_temp_no));
    if (new Set(ids).size !== ids.length) throw new Error('첨부 고유번호가 중복되어 순서를 확정할 수 없습니다.');
    clearTimeout(batchTimeout);
    const uploadStatus = document.querySelector('#upload_status');
    if (uploadStatus) uploadStatus.value = 'Y';
    // Preserve native attachment registration and data-tempno attributes.
    // Queue insertion only after ALL uploads have succeeded.
    orderedBlock = document.createElement('p');
    for (const data of results) {
      if (controller.signal.aborted || !editor.isConnected) throw new Error('편집기가 닫혔습니다.');
      status(`업로드 완료 · 임시저장 순서대로 배치 중 (${inserted}/${results.length})…`);
      // Preserve native attachment metadata without focus, caret or timer dependencies.
      const image = document.createElement('img');
      image.setAttribute('src', data.imageurl);
      image.setAttribute('data-tempno', String(data.file_temp_no));
      if (data.mp4 === 'gif-mp4' || data.mp4 === 'webp-mp4') image.className = data.mp4;
      orderedBlock.append(image, document.createElement('br'));
      inserted++;
    }
    editor.insertBefore(orderedBlock, editor.firstChild);
    window.attachments.push(...results);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    // Keep Summernote's backing textarea/change callbacks in sync without
    // recreating image nodes or losing attachment attributes.
    const memo = jq('#memo');
    memo.val(editor.innerHTML);
    memo.trigger('summernote.change', [editor.innerHTML, jq(editor)]);
    status(`이미지/움짤 ${inserted}장 업로드·순서 배치 완료`);
    return { ok: true, count: inserted };
  } catch (error) {
    controller.abort();
    const message = error?.name === 'AbortError' ? '업로드 대기 시간이 초과되었거나 취소되었습니다.' : String(error?.message || error);
    status(message + ' · 중복 전송 없이 중단했습니다.');
    return fail(message);
  } finally {
    clearTimeout(batchTimeout);
    window.removeEventListener('pagehide', pagehide);
    window.__liveShotScreenshotBatch = false;
  }
}


// Only extension content scripts on the DC write page may start an upload.
// Cookies/form keys stay in the page; they are never returned to the extension.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'UPLOAD_SCREENSHOT_BATCH') return false;
  let page;
  try { page = new URL(sender.url || sender.tab?.url); } catch (_) {}
  if (!sender.tab?.id || sender.frameId !== 0 || page?.hostname !== 'gall.dcinside.com' ||
      !page.pathname.includes('/write') || !Array.isArray(message.files) || !message.files.length ||
      message.files.length > 50 || message.files.some(file =>
        typeof file?.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(file.dataUrl))) {
    sendResponse({ ok: false, error: '허용되지 않은 이미지/움짤 업로드 요청입니다.' });
    return false;
  }
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN',
    func: liveShotUploadScreenshotBatch, args: [message.files],
  }).then(results => sendResponse(results[0]?.result || { ok: false, error: '업로드 응답이 없습니다.' }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
