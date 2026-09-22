importScripts('../onnxruntime/ort.wasm.min.js');

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('../onnxruntime/', self.location.href).href;
const sessions = new Map();

async function getSession(modelName) {
  if (!sessions.has(modelName)) {
    sessions.set(modelName, ort.InferenceSession.create(new URL(`../ai-models/${modelName}`, self.location.href).href, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
  }
  return sessions.get(modelName);
}

self.addEventListener('message', async event => {
  const message = event.data || {}; const { channel, modelName } = message;
  try {
    const session = await getSession(modelName); const feeds = {};
    session.inputNames.forEach(name => {
      const source = /mask/i.test(name) && message.mask ? message.mask : message.image;
      feeds[name] = new ort.Tensor('float32', new Float32Array(source.buffer), source.dims);
    });
    const results = await session.run(feeds);
    const tensor = results[session.outputNames[0]];
    const output = tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data);
    self.postMessage({ type: 'done', channel, output: { buffer: output.buffer, dims: tensor.dims } }, [output.buffer]);
  } catch (error) {
    sessions.delete(modelName);
    self.postMessage({ type: 'error', channel, message: error?.message || String(error) });
  }
});
