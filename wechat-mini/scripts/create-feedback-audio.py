"""Synthesize two original, short answer cues as offline PCM WAV assets."""
import math
from pathlib import Path
import struct
import wave
import argparse
import shutil
import subprocess
import sys

SAMPLE_RATE = 22050
root = Path(__file__).resolve().parents[1] / 'miniprogram' / 'assets' / 'audio'
root.mkdir(parents=True, exist_ok=True)
masters = Path(__file__).resolve().parents[1] / 'scripts' / 'audio-masters'
masters.mkdir(parents=True, exist_ok=True)

def synthesize(name, notes, duration):
    frames = []
    for index in range(round(duration * SAMPLE_RATE)):
        time = index / SAMPLE_RATE
        value = 0.0
        for start, length, frequency, gain in notes:
            t = time - start
            if 0 <= t < length:
                attack = min(1.0, t / 0.012)
                release = min(1.0, (length-t) / 0.055)
                envelope = attack * release * math.exp(-2.7*t)
                tone = math.sin(2*math.pi*frequency*t) + 0.14*math.sin(4*math.pi*frequency*t)
                value += gain * envelope * tone
        frames.append(struct.pack('<h', round(max(-0.85, min(0.85, value))*32767)))
    with wave.open(str(masters / name), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        audio.writeframes(b''.join(frames))

# 温和的上行和弦与下行双音，便于区分，不使用尖锐蜂鸣声。
synthesize('correct.wav', [(0,.18,659.25,.24),(.09,.21,830.61,.23),(.18,.24,987.77,.23)], .45)
synthesize('wrong.wav', [(0,.19,392,.30),(.13,.23,293.66,.30)], .40)
print('Generated correct.wav (0.45s) and wrong.wav (0.40s), mono PCM 22050 Hz.')
parser = argparse.ArgumentParser()
parser.add_argument('--encoder', help='Path to an ffmpeg executable for exporting the bundled MP3 cues')
parser.add_argument('--lame-module-dir', help='Directory containing an optional build-only lameenc installation')
args = parser.parse_args()
encoder = args.encoder or shutil.which('ffmpeg')
if args.lame_module_dir:
    sys.path.insert(0, str(Path(args.lame_module_dir).resolve()))
    import lameenc
    for name in ('correct', 'wrong'):
        with wave.open(str(masters / (name+'.wav')), 'rb') as audio:
            codec = lameenc.Encoder()
            codec.set_bit_rate(64)
            codec.set_in_sample_rate(audio.getframerate())
            codec.set_out_sample_rate(44100)
            codec.set_channels(1)
            codec.set_quality(2)
            data = codec.encode(audio.readframes(audio.getnframes())) + codec.flush()
        if len(data) < 1000:
            raise SystemExit('MP3 export contains no usable audio frames.')
        (root / (name+'.mp3')).write_bytes(data)
    print('Exported real MP3 cues, mono 44100 Hz / 64 kbps.')
elif encoder:
    available = subprocess.run([encoder, '-hide_banner', '-encoders'], capture_output=True, text=True,
                               encoding='utf-8', errors='replace', check=True).stdout
    codec = 'libmp3lame' if 'libmp3lame' in available else 'mp3_mf' if 'mp3_mf' in available else None
    if not codec:
        raise SystemExit('This ffmpeg build has no MP3 encoder.')
    for name in ('correct', 'wrong'):
        subprocess.run([encoder, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(masters / (name+'.wav')),
                        '-ac', '1', '-ar', '44100', '-c:a', codec, '-b:a', '64k', str(root / (name+'.mp3'))], check=True)
        if (root / (name+'.mp3')).stat().st_size < 1000:
            raise SystemExit('MP3 encoder produced no usable frames; use --lame-module-dir instead.')
    print('Exported real MP3 cues, mono 44100 Hz / 64 kbps.')
else:
    print('MP3 exports already ship with the project. Pass --encoder or add ffmpeg to PATH when regenerating them.')
