# Results: Neural Engine upscaler viability

## Machine

- MacBook Pro, **Apple M2 Pro**, 16 GB unified memory
- macOS **27.2** (build 26B123), Xcode 27.1 (27A9275), Swift 6.4
- Step 1 conditions: **on battery** (user's choice; charger not available at the time), **Low Power Mode off**, no other heavy apps running (Safari, VS Code and the Claude app open but idle). No thermal or performance warnings were recorded (`pmset -g therm`). Battery went from 32% to 24% over the runs.
- Each benchmark was run twice, back to back; the tables report the **second run**. Raw output for both runs is in [`results/step1/`](results/step1/).

## Code changes

- **`bench/` compiled with no errors and needed no source changes** (`swift build -c release`, Swift 6.4, tools-version 5.7 package).
- Because `infer()` discards prediction errors (`try?`), a failed prediction would show as a fast, fake time. A separate check confirmed every model predicts successfully on both `.cpuAndNeuralEngine` and `.cpuAndGPU`, with fp16 inputs and outputs of the expected shapes.
- Added [`tools/ane_plan.swift`](tools/ane_plan.swift): reports each op's preferred compute device using `MLComputePlan`. It stands in for Xcode's Performance report; see below.

## Step 1: speed

### Latency (500 runs, no GPU load), ms

| Model | ANE median | ANE p99 | GPU median | GPU p99 | GPU ÷ ANE (median) |
|---|---|---|---|---|---|
| tiny | 3.80 | 4.05 | 5.86 | 7.07 | 1.5× |
| small | 4.64 | 5.46 | 8.23 | 9.54 | 1.8× |
| medium | 9.03 | 10.03 | 21.28 | 23.68 | 2.4× |
| temporal | 4.83 | 5.26 | 9.00 | 10.58 | 1.9× |
| blend | 2.52 | 4.66 | 5.46 | 8.39 | 2.2× |

The ANE is clearly faster than the GPU for every model, so none of them look like they are secretly falling back to the GPU. The measured ANE times are a bit better than the README's guesses for small and medium (about 5 and 13 ms guessed), and worse for tiny (about 2 ms guessed). tiny's 3.8 ms floor for 7.8 billion multiply-adds suggests that fixed cost dominates at this size: moving 2560×1440 fp16 tensors in and out, plus dispatch.

### Contention (10 ms synthetic GPU load per frame, one inference per 60 Hz frame, 8 s per phase), ms

| Model | GPU load alone (median / p99) | + model on ANE: GPU frame added (median / p99) | ANE latency under load (median / p99) | + model on GPU: GPU frame added (median / p99) | GPU-run latency (p99) |
|---|---|---|---|---|---|
| tiny | 9.34 / 10.00 | **+0.32 / +0.07** | 4.39 / **4.76** | +4.13 / +4.94 | 10.20 |
| small | 9.79 / 11.02 | **−0.01 / −0.14** | 5.48 / **9.50** | +5.76 / +9.18 | 15.42 |
| temporal | 9.94 / 11.26 | **−0.00 / −0.25** | 7.97 / **8.84** | +7.03 / +9.70 | 16.79 |
| blend | 9.94 / 11.84 | **−0.00 / −0.21** | 3.06 / **5.10** | +3.96 / +3.38 | 11.91 |
| small, `--load-ms 14` | 13.37 / 14.20 | **−0.15 / +0.03** | 5.17 / **7.40** | +8.97 / +12.60 | 13.71 |

First run, for comparison (ANE p99 under load): tiny 7.31, small 9.78, temporal 9.10, blend 3.46, small at 14 ms 8.11. The first run's tiny p99 (7.31) was noisier, but it still fit the budget.

`medium` was not run under contention: its *unloaded* median of 9.0 ms is already over the 8 ms budget.

### MetalFX (GPU, 1280×720 → 2560×1440, 290 frames), ms

| Scaler | median | p99 |
|---|---|---|
| MetalFX temporal | 2.32 | 2.77 |
| MetalFX spatial | 0.67 | 1.00 |

### Neural Engine placement

Xcode 27.1 has no command-line way to create the Core ML Performance report: `coremlc` and `coremlcompiler` only compile and generate code. Instead I used `MLComputePlan`, the Core ML API that reports the device each op is planned to run on. It was run with compute units `.cpuAndNeuralEngine`.

| Model | Ops on the Neural Engine | Ops on GPU or CPU | Estimated cost off the ANE |
|---|---|---|---|
| tiny | 15 | 0 | 0% |
| small | 19 | 0 | 0% |
| medium | 23 | 0 | 0% |
| temporal | 20 | 0 | 0% |
| blend | 14 | 0 | 0% |

**No fallbacks: every op of every model is placed on the Neural Engine.** This agrees with the latency table: the ANE runs are 1.5 to 2.4 times faster than the GPU runs, and add essentially no GPU time.

### Step 1 verdict against the README criteria

| Model | ANE p99 under load ≤ 8 ms | Adds < ~0.5 ms GPU | Clearly cheaper than the same model on the GPU and than MetalFX temporal (2.32 ms) | Result |
|---|---|---|---|---|
| tiny | ✅ 4.76 (first run 7.31) | ✅ +0.32 / +0.07 | ✅ vs +4.13 GPU, 2.32 MetalFX | **PASS** |
| small | ❌ 9.50 (first run 9.78); 7.40 at 14 ms load | ✅ ≈0 | ✅ | **FAIL** (borderline) |
| medium | ❌ 9.03 median with no load | — | — | **FAIL** |
| temporal | ❌ 8.84 (first run 9.10) | ✅ ≈0 | ✅ | **FAIL** (borderline) |
| blend | ✅ 5.10 (first run 3.46) | ✅ ≈0 | ✅ vs +3.96 GPU, 2.32 MetalFX | **PASS** |

**What this means:** only `tiny` and `blend` pass. By the README's rule, the full-network approach at `small` size or above is dead on the M2 Pro, and the hybrid design (GPU reprojects, ANE predicts blend weights) is still possible. tiny passes too, so step 2 checks whether a network that small is good enough on its own.

Observations:
- Running on the ANE has a near-zero GPU cost. Even sharing memory bandwidth with a 256 MB-streaming GPU load, the GPU frame time is unchanged within noise. This is the strongest result here.
- The ANE's p99 is the limit, not its median. small and temporal have medians of 5.5 and 8.0 ms under load, but long tails. small's p99 was *lower* with a heavier GPU load (7.40 vs 9.50 ms). That points to scheduling jitter on the CPU and ANE, which is the transfer and dispatch path, rather than GPU contention. These two models are borderline, not clearly out.
- These runs were on battery. Apple Silicon runs at nearly the same speed on battery with Low Power Mode off, but tail latencies could be slightly better on mains power.

## Step 2: quality

_Pending._
