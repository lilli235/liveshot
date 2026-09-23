const DEFAULT = { id: 'virtual_streamer', name: '버츄얼 스트리머 미니 갤러리', url: 'https://gall.dcinside.com/mini/board/lists/?id=virtual_streamer' };
let destinations = [], selected = '', dccons = [], dcconFolders = ['기본'], dcconFolderCovers = {}, dcconPreviewCache = {};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(message) { $('toast').textContent = message; setTimeout(() => $('toast').textContent = '', 1800); }
function normalize(raw) { try { const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return url.hostname.endsWith('dcinside.com') ? url.toString() : ''; } catch { return ''; } }
async function detectGalleryName(url) {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error();
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const raw = doc.querySelector('.page_head h2, .gall_tit, .minor_ranking_box h3')?.textContent || doc.querySelector('meta[property="og:title"]')?.content || doc.title || '';
    const name = cleanGalleryName(raw.replace(/\s*[-|]\s*(커뮤니티 포털\s*)?디시인사이드.*$/i, ''));
    if (name) return name;
  } catch (_) { }
  try { return new URL(url).searchParams.get('id') || '새 갤러리'; } catch { return '새 갤러리'; }
}
function cleanGalleryName(name) { return String(name || '').replace(/(갤러리)\s*(마이너|미니)\s*$/gi, '$1').replace(/\s+(마이너|미니)(?=\s*갤러리|\s*$)/gi, '').replace(/\s+/g, ' ').trim(); }
async function save() { await chrome.storage.sync.set({ galleryDestinations: destinations, selectedGalleryUrl: selected }); render(); }
async function saveDccons() { await chrome.storage.local.set({ dcconFavorites: dccons, dcconFolders, dcconFolderCovers }); renderDccons(); }
function validDcconUrl(raw) { try { const url = new URL(raw); return url.hostname.endsWith('dcinside.com') && /\/dccon\.php$/i.test(url.pathname) ? url.href : ''; } catch { return ''; } }
function numericKeys(value) {
  return new Set(Array.from(String(value || '').matchAll(/\d+/g), match => match[0].replace(/^0+(?=\d)/, '')));
}
async function imageFileToPreview(file) {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .92));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob || file); });
}
function parseDcconHtmlList(raw) {
  const cleaned = String(raw || '').replace(/\\([<_])/g, '$1');
  const doc = new DOMParser().parseFromString(cleaned, 'text/html');
  return Array.from(doc.querySelectorAll('img.written_dccon, img[src*="dccon.php"]')).map(image => {
    let src = image.getAttribute('src') || '';
    const markdownUrl = src.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
    if (markdownUrl) src = markdownUrl[1];
    src = validDcconUrl(src);
    if (!src) return null;
    return { url: src, name: image.getAttribute('conalt') || image.getAttribute('con_alt') || image.getAttribute('alt') || image.getAttribute('title') || '디시콘', detail: image.getAttribute('detail') || '' };
  }).filter(Boolean);
}
async function loadDcconPreview(url) {
  if (dcconPreviewCache[url]) return dcconPreviewCache[url];
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return '';
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    dcconPreviewCache[url] = dataUrl;
    await chrome.storage.local.set({ dcconPreviewCache });
    return dataUrl;
  } catch (_) { return ''; }
}
function renderDccons() {
  const openFolders = new Set(Array.from(document.querySelectorAll('.dccon-folder-group[open]')).map(group => group.dataset.folderGroup));
  $('dccon-count').textContent = `${dccons.length}개 저장됨`;
  $('dccon-folder').innerHTML = dcconFolders.map(folder => `<option value="${esc(folder)}">${esc(folder)}</option>`).join('');
  $('dccon-folders').innerHTML = '';
  $('dccon-list').innerHTML = dcconFolders.map(folder => {
    const entries = dccons.map((item, index) => ({ item, index })).filter(entry => (entry.item.folder || '기본') === folder);
    const coverUrl = entries[0]?.item.url || '';
    const items = entries.map(({ item, index }) => `<div class="item dccon-item"><label class="dccon-thumb-label" title="클릭하여 미리보기 이미지 변경"><img class="dccon-thumb" src="${esc(dcconPreviewCache[item.url] || item.url)}" referrerpolicy="no-referrer" alt=""><input type="file" accept="image/*" data-dccon-file="${index}"></label><div class="info"><b>${esc(item.name)}</b><select data-dccon-folder="${index}">${dcconFolders.map(option => `<option value="${esc(option)}" ${(item.folder || '기본') === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></div><div class="actions"><button data-dccon-favorite="${index}" class="favorite-btn ${item.favorite ? 'active' : ''}" title="즐겨찾기">${item.favorite ? '★' : '☆'}</button><button data-dccon-del="${index}" title="삭제">×</button></div></div>`).join('');
    return `<details class="dccon-folder-group" data-folder-group="${esc(folder)}" ${openFolders.has(folder) ? 'open' : ''}><summary><button type="button" class="folder-drag" draggable="true" data-folder-drag="${esc(folder)}" title="드래그하여 순서 변경">☰</button>${coverUrl ? `<img src="${esc(dcconPreviewCache[coverUrl] || coverUrl)}" alt="">` : '<span class="empty-folder">📁</span>'}<b>${esc(folder)}</b><small>${entries.length}</small><button type="button" data-folder-export="${esc(folder)}" title="폴더 등록 코드 복사">복사</button><button type="button" data-folder-rename="${esc(folder)}" title="이름 변경">✎</button>${dcconFolders.length > 1 ? `<button type="button" data-folder-del="${esc(folder)}" title="폴더 삭제">×</button>` : ''}</summary><div class="dccon-folder-items">${items || '<p class="empty-list">등록된 디시콘이 없습니다.</p>'}</div></details>`;
  }).join('');
  document.querySelectorAll('[data-dccon-del]').forEach(button => button.onclick = async () => { dccons.splice(+button.dataset.dcconDel, 1); await saveDccons(); toast('디시콘을 삭제했습니다.'); });
  document.querySelectorAll('[data-dccon-folder]').forEach(select => select.onchange = async () => { dccons[+select.dataset.dcconFolder].folder = select.value; await saveDccons(); toast('디시콘 폴더를 변경했습니다.'); });
  document.querySelectorAll('[data-dccon-favorite]').forEach(button => button.onclick = async () => { const item = dccons[+button.dataset.dcconFavorite]; item.favorite = !item.favorite; await saveDccons(); toast(item.favorite ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 제거했습니다.'); });
  let draggedFolder = '';
  document.querySelectorAll('[data-folder-drag]').forEach(handle => { handle.ondragstart = event => { draggedFolder = handle.dataset.folderDrag; event.dataTransfer.effectAllowed = 'move'; }; handle.onclick = event => { event.preventDefault(); event.stopPropagation(); }; });
  document.querySelectorAll('[data-folder-group]').forEach(group => { group.ondragover = event => { event.preventDefault(); group.classList.add('drag-over'); }; group.ondragleave = () => group.classList.remove('drag-over'); group.ondrop = async event => { event.preventDefault(); group.classList.remove('drag-over'); const targetFolder = group.dataset.folderGroup; if (!draggedFolder || draggedFolder === targetFolder) return; const from = dcconFolders.indexOf(draggedFolder); const to = dcconFolders.indexOf(targetFolder); const [moved] = dcconFolders.splice(from, 1); dcconFolders.splice(to, 0, moved); draggedFolder = ''; await saveDccons(); }; });
  document.querySelectorAll('[data-folder-rename]').forEach(button => button.onclick = async event => { event.preventDefault(); event.stopPropagation(); const oldName = button.dataset.folderRename; const newName = prompt('새 폴더 이름', oldName)?.trim(); if (!newName || newName === oldName) return; if (dcconFolders.includes(newName)) return toast('같은 이름의 폴더가 있습니다.'); const index = dcconFolders.indexOf(oldName); dcconFolders[index] = newName; dccons.forEach(item => { if ((item.folder || '기본') === oldName) item.folder = newName; }); if (dcconFolderCovers[oldName]) { dcconFolderCovers[newName] = dcconFolderCovers[oldName]; delete dcconFolderCovers[oldName]; } await saveDccons(); toast('폴더 이름을 변경했습니다.'); });
  document.querySelectorAll('[data-folder-export]').forEach(button => button.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    const folder = button.dataset.folderExport;
    const items = dccons.filter(item => (item.folder || '기본') === folder);
    button.disabled = true; button.textContent = '준비';
    await Promise.all(items.map(item => loadDcconPreview(item.url)));
    const previews = {};
    items.forEach(item => { if (dcconPreviewCache[item.url]) previews[item.url] = dcconPreviewCache[item.url]; });
    const packageCode = JSON.stringify({ type: 'chzzk-vs-dccon-folder', version: 1, folder, items: items.map(({ id, folder: _folder, ...item }) => item), previews });
    try { await navigator.clipboard.writeText(packageCode); toast(`'${folder}' 폴더 등록 코드를 복사했습니다.`); }
    catch (_) { toast('폴더 코드 복사에 실패했습니다.'); }
    button.disabled = false; button.textContent = '복사';
  });
  document.querySelectorAll('[data-dccon-file]').forEach(input => input.onchange = async event => {
    const item = dccons[+input.dataset.dcconFile];
    const file = event.target.files?.[0];
    if (!item || !file) return;
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    dcconPreviewCache[item.url] = dataUrl;
    await chrome.storage.local.set({ dcconPreviewCache });
    renderDccons();
    toast('미리보기 이미지를 저장했습니다.');
  });
  document.querySelectorAll('[data-folder-del]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    event.preventDefault();
    const folder = button.dataset.folderDel;
    const folderItems = dccons.filter(item => (item.folder || '기본') === folder);
    if (!confirm(`'${folder}' 폴더와 디시콘 ${folderItems.length}개를 모두 삭제할까요?`)) return;
    folderItems.forEach(item => { delete dcconPreviewCache[item.url]; });
    dccons = dccons.filter(item => (item.folder || '기본') !== folder);
    dcconFolders = dcconFolders.filter(item => item !== folder);
    delete dcconFolderCovers[folder];
    await chrome.storage.local.set({ dcconPreviewCache });
    await saveDccons();
    toast(`폴더와 디시콘 ${folderItems.length}개를 삭제했습니다.`);
  });
}
function render() {
  $('count').textContent = `${destinations.length}개 등록됨`;
  $('list').innerHTML = destinations.map((d, i) => `<div class="item ${d.url === selected ? 'active' : ''}"><div class="info"><b>${esc(d.name)}</b><small>${esc(d.url)}</small></div><div class="actions"><button class="use" data-use="${i}">${d.url === selected ? '선택됨' : '선택'}</button>${destinations.length > 1 ? `<button data-del="${i}">삭제</button>` : ''}</div></div>`).join('');
  document.querySelectorAll('[data-use]').forEach(button => button.onclick = async () => { selected = destinations[+button.dataset.use].url; await save(); toast('기본 갤러리를 변경했습니다.'); });
  document.querySelectorAll('[data-del]').forEach(button => button.onclick = async () => { const removed = destinations.splice(+button.dataset.del, 1)[0]; if (selected === removed.url) selected = destinations[0].url; await save(); toast('갤러리를 삭제했습니다.'); });
}
(async () => {
  const saved = await chrome.storage.sync.get({ galleryDestinations: [DEFAULT], selectedGalleryUrl: DEFAULT.url, dcconFavorites: [], dcconFolders: ['기본'], dcconFolderCovers: {}, showQuickWidget: true, showYoutubeQuickWidget: true });
  const localSaved = await chrome.storage.local.get({ dcconPreviewCache: {}, dcconFavorites: null, dcconFolders: null, dcconFolderCovers: null });
  destinations = (saved.galleryDestinations?.length ? saved.galleryDestinations : [DEFAULT]).map(item => ({ ...item, name: cleanGalleryName(item.name) }));
  selected = saved.selectedGalleryUrl || destinations[0].url;
  dccons = Array.isArray(localSaved.dcconFavorites) ? localSaved.dcconFavorites : (Array.isArray(saved.dcconFavorites) ? saved.dcconFavorites : []);
  dcconFolders = Array.isArray(localSaved.dcconFolders) && localSaved.dcconFolders.length ? localSaved.dcconFolders : (Array.isArray(saved.dcconFolders) && saved.dcconFolders.length ? saved.dcconFolders : ['기본']);
  dcconFolderCovers = localSaved.dcconFolderCovers && typeof localSaved.dcconFolderCovers === 'object' ? localSaved.dcconFolderCovers : (saved.dcconFolderCovers && typeof saved.dcconFolderCovers === 'object' ? saved.dcconFolderCovers : {});
  dcconPreviewCache = localSaved.dcconPreviewCache || {};
  $('insert-hyperlink').checked = (await chrome.storage.sync.get('insertHyperlink')).insertHyperlink !== false;
  $('show-chzzk').checked = saved.showQuickWidget;
  $('show-youtube').checked = saved.showYoutubeQuickWidget;
  render();
  renderDccons();
  await chrome.storage.local.set({ dcconFavorites: dccons, dcconFolders, dcconFolderCovers });
  await chrome.storage.sync.remove(['dcconFavorites', 'dcconFolders', 'dcconFolderCovers']);
  await chrome.storage.sync.set({ galleryDestinations: destinations });
})();
$('insert-hyperlink').onchange = event => chrome.storage.sync.set({ insertHyperlink: event.target.checked });
$('show-chzzk').onchange = event => chrome.storage.sync.set({ showQuickWidget: event.target.checked });
$('show-youtube').onchange = event => chrome.storage.sync.set({ showYoutubeQuickWidget: event.target.checked });
$('dccon-folder-add').onclick = async () => {
  const folder = $('dccon-folder-name').value.trim();
  if (!folder) return toast('폴더 이름을 입력하세요.');
  if (!dcconFolders.includes(folder)) dcconFolders.push(folder);
  $('dccon-folder-name').value = '';
  await saveDccons();
  $('dccon-folder').value = folder;
  toast(`'${folder}' 폴더를 추가했습니다.`);
};
$('dccon-preview-batch').onclick = () => $('dccon-preview-files').click();
$('dccon-preview-files').onchange = async event => {
  const files = Array.from(event.target.files || []).filter(file => file.type.startsWith('image/'));
  if (!files.length) return toast('이미지가 있는 폴더를 선택하세요.');
  const folder = $('dccon-folder').value || '기본';
  const candidates = dccons.filter(item => (item.folder || '기본') === folder).map(item => ({ item, keys: numericKeys(item.name) }));
  if (!candidates.length) { event.target.value = ''; return toast(`'${folder}' 폴더에 디시콘이 없습니다.`); }
  const button = $('dccon-preview-batch'); button.disabled = true; button.textContent = '미리보기 등록 중';
  const assigned = new Set(); let matched = 0; let unmatched = 0; let failed = 0;
  for (const file of files) {
    const fileKeys = numericKeys(file.name.replace(/\.[^.]+$/, ''));
    const targets = candidates.filter(({ item, keys }) => !assigned.has(item.url) && Array.from(fileKeys).some(key => keys.has(key)));
    if (!fileKeys.size || !targets.length) { unmatched++; continue; }
    try {
      const dataUrl = await imageFileToPreview(file);
      targets.forEach(({ item }) => { dcconPreviewCache[item.url] = dataUrl; assigned.add(item.url); matched++; });
    } catch (_) { failed++; }
  }
  await chrome.storage.local.set({ dcconPreviewCache });
  event.target.value = ''; button.disabled = false; button.textContent = '미리보기 폴더 등록'; renderDccons();
  toast(`${matched}개 등록 · ${unmatched}개 불일치${failed ? ` · ${failed}개 실패` : ''}`);
};
$('add').onclick = async () => {
  const url = normalize($('url').value.trim());
  if (!url) return toast('올바른 디시인사이드 URL을 입력하세요.');
  $('add').disabled = true;
  $('add').textContent = '확인 중';
  const name = await detectGalleryName(url);
  const old = destinations.find(destination => destination.url === url);
  if (old) old.name = name;
  else destinations.push({ id: `custom_${Date.now()}`, name, url });
  selected = url;
  $('url').value = '';
  await save();
  $('add').disabled = false;
  $('add').textContent = '등록';
  toast(`'${name}' 갤러리를 등록했습니다.`);
};
$('dccon-add').onclick = async () => {
  const rawInput = $('dccon-html').value.trim();
  if (rawInput.startsWith('{')) {
    try {
      const packageData = JSON.parse(rawInput);
      if (packageData.type !== 'chzzk-vs-dccon-folder' || !Array.isArray(packageData.items)) throw new Error('invalid package');
      const folder = String(packageData.folder || '가져온 폴더').trim() || '가져온 폴더';
      if (!dcconFolders.includes(folder)) dcconFolders.push(folder);
      let imported = 0;
      const validSources = packageData.items.map(source => ({ ...source, url: validDcconUrl(String(source.url || '')) })).filter(source => source.url);
      const existingIds = new Map(dccons.map(item => [item.url, item.id]));
      const importedUrls = new Set(validSources.map(source => source.url));
      dccons = dccons.filter(item => !importedUrls.has(item.url));
      validSources.forEach((source, offset) => {
        const url = source.url;
        const value = { id: existingIds.get(url) || `dccon_${Date.now()}_${offset}`, name: String(source.name || '디시콘'), url, detail: String(source.detail || ''), favorite: Boolean(source.favorite), folder };
        dccons.push(value);
        const preview = packageData.previews?.[url];
        if (typeof preview === 'string' && /^data:image\//i.test(preview)) dcconPreviewCache[url] = preview;
        imported++;
      });
      await chrome.storage.local.set({ dcconPreviewCache });
      $('dccon-html').value = '';
      await saveDccons();
      toast(`'${folder}' 폴더에 ${imported}개를 등록했습니다.`);
      return;
    } catch (_) {
      return toast('올바른 디시콘 폴더 등록 코드가 아닙니다.');
    }
  }
  const parsedItems = parseDcconHtmlList($('dccon-html').value);
  if (!parsedItems.length) return toast('올바른 디시콘 HTML을 붙여 넣으세요.');
  const folder = $('dccon-folder').value || '기본';
  parsedItems.forEach((parsed, offset) => {
    const existing = dccons.find(item => item.url === parsed.url);
    const value = { id: existing?.id || `dccon_${Date.now()}_${offset}`, ...parsed, folder };
    if (existing) Object.assign(existing, value); else dccons.push(value);
  });
  await Promise.all(parsedItems.map(item => loadDcconPreview(item.url)));
  $('dccon-html').value = '';
  await saveDccons();
  toast(`${parsedItems.length}개 디시콘을 저장했습니다.`);
};
