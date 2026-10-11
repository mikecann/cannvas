"""Batch scoring of feature windows with an openWakeWord ONNX classifier (batch dim made symbolic)."""
import numpy as np
import onnx
import onnxruntime as ort


def session(path, threads=4):
    m = onnx.load(path)
    for t in list(m.graph.input) + list(m.graph.output):
        t.type.tensor_type.shape.dim[0].dim_param = "N"
    so = ort.SessionOptions(); so.intra_op_num_threads = threads
    return ort.InferenceSession(m.SerializeToString(), so, providers=["CPUExecutionProvider"])


def scores(sess, x, bs=8192):
    n = sess.get_inputs()[0].name
    out = [sess.run(None, {n: x[i:i + bs].astype(np.float32)})[0].reshape(-1) for i in range(0, len(x), bs)]
    return np.concatenate(out) if out else np.zeros(0)


def windows(v, n=16):
    return np.lib.stride_tricks.sliding_window_view(v, (n, v.shape[1]))[:, 0]
