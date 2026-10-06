import json
import os
import re
import subprocess
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "ffmpeg failed").strip()
        raise RuntimeError(err[-2500:])
    return result


def probe(path: Path) -> dict:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration,codec_name",
            "-show_entries",
            "format=duration,size",
            "-of",
            "json",
            str(path),
        ]
    )
    data = json.loads(result.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    duration = stream.get("duration") or fmt.get("duration") or 0
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "duration": float(duration or 0),
        "codec": stream.get("codec_name") or "",
        "size": int(fmt.get("size") or 0),
    }


def safe_stem(label: str, fallback: str) -> str:
    cleaned = SAFE_NAME.sub("-", (label or "").strip()).strip(".-")
    return cleaned[:80] or fallback


def export_clip(
    src: Path,
    dst: Path,
    start: float,
    end: float,
    fmt: str,
    width: int,
    fps: int,
) -> dict:
    duration = max(0.05, end - start)
    start = max(0.0, start)
    fmt = fmt.lower().strip()

    if fmt == "gif":
        scale = f"scale='min({width},iw)':-1:flags=lanczos"
        vf = f"fps={fps},{scale}"
        run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{duration:.3f}",
                "-i",
                str(src),
                "-filter_complex",
                f"{vf},split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a",
                "-loop",
                "0",
                str(dst),
            ]
        )
    elif fmt in {"mp4", "video"}:
        scale = f"scale='min({width},iw)':-2"
        run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{duration:.3f}",
                "-i",
                str(src),
                "-vf",
                scale,
                "-r",
                str(fps),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-movflags",
                "+faststart",
                str(dst),
            ]
        )
    else:
        raise ValueError(f"Unsupported format: {fmt}")

    size = dst.stat().st_size if dst.exists() else 0
    return {
        "filename": dst.name,
        "format": "gif" if fmt == "gif" else "mp4",
        "start": round(start, 3),
        "end": round(start + duration, 3),
        "duration": round(duration, 3),
        "bytes": size,
    }


def extract_last_frame(src: Path, dst: Path, end: float, width: int) -> dict:
    scale = f"scale='min({width},iw)':-1:flags=lanczos"
    seeks = [max(0.0, end - 0.001), max(0.0, end - 0.04), max(0.0, end - 0.12)]
    last_error: Exception | None = None
    for seek in seeks:
        try:
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{seek:.3f}",
                    "-i",
                    str(src),
                    "-frames:v",
                    "1",
                    "-vf",
                    scale,
                    str(dst),
                ]
            )
            if dst.exists() and dst.stat().st_size > 0:
                return {
                    "filename": dst.name,
                    "format": "png",
                    "bytes": dst.stat().st_size,
                }
        except RuntimeError as exc:
            last_error = exc
    raise last_error or RuntimeError("Could not extract last frame.")
