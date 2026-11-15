"""Train a candidate upscaler on captured pairs, then compare it with the classic upscalers and MetalFX spatial.

  python train.py --data data/fungal data/desert --model small --steps 20000
  python train.py --data data/fungal data/desert --model small --eval-only --ckpt runs/small.pt [--metalfx data/metalfx]

The last 10% of each data folder is held out for evaluation. Uses the Apple GPU (MPS) when available.
Evaluation prints PSNR / SSIM (higher is better) and LPIPS (lower is better, if the `lpips` package is installed)
for: bilinear, bicubic, Lanczos, MetalFX spatial (if --metalfx points at its outputs, named like the test images)
and the trained model; and writes side-by-side crops to runs/compare_*.png.
"""
import argparse, glob, math, os, random, time
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from models import VARIANTS

ap = argparse.ArgumentParser()
ap.add_argument("--data", nargs="+", required=True)
ap.add_argument("--model", default="small", choices=[k for k, v in VARIANTS.items() if v[1] == 3])
ap.add_argument("--steps", type=int, default=20000)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--crop", type=int, default=96, help="training crop size at input resolution")
ap.add_argument("--lr", type=float, default=3e-4)
ap.add_argument("--ckpt")
ap.add_argument("--eval-only", action="store_true")
ap.add_argument("--metalfx", help="folder of MetalFX spatial outputs for the test images (bench metalfx-images)")
ap.add_argument("--out", default="runs")
a = ap.parse_args()
dev = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
os.makedirs(a.out, exist_ok=True)


def load(p):
    return torch.from_numpy(np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255).permute(2, 0, 1)


# ---------------------------------------------------------------- data: held-out = last 10% of each folder
train, test = [], []
for d in a.data:
    names = sorted(os.path.basename(f) for f in glob.glob(os.path.join(d, "low", "*.png")))
    k = max(1, len(names) // 10)
    pairs = [(os.path.join(d, "low", n), os.path.join(d, "high", n), f"{os.path.basename(os.path.normpath(d))}_{n}") for n in names]
    train += pairs[:-k]; test += pairs[-k:]
print(f"{len(train)} training pairs, {len(test)} test pairs, device {dev}")
cache = {}
def load_u8(p):
    return torch.from_numpy(np.asarray(Image.open(p).convert("RGB"), dtype=np.uint8).copy()).permute(2, 0, 1)
def pair(lo_p, hi_p):  # images stay in memory after the first use, as uint8 (float32 for 540 pairs is ~30 GB)
    if lo_p not in cache:
        cache[lo_p] = (load_u8(lo_p), load_u8(hi_p))
    return cache[lo_p]


def batch():
    xs, ys = [], []
    for _ in range(a.batch):
        lo, hi = pair(*random.choice(train)[:2])
        _, h, w = lo.shape; c = min(a.crop, h, w)
        y0, x0 = random.randrange(h - c + 1), random.randrange(w - c + 1)
        x, y = lo[:, y0:y0 + c, x0:x0 + c], hi[:, 2 * y0:2 * (y0 + c), 2 * x0:2 * (x0 + c)]
        if random.random() < 0.5: x, y = x.flip(2), y.flip(2)
        xs.append(x.float() / 255); ys.append(y.float() / 255)
    return torch.stack(xs).to(dev), torch.stack(ys).to(dev)


# ---------------------------------------------------------------- metrics
def psnr(x, y):
    return 10 * math.log10(1 / max(F.mse_loss(x.clamp(0, 1), y).item(), 1e-10))


def ssim(x, y):
    """SSIM on luma with an 11x11 Gaussian window."""
    w = torch.tensor([.299, .587, .114], device=x.device).view(1, 3, 1, 1)
    x, y = (x.clamp(0, 1) * w).sum(1, keepdim=True), (y * w).sum(1, keepdim=True)
    g = torch.exp(-(torch.arange(11, device=x.device) - 5.) ** 2 / (2 * 1.5 ** 2)); g = (g / g.sum())
    k = (g[:, None] * g[None, :]).view(1, 1, 11, 11)
    mu = lambda t: F.conv2d(t, k, padding=5)
    mx, my = mu(x), mu(y); vx, vy, cxy = mu(x * x) - mx ** 2, mu(y * y) - my ** 2, mu(x * y) - mx * my
    c1, c2 = .01 ** 2, .03 ** 2
    return (((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))).mean().item()


try:
    import lpips
    lp = lpips.LPIPS(net="alex", verbose=False).to(dev)
    lpips_fn = lambda x, y: lp(x.clamp(0, 1) * 2 - 1, y * 2 - 1).item()
except Exception:
    lpips_fn = None


# ---------------------------------------------------------------- model
make, _ = VARIANTS[a.model]
model = make().to(dev)
ckpt = a.ckpt or os.path.join(a.out, f"{a.model}.pt")
if a.eval_only:
    model.load_state_dict(torch.load(ckpt, map_location=dev))
else:
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.steps)
    t0, run = time.time(), 0.
    for step in range(1, a.steps + 1):
        x, y = batch()
        loss = F.l1_loss(model(x), y)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        run = run * 0.98 + loss.item() * 0.02 if step > 1 else loss.item()
        if step % 500 == 0 or step == a.steps:
            print(f"step {step}/{a.steps}  L1 {run:.4f}  {(time.time() - t0) / step * 1000:.0f} ms/step")
    torch.save(model.state_dict(), ckpt)
    print("saved", ckpt, "- convert it for the benchmark with: python convert.py", a.model, "--ckpt", ckpt)

# ---------------------------------------------------------------- evaluation on the held-out frames
model.eval()
methods = {
    "bilinear": lambda x: F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False),
    "bicubic": lambda x: F.interpolate(x, scale_factor=2, mode="bicubic", align_corners=False),
    "lanczos": None,
    a.model: lambda x: model(x),
}
if a.metalfx: methods["metalfx"] = None
scores = {m: [] for m in methods}
with torch.no_grad():
    for i, (lo_p, hi_p, name) in enumerate(test):
        lo, hi = load(lo_p)[None].to(dev), load(hi_p)[None].to(dev)
        outs = {}
        for m, f in methods.items():
            if m == "lanczos":
                im = Image.open(lo_p).convert("RGB"); o = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
                o = torch.from_numpy(np.asarray(o, dtype=np.float32) / 255).permute(2, 0, 1)[None].to(dev)
            elif m == "metalfx":
                mp = os.path.join(a.metalfx, os.path.basename(lo_p))
                if not os.path.exists(mp): continue
                o = load(mp)[None].to(dev)
            else:
                o = f(lo)
            outs[m] = o
            scores[m].append((psnr(o, hi), ssim(o, hi), lpips_fn(o, hi) if lpips_fn else float("nan")))
        if i < 4:  # side-by-side crops from the middle of the frame, 2x nearest so the detail is visible
            H, W = hi.shape[2:]; cy, cx, ch, cw = H // 2 - 90, W // 2 - 160, 180, 320
            tiles = [hi] + list(outs.values())
            row = torch.cat([F.interpolate(t[:, :, cy:cy + ch, cx:cx + cw].clamp(0, 1), scale_factor=2, mode="nearest") for t in tiles], 3)
            Image.fromarray((row[0].permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)).save(os.path.join(a.out, f"compare_{name}"))
print("\n" + " " * 10 + "   PSNR     SSIM    LPIPS   (crops in runs/compare_*: target, then " + ", ".join(methods) + ")")
for m, v in scores.items():
    if v:
        s = np.array(v).mean(0)
        print(f"{m:10s} {s[0]:7.2f}  {s[1]:7.4f}  {s[2]:7.4f}")
