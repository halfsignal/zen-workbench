# Zen Workbench

Zen Workbench is a Windows desktop app for Cronus Zen. It includes a device monitor, slot inspection and backups, a Zen32 GPC editor, and YOLOv8 vision for images, video and window capture.

## Download and run

1. Download `Zen-Workbench-Windows-x64.zip` from [Releases](https://github.com/hhhhhhhhhvvccfzrehdrtfy/zen-workbench/releases).
2. Extract the entire ZIP and open `Zen Workbench.exe` inside it. Keep its DLLs and `resources` folder beside the executable.
3. Connect the Zen's **PROG** port to your PC in normal mode. Close other Zen software and choose **Connect Zen**. The bundled device libraries cover firmware 2.3.2 and 2.4.0.

Device output starts disabled. The editor supports temporary execution in RAM. For persistent programming or firmware updates, use Zen Studio.

## Computer vision

Install Python 3.11 and run `python -m pip install -r requirements-vision.txt` from this repository. For NVIDIA acceleration, install a CUDA-enabled build of PyTorch for that interpreter using the [PyTorch installer guide](https://pytorch.org/get-started/locally/). CPU mode is also available. In **Preferences**, select the Python interpreter. In **Computer Vision**, select a YOLOv8 `.pt` checkpoint and an image, video or a restored window, then select **Start vision**. The optional model download includes ONNX for external inference. Workbench itself takes the `.pt` file.

Window capture uses Windows Graphics Capture with a GDI fallback. Use an exact window title and keep the window restored. The 8 FPS preview is independent of model throughput. Live detection speed depends on source and GPU load. Controller correction requires explicitly enabling L2 output and holding physical L2. Use controller automation only in environments that permit it.

## Develop and build

From this repository on Windows, with Node.js 22 or later:

```powershell
npm ci
npm test
npm start
npm run package
```

Packaging produces a Windows x64 folder under the sibling `zen-workbench-build-v1.2.3` directory. After installing the Python requirements, run `python tests/test_vision_worker.py` for the capture and timing tests.

## Third-party components

This is an independent project. Cronus Zen and Zen Studio are Collective Minds products. The Zen32 compiler (1.2.4) and device SDK components (1.3.3 and 1.4.1) originate from [Zen Studio Live](https://zenstudio.collectivemindsstore.com/). The device bindings were adapted to load the matching WebAssembly in Workbench's local transport. `vendor-asset-sha256.json` identifies the bundled versions. The components retain their respective ownership and terms.

Vision uses [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics). The optional model was fine-tuned on the Roboflow export [Fortnite v2, SecondVersionAllClassCharacter](https://universe.roboflow.com/himrohblo/fortnite-gegjm), credited to the project's uploader and labeled [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) in the export. Fortnite belongs to Epic Games. Refer to the relevant upstream terms for reuse. The training image archive is available from its upstream project.
