const keeper = new SharedWorker('./vendor/wasm-webp/encoder-worker.js', { type: 'module', name: 'chzzk-webp-encoder' });
keeper.port.start();
