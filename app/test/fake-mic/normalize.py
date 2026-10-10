# Scales each WAV so speech sits well above the barge-in level (RMS 0.08) like a close-talking mic.
import sys, wave, array, math
TARGET_PEAK = 0.7
for path in sys.argv[1:]:
    with wave.open(path) as w:
        params = w.getparams()
        s = array.array("h", w.readframes(w.getnframes()))
    peak = max(abs(x) for x in s) / 32768
    g = TARGET_PEAK / peak
    s = array.array("h", (max(-32768, min(32767, int(x * g))) for x in s))
    voiced = [x / 32768 for x in s if abs(x) > 300]
    rms = math.sqrt(sum(v * v for v in voiced) / len(voiced))
    with wave.open(path, "wb") as w:
        w.setparams(params)
        w.writeframes(s.tobytes())
    print(f"{path}: {len(s) / params.framerate:.1f} s, gain {g:.2f}, voiced rms {rms:.3f}")
