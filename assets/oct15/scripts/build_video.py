"""Build reels and YouTube videos from frame images + voiceover audio.
Run inside the build sandbox: python3 build_video.py <spec.json>
spec: {"out": "x.mp4", "w":1080, "h":1920, "audio": "voice.mp3" or null,
       "frames": [{"img": "f1.png", "words": 12, "audio": "seg1.mp3" (optional)}...]}
If each frame has its own audio, durations come from each clip.
Else: one audio for all frames; boundaries from silence detection, fallback to word-proportional.
"""
import json, subprocess, sys, re, os, math

def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def dur(path):
    r = run(f'ffprobe -v error -show_entries format=duration -of csv=p=0 "{path}"')
    return float(r.stdout.strip())

def silences(path, noise="-32dB", mind=0.28):
    r = run(f'ffmpeg -i "{path}" -af silencedetect=noise={noise}:d={mind} -f null - 2>&1')
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stdout)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stdout)]
    return [((s + e) / 2, e - s) for s, e in zip(starts, ends)]

def boundaries(total, words, path):
    n = len(words)
    if n == 1:
        return [total]
    cum = []
    acc = 0
    tw = sum(words)
    for w in words[:-1]:
        acc += w
        cum.append(total * acc / tw)
    sil = silences(path)
    cuts = []
    used = set()
    for target in cum:
        best = None
        for i, (mid, ln) in enumerate(sil):
            if i in used:
                continue
            d = abs(mid - target)
            if d < total * 0.12 and (best is None or d < best[0]):
                best = (d, i, mid)
        if best:
            used.add(best[1]); cuts.append(best[2])
        else:
            cuts.append(target)
    cuts = sorted(cuts)
    # enforce monotonic min gap
    out = []
    last = 0.0
    for c in cuts:
        c = max(c, last + 1.2)
        out.append(c); last = c
    return out + [total]

def build(spec):
    W, H = spec["w"], spec["h"]
    frames = spec["frames"]
    lead, tail, fade = 0.5, 1.2, 0.45
    per_audio = all("audio" in f for f in frames)
    if per_audio:
        # concatenate segment audios with small gaps
        parts = []
        durs = []
        for i, f in enumerate(frames):
            d = dur(f["audio"]); durs.append(d + 0.6)
            parts.append(f'file \'{os.path.abspath(f["audio"])}\'')
        # build voice track with 0.6s gaps
        filt = "".join(f"[{i}:a]apad=pad_dur=0.6[a{i}];" for i in range(len(frames)))
        filt += "".join(f"[a{i}]" for i in range(len(frames))) + f"concat=n={len(frames)}:v=0:a=1[v]"
        ins = " ".join(f'-i "{f["audio"]}"' for f in frames)
        run(f'ffmpeg -y {ins} -filter_complex "{filt}" -map "[v]" -ar 44100 voice_full.wav')
        voice = "voice_full.wav"
    else:
        voice = spec["audio"]
        total = dur(voice)
        b = boundaries(total, [f["words"] for f in frames], voice)
        durs = []
        last = 0
        for c in b:
            durs.append(c - last); last = c
    durs[0] += lead
    durs[-1] += tail
    total_v = sum(durs)
    # video: each frame as a clip, xfade between
    ins = " ".join(f'-loop 1 -t {d + fade:.3f} -i "{f["img"]}"' for f, d in zip(frames, durs))
    n = len(frames)
    filt = ""
    for i in range(n):
        filt += f"[{i}:v]scale={W}:{H},format=yuv420p,setsar=1[v{i}];"
    if n == 1:
        filt += "[v0]copy[vo]"
    else:
        prev = "v0"; off = durs[0]
        for i in range(1, n):
            o = f"x{i}" if i < n - 1 else "vo"
            filt += f"[{prev}][v{i}]xfade=transition=fade:duration={fade}:offset={off:.3f}[{o}];"
            prev = o; off += durs[i]
        filt = filt.rstrip(";")
    # audio: voice delayed by lead + soft ambient pad
    pad = (f"aevalsrc='0.05*sin(2*PI*110*t)+0.035*sin(2*PI*165*t)+0.03*sin(2*PI*220*t)+0.02*sin(2*PI*330*t)*sin(0.25*t)':s=44100:d={total_v + 1:.2f},"
           f'lowpass=f=600,afade=t=in:st=0:d=2,afade=t=out:st={max(0, total_v - 2.5):.2f}:d=2.5,volume=0.35[pad]')
    afilt = f'[{n}:a]adelay={int(lead*1000)}|{int(lead*1000)},apad[vc];{pad};[vc][pad]amix=inputs=2:duration=first:dropout_transition=0,volume=1.4[ao]'
    cmd = (f'ffmpeg -y {ins} -i "{voice}" -filter_complex "{filt};{afilt}" -map "[vo]" -map "[ao]" '
           f'-t {total_v:.3f} -r 30 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -ac 2 -b:a 160k -movflags +faststart "{spec["out"]}"')
    r = run(cmd)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:]); sys.exit(1)
    print(spec["out"], f"{total_v:.1f}s", [round(d, 1) for d in durs])

if __name__ == "__main__":
    build(json.load(open(sys.argv[1])))
