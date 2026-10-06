from __future__ import annotations

import threading
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .convert import export_clip, probe, safe_stem

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
OUTPUTS = DATA / "outputs"
STATIC = Path(__file__).resolve().parent / "static"

UPLOADS.mkdir(parents=True, exist_ok=True)
OUTPUTS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Video Chop")

videos: dict[str, dict] = {}
jobs: dict[str, dict] = {}
lock = threading.Lock()

ALLOWED_EXT = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".avi",
    ".m4v",
    ".wmv",
    ".mpeg",
    ".mpg",
}


class ClipIn(BaseModel):
    start: float
    end: float
    label: str = ""
    format: str | None = None


class JobIn(BaseModel):
    video_id: str
    format: str = "gif"
    width: int = Field(default=480, ge=80, le=1920)
    fps: int = Field(default=12, ge=4, le=30)
    clips: list[ClipIn]


def get_video(video_id: str) -> dict:
    with lock:
        video = videos.get(video_id)
    if not video:
        raise HTTPException(404, "Video not found. Upload again.")
    return video


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    suffix = Path(file.filename or "clip.mp4").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(400, "Please upload a video file (mp4, mov, mkv, webm, avi).")

    video_id = uuid.uuid4().hex
    folder = UPLOADS / video_id
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"source{suffix}"

    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    try:
        info = probe(dest)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not read video: {exc}") from exc

    if info["duration"] <= 0:
        raise HTTPException(400, "Could not read video duration.")

    record = {
        "id": video_id,
        "path": str(dest),
        "name": Path(file.filename or dest.name).name,
        **info,
    }
    with lock:
        videos[video_id] = record

    return {
        "id": video_id,
        "name": record["name"],
        "duration": info["duration"],
        "width": info["width"],
        "height": info["height"],
    }


@app.get("/api/media/{video_id}")
def media(video_id: str):
    video = get_video(video_id)
    path = Path(video["path"])
    if not path.exists():
        raise HTTPException(404, "Source file missing.")
    return FileResponse(path, filename=video["name"])


@app.post("/api/jobs")
def create_job(body: JobIn):
    video = get_video(body.video_id)
    if not body.clips:
        raise HTTPException(400, "Add at least one clip.")
    if len(body.clips) > 60:
        raise HTTPException(400, "Too many clips (max 60).")

    fmt = body.format.lower().strip()
    if fmt in {"video", "mp4"}:
        fmt = "mp4"
    elif fmt != "gif":
        raise HTTPException(400, "Format must be gif or mp4.")

    duration = float(video["duration"])
    prepared = []
    for index, clip in enumerate(body.clips, start=1):
        start = max(0.0, min(clip.start, duration))
        end = max(0.0, min(clip.end, duration))
        if end - start < 0.05:
            raise HTTPException(400, f"Clip {index} is too short.")
        clip_fmt = (clip.format or fmt).lower().strip()
        if clip_fmt in {"video", "mp4"}:
            clip_fmt = "mp4"
        elif clip_fmt != "gif":
            raise HTTPException(400, f"Clip {index} has an invalid format.")
        prepared.append(
            {
                "start": start,
                "end": end,
                "label": clip.label,
                "format": clip_fmt,
                "index": index,
            }
        )

    job_id = uuid.uuid4().hex
    out_dir = OUTPUTS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "status": "running",
        "progress": 0,
        "total": len(prepared),
        "error": None,
        "files": [],
        "out_dir": str(out_dir),
        "zip_path": None,
    }
    with lock:
        jobs[job_id] = job

    thread = threading.Thread(
        target=_run_job,
        args=(job_id, video["path"], prepared, body.width, body.fps),
        daemon=True,
    )
    thread.start()
    return {"id": job_id}


def _run_job(job_id: str, src: str, clips: list[dict], width: int, fps: int) -> None:
    out_dir = OUTPUTS / job_id
    files = []
    try:
        for clip in clips:
            ext = "gif" if clip["format"] == "gif" else "mp4"
            stem = safe_stem(clip["label"], f"clip-{clip['index']:02d}")
            dest = out_dir / f"{stem}.{ext}"
            if dest.exists():
                dest = out_dir / f"{stem}-{clip['index']:02d}.{ext}"
            info = export_clip(
                Path(src),
                dest,
                clip["start"],
                clip["end"],
                clip["format"],
                width,
                fps,
            )
            files.append(info)
            with lock:
                jobs[job_id]["files"] = list(files)
                jobs[job_id]["progress"] = len(files)

        zip_path = out_dir / "clips.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in files:
                archive.write(out_dir / item["filename"], item["filename"])

        with lock:
            jobs[job_id]["zip_path"] = str(zip_path)
            jobs[job_id]["status"] = "done"
            jobs[job_id]["progress"] = len(files)
    except Exception as exc:
        with lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(exc)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found.")
        return {
            "id": job["id"],
            "status": job["status"],
            "progress": job["progress"],
            "total": job["total"],
            "error": job["error"],
            "files": job["files"],
        }


@app.get("/api/jobs/{job_id}/files/{filename}")
def job_file(job_id: str, filename: str):
    with lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    path = Path(job["out_dir"]) / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "File not found.")
    return FileResponse(path, filename=path.name)


@app.get("/api/jobs/{job_id}/zip")
def job_zip(job_id: str):
    with lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    if job["status"] != "done" or not job.get("zip_path"):
        raise HTTPException(400, "Export is not finished.")
    path = Path(job["zip_path"])
    if not path.exists():
        raise HTTPException(404, "Zip missing.")
    return FileResponse(path, filename="clips.zip")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
