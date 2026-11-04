#!/usr/bin/env python3
"""Simulated room impulse responses for round 4 (pyroomacoustics, image source method).

far.npy: lounge-sized rooms, the mic on the TV wall at 0.9-1.6 m, the talker 0.7-7 m away
(Mike's sofa is about 3-4 m from the TV, the far side of the room about 5-6 m).
near.npy: the same rooms with the talker 0.3-1.5 m away.
Each RIR is cut to 1 s and scaled so the direct path is 1.0.
"""
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
SR = 16000


def one(args):
    seed, near = args
    import pyroomacoustics as pra
    rng = np.random.default_rng(seed)
    while True:
        dim = np.array([rng.uniform(3.5, 8.5), rng.uniform(3, 6.5), rng.uniform(2.4, 3.2)])
        rt60 = rng.uniform(.2, .9)
        try:
            e_abs, order = pra.inverse_sabine(rt60, dim)
        except ValueError:
            continue
        mic = np.array([rng.uniform(.2, .6), rng.uniform(.3, dim[1] - .3), rng.uniform(.9, 1.6)])
        for _ in range(50):
            src = np.array([rng.uniform(.3, dim[0] - .3), rng.uniform(.3, dim[1] - .3), rng.uniform(.9, 1.85)])
            dist = np.linalg.norm(src - mic)
            if (.3 <= dist <= 1.5) if near else (.7 <= dist <= 7):
                break
        else:
            continue
        room = pra.ShoeBox(dim, fs=SR, materials=pra.Material(e_abs), max_order=min(order, 18), air_absorption=True)
        room.add_source(src)
        room.add_microphone(mic)
        room.compute_rir()
        r = np.asarray(room.rir[0][0], dtype=np.float32)
        d = int(np.argmax(np.abs(r)))
        r = r[max(0, d - 32):][:SR]
        r = r / max(1e-6, float(np.abs(r).max()))
        return np.pad(r, (0, SR - len(r))), dist, rt60


def main():
    out = W / 'data/r4_rirs'
    out.mkdir(parents=True, exist_ok=True)
    for name, n, near, base in (('far', 4000, False, 0), ('near', 1000, True, 100000)):
        if (out / f'{name}.npy').exists():
            continue
        with ProcessPoolExecutor(int(os.environ.get("R4_CPU", 10))) as pool:
            rows = list(pool.map(one, [(base + i, near) for i in range(n)], chunksize=8))
        np.save(out / f'{name}.npy', np.stack([r[0] for r in rows]))
        np.save(out / f'{name}_meta.npy', np.array([[r[1], r[2]] for r in rows], np.float32))
        d = np.array([r[1] for r in rows])
        print(name, n, 'distance m', np.percentile(d, [5, 50, 95]).round(2), flush=True)


if __name__ == '__main__':
    main()
