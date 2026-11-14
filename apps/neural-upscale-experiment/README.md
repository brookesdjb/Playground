# Neural Engine upscaler: a minimal viability experiment

**The question:** could a DLSS-style upscaler for [Spore Hollow](../fungal-world) and [Ochre Reach](../desert-world) run on the Apple Neural Engine (ANE) of an **M2 Pro**, with the game at **2560×1440, 60 fps** (16.7 ms per frame)? And would that beat simply running the upscaler on the GPU?

It is answered in two cheap steps, before any engine work:

1. **Speed (about an hour).** Can a network big enough to be useful run on the ANE fast enough? Does that actually save GPU time while the GPU is busy rendering? Random weights are enough, because speed doesn't depend on them.
2. **Quality (an afternoon plus training time).** Does a network that small, trained on these worlds, upscale better than MetalFX's spatial upscaler? This step is single-frame. A temporal (DLSS-style) version can only do better, but needs motion vectors first, so it's only worth building if both steps pass.

Everything renders at 1280×720 and upscales 2× to 2560×1440.

## The candidates

`models.py` defines five networks. They all work at a quarter of the input resolution (640×360 with 4× the channels) and predict the difference from a bilinear upscale. They use only operations the ANE runs well: 3×3 convolutions, ReLU, pixel shuffle and unshuffle, bilinear resize and add.

| Model | Inputs | Billions of multiply-adds per frame | Rough ANE guess |
|---|---|---|---|
| `tiny` | colour | 7.8 | ~2 ms |
| `small` | colour | 16.7 | ~5 ms |
| `medium` | colour | 44.2 | ~13 ms (expected to fail) |
| `temporal` | colour, depth, motion, previous output (9 channels) | 18.3 | ~5 ms |
| `blend` | the same 9 channels, outputting 4 blend weights at input resolution for the GPU to apply | 7.4 | ~2 ms |

The guess assumes the M2 Pro's ANE (rated by Apple at 15.8 trillion operations per second) reaches about 45% of that on real convolution networks. The benchmark replaces it with measurements. `models/` already holds Core ML versions of all five with random weights, so step 1 needs no Python.

## Step 1: speed

Needs Xcode or the Command Line Tools.

```bash
cd bench
swift run -c release bench latency ../models/*.mlpackage       # each model on the ANE and on the GPU, 500 runs
swift run -c release bench contention ../models/small.mlpackage # the key one, see below
swift run -c release bench contention ../models/temporal.mlpackage
swift run -c release bench metalfx                              # what MetalFX's upscalers cost on the GPU
```

- **`contention`** keeps the GPU busy with a stand-in for the renderer: 10 ms of work per frame that streams a 256 MB buffer, so it uses memory bandwidth as well as compute (`--load-ms` changes it). It then runs the model once per 60 Hz frame, first on the ANE and then on the GPU, and reports how much each adds to the GPU's frame time, plus the model's latency under load.
- **Confirm the model really ran on the ANE.** Open the `.mlpackage` in Xcode, go to **Performance**, then **+**, choose Neural Engine and create a report. Core ML moves unsupported layers to the GPU or CPU without telling you.

**Step 1 passes if a model reaches all of these:**
- 99th-percentile ANE latency under load of **8 ms or less**. Pipelined one frame behind the GPU, that fits 60 fps with headroom.
- It adds **under ~0.5 ms** to the GPU frame. Some cost is unavoidable, because they share memory bandwidth.
- That GPU cost is **clearly below** both the same model run on the GPU and MetalFX temporal's cost from `bench metalfx`. Otherwise MetalFX is the better deal.

If only `tiny` or `blend` pass, the full-network approach is dead, but the hybrid one is still possible: the GPU does the reprojection and the ANE only predicts blend weights. If nothing passes, stop here.

## Step 2: quality

```bash
npm install                                         # Playwright, to drive Chrome
(cd ../fungal-world && npm run build:dev) && (cd ../desert-world && npm run build:dev)
node capture.cjs --world ../fungal-world --n 300 --out data/fungal
node capture.cjs --world ../desert-world --n 300 --out data/desert
```

`capture.cjs` renders random cameras along each world's scripted camera path, in your Chrome on the real GPU, at High detail:
- **Input:** each frame at 1280×720.
- **Target:** the same frame and moment at 5120×2880, averaged down to 2560×1440.

The film grain is switched off for capture, because it is random per pixel and nothing can learn it. If headless Chrome finds no WebGPU adapter, add `--headed`.

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python train.py --data data/fungal data/desert --model small --steps 20000    # Apple GPU (MPS); try tiny too
mkdir -p data/test_low && cp data/fungal/low/027*.png data/fungal/low/028*.png data/fungal/low/029*.png data/test_low/
(cd bench && swift run -c release bench metalfx-images ../data/test_low ../data/metalfx)
python train.py --data data/fungal data/desert --model small --eval-only --metalfx data/metalfx
python convert.py small --ckpt runs/small.pt        # re-run step 1 on the trained model if you like
```

- **Held-out frames:** the last 10% of each folder (`0270`–`0299` with 300 pairs) are never trained on.
- **What evaluation reports:** sharpness and perceptual-similarity scores (PSNR and SSIM, higher is better; LPIPS, lower is better) for bilinear, bicubic, Lanczos, MetalFX spatial and the trained network. It also writes side-by-side crops to `runs/compare_*.png`.
- **MetalFX images:** the `cp` line is for the fungal held-out frames. MetalFX images are matched to test frames by file name, and both worlds use the same names, so run the comparison per world, or copy the desert frames to another folder.

**Step 2 passes if** a model that passed step 1 clearly beats MetalFX spatial on both PSNR and LPIPS, and looks better on the hard cases: thin gills, sand glints, glowing particles, leaves and fine distant detail. If it only matches MetalFX, the ANE route isn't worth a custom upscaler, unless step 1 showed a big GPU-time saving.

## What these results don't tell you yet

- **Temporal quality.** Accumulating detail over frames, and the ghosting and flicker that come with it, needs motion vectors and camera jitter in the renderer. Build that only after both steps pass.
- **Real-renderer contention.** The GPU load is synthetic. Confirm in the real renderer before relying on it.
- **Whether real frames can reach the ANE without copying.** The benchmark feeds fp16 tensors and counts their transfer in the latency. A real integration should share IOSurface-backed buffers between Metal and Core ML.
- **Input timing.** The input here is the final, tone-mapped image. A real upscaler runs before tone mapping and post-processing, on HDR colour.

## Files

| File | Purpose |
|---|---|
| `models.py` | The candidate networks and their cost |
| `convert.py` | PyTorch to Core ML (fp16 ML Program). Works on any OS; running the models needs macOS |
| `models/*.mlpackage` | The five candidates with random weights, ready for step 1 |
| `bench/` | Swift package: `latency`, `contention`, `metalfx`, `metalfx-images` |
| `capture.cjs` | Training pairs from either world |
| `train.py` | Training (MPS) and evaluation against the baselines |

Status: the Python and capture parts were run end to end at tiny sizes in a Linux container (software rendering). The Swift benchmark is written against the macOS 13 Core ML, Metal and MetalFX APIs but **has not been compiled yet**. Expect to fix small compile errors on first build.
