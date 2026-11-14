"""Candidate upscaler networks for the Apple Neural Engine (ANE) experiment.

Target: 1280x720 in -> 2560x1440 out (2x), 60 fps on an M2 Pro.
Every network does its work at a quarter of the input resolution (pixel_unshuffle by 2, so 640x360 with 4x the
channels), which keeps the ANE's work small, and predicts the difference from a plain bilinear upscale (so an
untrained network already outputs bilinear, and training only has to learn the detail).
Only ops the ANE handles well: 3x3 convolutions, ReLU, pixel (un)shuffle, bilinear resize, add.

  spatial models  input 3 channels (colour) - what experiment 2 trains and compares with MetalFX spatial
  temporal model  input 9 channels (colour, depth, motion xy, warped previous output rgb) - timing only for now:
                  it shows what the extra inputs of a DLSS-style temporal upscaler cost on the ANE
  blend model     the hybrid design: the GPU does reprojection and filtering, the ANE only predicts 4 per-pixel
                  blend weights at input resolution, so its output is small
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

IN_W, IN_H, SCALE = 1280, 720, 2


class Upscaler(nn.Module):
    def __init__(self, ch=32, layers=8, cin=3, scale=SCALE, unshuffle=2):
        super().__init__()
        self.scale, self.u, self.cin = scale, unshuffle, cin
        k = [nn.Conv2d(cin * unshuffle ** 2, ch, 3, padding=1), nn.ReLU(inplace=True)]
        for _ in range(layers - 2):
            k += [nn.Conv2d(ch, ch, 3, padding=1), nn.ReLU(inplace=True)]
        k += [nn.Conv2d(ch, 3 * (scale * unshuffle) ** 2, 3, padding=1)]
        self.body = nn.Sequential(*k)
        nn.init.zeros_(self.body[-1].weight)  # starts as exactly bilinear
        nn.init.zeros_(self.body[-1].bias)

    def forward(self, x):
        base = F.interpolate(x[:, :3], scale_factor=self.scale, mode="bilinear", align_corners=False)
        return base + F.pixel_shuffle(self.body(F.pixel_unshuffle(x, self.u)), self.scale * self.u)


class Blend(nn.Module):
    """Hybrid: 4 blend weights per input pixel (e.g. history weight, sharpen, two filter mixes) for the GPU to apply."""
    def __init__(self, ch=24, layers=6, cin=9, unshuffle=2, out=4):
        super().__init__()
        self.u = unshuffle
        k = [nn.Conv2d(cin * unshuffle ** 2, ch, 3, padding=1), nn.ReLU(inplace=True)]
        for _ in range(layers - 2):
            k += [nn.Conv2d(ch, ch, 3, padding=1), nn.ReLU(inplace=True)]
        k += [nn.Conv2d(ch, out * unshuffle ** 2, 3, padding=1)]
        self.body = nn.Sequential(*k)

    def forward(self, x):
        return torch.sigmoid(F.pixel_shuffle(self.body(F.pixel_unshuffle(x, self.u)), self.u))


# name: (constructor, input channels). Sizes bracket the estimated budget: tiny/small should fit, medium should not.
VARIANTS = {
    "tiny": (lambda: Upscaler(ch=24, layers=6), 3),
    "small": (lambda: Upscaler(ch=32, layers=8), 3),
    "medium": (lambda: Upscaler(ch=48, layers=10), 3),
    "temporal": (lambda: Upscaler(ch=32, layers=8, cin=9), 9),
    "blend": (lambda: Blend(), 9),
}


def gmacs(model, cin, w=IN_W, h=IN_H):
    """Multiply-accumulates per frame, in billions (convolutions only; everything else is small)."""
    total, hook = 0, []
    def count(m, i, o):
        nonlocal total
        total += o.numel() * m.in_channels * m.kernel_size[0] * m.kernel_size[1] // m.groups
    for m in model.modules():
        if isinstance(m, nn.Conv2d):
            hook.append(m.register_forward_hook(count))
    with torch.no_grad():
        model(torch.zeros(1, cin, h, w))
    for x in hook:
        x.remove()
    return total / 1e9


if __name__ == "__main__":
    # M2 Pro ANE: Apple quotes 15.8 TOPS; assume ~45% is reachable for real conv nets -> ~3.5 GMAC per ms
    for name, (make, cin) in VARIANTS.items():
        m = make().eval(); g = gmacs(m, cin)
        print(f"{name:9s} {sum(p.numel() for p in m.parameters()) / 1e3:7.1f}k params  {g:6.1f} GMAC/frame  ~{g / 3.5:5.1f} ms on the ANE (rough guess)")
