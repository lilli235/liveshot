let activeWorker = null;
let activeChannel = null;
let replyTarget = null;
let replyOrigin = '*';

function stopWorker() {
  const port = activeWorker?.port || activeWorker;
  try { port?.postMessage({ type: 'cancel' }); port?.close?.(); } catch (_) {}
  activeWorker?.terminate?.();
  activeWorker = null;
  activeChannel = null;
  replyTarget = null;
}

window.addEventListener('message', async event => {
  const message = event.data || {};
  if (event.source !== window.parent || !message.__chzzkWebpCommand || !message.channel) return;

  if (message.type === 'cancel') {
    if (message.channel === activeChannel) stopWorker();
    return;
  }
  if (message.type === 'reduce' || message.type === 'resize' || message.type === 'keep') {
    if (message.channel === activeChannel) (activeWorker?.port || activeWorker)?.postMessage({ type: message.type });
    return;
  }
  if (message.type !== 'start') return;

  stopWorker();
  activeChannel = message.channel;
  replyTarget = event.source;
  replyOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
  try { await chrome.runtime.sendMessage({ type: 'ENSURE_WEBP_OFFSCREEN' }); } catch (_) {}
  activeWorker = typeof SharedWorker === 'function' ? new SharedWorker('./encoder-worker.js', { type: 'module', name: 'chzzk-webp-encoder' }) : new Worker('./encoder-worker.js', { type: 'module' });
  const workerPort = activeWorker.port || activeWorker; workerPort.start?.();
  activeWorker.onerror = workerEvent => {
    replyTarget?.postMessage({ __chzzkWebpReply: activeChannel, type: 'error', message: workerEvent.message || 'WebP 압축 작업자를 시작하지 못했습니다.' }, replyOrigin);
    stopWorker();
  };
  workerPort.onmessage = workerEvent => {
    const response = { __chzzkWebpReply: activeChannel, ...workerEvent.data };
    const transfer = response.type === 'done' && response.buffer ? [response.buffer] : [];
    replyTarget?.postMessage(response, replyOrigin, transfer);
    if (response.type === 'done' || response.type === 'error') stopWorker();
  };
  const transfer = message.frames.map(frame => frame.buffer);
  workerPort.postMessage({ type: 'start', width: message.width, height: message.height, frames: message.frames }, transfer);
});
