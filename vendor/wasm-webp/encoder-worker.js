import { encodeAnimation } from './index.js';

const LIMIT = 20 * 1024 * 1024;
let job = null;
let replyPort = null;
const emit = (message, transfer = []) => replyPort?.postMessage(message, transfer);

async function encodeCurrent() {
  const bytes = await encodeAnimation(job.width, job.height, true, job.frames);
  if (!bytes?.length) throw new Error('WebP 인코딩 결과가 비어 있습니다.');
  return bytes;
}

async function begin(data) {
  job = {
    width: data.width,
    height: data.height,
    frames: data.frames.map(frame => ({
      data: new Uint8Array(frame.buffer),
      duration: frame.duration,
      // In lossless mode quality controls compression effort, not pixels.
      // 60 is substantially faster than 100 while remaining pixel-lossless.
      config: { lossless: 1, quality: 60 }
    }))
  };
  emit({ type: 'progress', text: '무손실 WebP로 빠르게 압축 중...', progress: 55 });
  let bytes = await encodeCurrent();
  job.lastBytes = bytes;
  if (bytes.length > LIMIT) {
    emit({ type: 'oversize', byteLength: bytes.length, frameCount: job.frames.length });
    return;
  }
  finish(bytes);
}

async function reduce() {
  let bytes;
  do {
    const reduced = [];
    for (let index = 0; index < job.frames.length; index += 2) {
      const current = job.frames[index];
      const skipped = job.frames[index + 1];
      reduced.push({ data: current.data, duration: current.duration + (skipped?.duration || 0), config: current.config });
    }
    job.frames = reduced;
    emit({ type: 'progress', text: `업로드 용량에 맞게 프레임 조정 중... (${job.frames.length}프레임)`, progress: Math.min(94, 82 + (12 / Math.max(1, job.frames.length))) });
    bytes = await encodeCurrent();
    job.lastBytes = bytes;
  } while (bytes.length > LIMIT && job.frames.length > 2);
  if (bytes.length > LIMIT) throw new Error(`WebP 용량이 너무 큽니다. (${(bytes.length / 1024 / 1024).toFixed(1)}MB) 출력 폭이나 구간을 줄여 주세요.`);
  finish(bytes);
}

async function resize() {
  let bytes = job.lastBytes;
  while (bytes.length > LIMIT && job.width > 240 && job.height > 135) {
    const ratio = Math.max(.5, Math.min(.9, Math.sqrt(LIMIT / bytes.length) * .94));
    const nextWidth = Math.max(2, Math.round(job.width * ratio / 2) * 2);
    const nextHeight = Math.max(2, Math.round(job.height * ratio / 2) * 2);
    const source = new OffscreenCanvas(job.width, job.height); const sourceContext = source.getContext('2d');
    const target = new OffscreenCanvas(nextWidth, nextHeight); const targetContext = target.getContext('2d', { willReadFrequently: true });
    targetContext.imageSmoothingEnabled = true; targetContext.imageSmoothingQuality = 'high';
    for (const frame of job.frames) {
      sourceContext.putImageData(new ImageData(new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength), job.width, job.height), 0, 0);
      targetContext.clearRect(0, 0, nextWidth, nextHeight); targetContext.drawImage(source, 0, 0, nextWidth, nextHeight);
      frame.data = new Uint8Array(targetContext.getImageData(0, 0, nextWidth, nextHeight).data);
    }
    job.width = nextWidth; job.height = nextHeight;
    emit({ type: 'progress', text: `해상도 조정 후 무손실 압축 중... (${nextWidth}×${nextHeight})`, progress: 82 });
    bytes = await encodeCurrent(); job.lastBytes = bytes;
  }
  if (bytes.length > LIMIT) throw new Error(`해상도를 줄여도 WebP가 ${(bytes.length / 1024 / 1024).toFixed(1)}MB입니다. 구간이나 프레임을 줄여 주세요.`);
  finish(bytes);
}

function finish(bytes, oversized = false) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  emit({ type: 'done', buffer, frameCount: job.frames.length, width: job.width, height: job.height, oversized }, [buffer]);
  job = null;
}

const handleMessage = event => {
  replyPort = event.currentTarget === self ? self : event.currentTarget;
  const message = event.data || {};
  if (message.type === 'cancel') { job = null; return; }
  const task = message.type === 'start' ? begin(message) : message.type === 'reduce' ? reduce() : message.type === 'resize' ? resize() : message.type === 'keep' ? Promise.resolve(finish(job.lastBytes, true)) : null;
  task?.catch(error => {
    emit({ type: 'error', message: error?.message || String(error) });
    job = null;
  });
};
self.addEventListener('message', handleMessage);
self.addEventListener('connect', event => { const port = event.ports[0]; port.addEventListener('message', handleMessage); port.start(); });
