"""Convert the candidate networks to Core ML (fp16 ML Program) for the benchmark.

  python convert.py                       # every variant, random weights (enough for timing)
  python convert.py small --ckpt runs/small.pt   # a trained model
Writes models/<name>.mlpackage. Inputs and outputs are fp16 tensors (1, C, H, W), the ANE's native format.
Conversion works on any OS; running the models needs macOS.
"""
import argparse, os, warnings
import numpy as np
import torch
import coremltools as ct
from models import VARIANTS, IN_W, IN_H, gmacs

warnings.filterwarnings("ignore")


def convert(name, ckpt=None, w=IN_W, h=IN_H, out_dir="models"):
    make, cin = VARIANTS[name]
    model = make().eval()
    if ckpt:
        model.load_state_dict(torch.load(ckpt, map_location="cpu"))
    x = torch.rand(1, cin, h, w)
    traced = torch.jit.trace(model, x)
    ml = ct.convert(
        traced,
        inputs=[ct.TensorType(name="x", shape=x.shape, dtype=np.float16)],
        outputs=[ct.TensorType(name="y", dtype=np.float16)],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        minimum_deployment_target=ct.target.macOS13,
    )
    ml.short_description = f"{name}: {gmacs(model, cin, w, h):.1f} GMAC, {cin}x{h}x{w} in"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.mlpackage")
    ml.save(path)
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", default=list(VARIANTS))
    ap.add_argument("--ckpt")
    a = ap.parse_args()
    for n in a.names:
        print("wrote", convert(n, a.ckpt))
