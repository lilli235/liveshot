const worker = new Worker('./ai-worker.js');

worker.addEventListener('message', event => {
  const message = { __liveShotAiReply: true, ...event.data };
  const transfer = message.output?.buffer ? [message.output.buffer] : [];
  window.parent.postMessage(message, '*', transfer);
});

worker.addEventListener('error', event => {
  window.parent.postMessage({ __liveShotAiReply: true, type: 'error', channel: event.messageChannel || '', message: event.message || 'AI 작업자를 실행하지 못했습니다.' }, '*');
});

window.addEventListener('message', event => {
  const message = event.data || {};
  if (event.source !== window.parent || !message.__liveShotAiCommand) return;
  const transfer = [message.image?.buffer, message.mask?.buffer].filter(Boolean);
  worker.postMessage(message, transfer);
});
