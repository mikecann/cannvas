#!/usr/bin/env python3
"""Weight-space interpolation (WiSE-FT) between the shipped model (raw, calibration shift removed) and a model
fine-tuned from it: theta = (1 - alpha) * shipped + alpha * finetuned. Same graph, so the output is a normal
openWakeWord ONNX model. Usage: interp.py <shipped.onnx> <bias shift to undo> <finetuned_raw.onnx> <alpha> <out.onnx>"""
import sys
import onnx
from onnx import numpy_helper
old_p, shift, ft_p, alpha, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], float(sys.argv[4]), sys.argv[5]
old, ft = onnx.load(old_p), onnx.load(ft_p)
o = {i.name: numpy_helper.to_array(i).copy() for i in old.graph.initializer}
o["last_layer.bias"] = o["last_layer.bias"] + shift
for init in ft.graph.initializer:
    if init.name in o:
        x = (1 - alpha) * o[init.name] + alpha * numpy_helper.to_array(init)
        init.CopyFrom(numpy_helper.from_array(x.astype(numpy_helper.to_array(init).dtype), init.name))
onnx.checker.check_model(ft)
onnx.save(ft, out)
print("wrote", out)
