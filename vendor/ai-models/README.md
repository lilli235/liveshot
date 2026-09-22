# Offline AI models

- `birefnet-lite-int8.onnx`: BiRefNet-lite ONNX INT8, MIT. Source weights and browser-oriented graph: https://huggingface.co/CoderViking/birefnet-lite-onnx (quantized locally with ONNX Runtime).
- `inpainting-lama.onnx`: OpenCV LaMa inpainting model, Apache-2.0. Source: https://huggingface.co/opencv/inpainting_lama

Both models run locally in the extension through ONNX Runtime Web. Images are not uploaded.

`birefnet-lite-compatible.onnx` preserves the quantized weights but replaces unsupported ConvInteger nodes with Cast/Sub/Conv/Cast operations. Tested with the bundled ONNX Runtime Web 1.23.2 WASM backend, including a 1024x1024 inference. This uses floating-point convolution and may have different performance from native integer kernels.
