# Video to Multi GIF

Local web app that cuts one video into many GIFs or shorter MP4 clips.

Drop a file, mark ranges on a timeline (or auto-split), then export everything at once. Conversion runs on your machine with [FFmpeg](https://ffmpeg.org/). Nothing is uploaded to a third-party service.

Repository: [epochtom/Video-to-multi-gif](https://github.com/epochtom/Video-to-multi-gif)

## Features

- Drag-and-drop upload (MP4, MOV, MKV, WebM, AVI, and similar)
- Preview with in/out points on a timeline
- Manual clips, equal-part split, or slice every N seconds
- Export as looping GIF or H.264 MP4
- Width and frame-rate controls (GIFs use a palette for better color)
- Per-clip preview and download, plus a zip of all results
- Built-in 3-second demo clip to try the UI without a file

## Requirements

- Python 3.10+
- [FFmpeg](https://ffmpeg.org/download.html) and `ffprobe` on your `PATH`
- A modern browser

Check FFmpeg:

```bash
ffmpeg -version
ffprobe -version
```

On Windows, a full build such as [gyan.dev FFmpeg](https://www.gyan.dev/ffmpeg/builds/) works well.

## Install

```bash
git clone https://github.com/epochtom/Video-to-multi-gif.git
cd Video-to-multi-gif
python -m pip install -r requirements.txt
```

## Run

Windows:

```bat
run.bat
```

Any platform:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

Uploads and exports are stored under `data/` (ignored by git). Restarting the server clears in-memory job/video IDs, so export again if a previous session disappears.

## How to use

1. Drop a video, click **Choose video**, or use **Or try a 3-second demo**.
2. Add clips:
   - Drag on the timeline, then **Add clip**
   - **Split** into N equal parts
   - **Slice** every N seconds
3. Choose **GIF** or **Video (MP4)**, then set width and fps.
4. Click **Export clips**.
5. Download files individually or **Download all (.zip)**.

### Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| I | Mark in |
| O | Mark out |
| Enter | Add clip from the current in/out range |

### Output tips

- Start around **480px** and **10–12 fps** for GIFs. Higher values get large quickly.
- Long screen recordings should be chopped into short clips. A 30-second full-width GIF is usually a poor tradeoff vs MP4.
- MP4 exports are silent (`libx264`) and sized without upscaling past the source width.

## Project layout

```
Video-to-multi-gif/
├── app/
│   ├── main.py              # FastAPI server and job runner
│   ├── convert.py           # FFmpeg / ffprobe helpers
│   └── static/
│       ├── index.html
│       ├── styles.css
│       ├── app.js
│       └── demo.mp4
├── data/                    # Created at runtime (uploads + exports)
├── requirements.txt
├── run.bat
└── README.md
```

## HTTP API

Base URL: `http://127.0.0.1:8765`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/upload` | Multipart upload field `file` |
| `GET` | `/api/media/{video_id}` | Original uploaded file |
| `POST` | `/api/jobs` | Start an export job |
| `GET` | `/api/jobs/{job_id}` | Poll status |
| `GET` | `/api/jobs/{job_id}/files/{filename}` | Download one clip |
| `GET` | `/api/jobs/{job_id}/zip` | Download all clips as `clips.zip` |

### Upload response

```json
{
  "id": "a1b2c3...",
  "name": "clip.mp4",
  "duration": 12.5,
  "width": 1920,
  "height": 1080
}
```

### Create job body

```json
{
  "video_id": "a1b2c3...",
  "format": "gif",
  "width": 480,
  "fps": 12,
  "clips": [
    { "start": 0.0, "end": 2.5, "label": "intro" },
    { "start": 2.5, "end": 5.0, "label": "hook", "format": "mp4" }
  ]
}
```

- `format`: `gif` or `mp4` (default for every clip)
- `width`: 80–1920 (never upscales past the source)
- `fps`: 4–30
- `clips`: 1–60 items; each needs `end - start >= 0.05`
- Optional per-clip `format` overrides the job default

### Job status

```json
{
  "id": "job-id",
  "status": "running",
  "progress": 1,
  "total": 2,
  "error": null,
  "files": [
    {
      "filename": "intro.gif",
      "format": "gif",
      "start": 0.0,
      "end": 2.5,
      "duration": 2.5,
      "bytes": 184320
    }
  ]
}
```

`status` is `running`, `done`, or `error`. Poll until `done`, then download files or the zip.

### cURL

```bash
# Health
curl http://127.0.0.1:8765/api/health

# Upload
curl -F "file=@./my-video.mp4" http://127.0.0.1:8765/api/upload

# Export two GIFs (replace VIDEO_ID)
curl -X POST http://127.0.0.1:8765/api/jobs \
  -H "Content-Type: application/json" \
  -d "{\"video_id\":\"VIDEO_ID\",\"format\":\"gif\",\"width\":480,\"fps\":12,\"clips\":[{\"start\":0,\"end\":2,\"label\":\"a\"},{\"start\":2,\"end\":4,\"label\":\"b\"}]}"

# Poll (replace JOB_ID)
curl http://127.0.0.1:8765/api/jobs/JOB_ID

# Download zip
curl -L -o clips.zip http://127.0.0.1:8765/api/jobs/JOB_ID/zip
```

### JavaScript

```javascript
async function chopVideo(file) {
  const form = new FormData();
  form.append("file", file);

  const uploaded = await fetch("http://127.0.0.1:8765/api/upload", {
    method: "POST",
    body: form,
  }).then((r) => r.json());

  const job = await fetch("http://127.0.0.1:8765/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: uploaded.id,
      format: "gif",
      width: 480,
      fps: 12,
      clips: [
        { start: 0, end: 2, label: "clip-01" },
        { start: 2, end: 4, label: "clip-02" },
      ],
    }),
  }).then((r) => r.json());

  for (;;) {
    const status = await fetch(`http://127.0.0.1:8765/api/jobs/${job.id}`).then((r) =>
      r.json()
    );
    if (status.status === "error") throw new Error(status.error);
    if (status.status === "done") {
      window.location.href = `http://127.0.0.1:8765/api/jobs/${job.id}/zip`;
      return status.files;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}
```

### Python

```python
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8765"


def upload(path: Path) -> dict:
    data = path.read_bytes()
    boundary = "----ChopBoundary"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="file"; filename="'
            + path.name.encode()
            + b'"\r\n',
            b"Content-Type: video/mp4\r\n\r\n",
            data,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    req = Request(
        f"{BASE}/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    return json.loads(urlopen(req).read())


def export_gifs(video_id: str, clips: list[dict]) -> dict:
    payload = json.dumps(
        {
            "video_id": video_id,
            "format": "gif",
            "width": 480,
            "fps": 12,
            "clips": clips,
        }
    ).encode()
    req = Request(
        f"{BASE}/api/jobs",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    job = json.loads(urlopen(req).read())
    while True:
        status = json.loads(urlopen(f"{BASE}/api/jobs/{job['id']}").read())
        if status["status"] == "error":
            raise RuntimeError(status["error"])
        if status["status"] == "done":
            zip_bytes = urlopen(f"{BASE}/api/jobs/{job['id']}/zip").read()
            Path("clips.zip").write_bytes(zip_bytes)
            return status
        time.sleep(0.4)


if __name__ == "__main__":
    video = upload(Path("my-video.mp4"))
    result = export_gifs(
        video["id"],
        [
            {"start": 0, "end": 2, "label": "clip-01"},
            {"start": 2, "end": 4, "label": "clip-02"},
        ],
    )
    print(result["files"])
```

## Troubleshooting

**`ffmpeg` / `ffprobe` not found**  
Install FFmpeg and confirm both commands work in a new terminal.

**Upload fails or duration is 0**  
The file may be audio-only, corrupt, or a codec FFmpeg cannot read. Re-export as H.264 MP4 and try again.

**GIF is huge**  
Lower width and fps, or shorten each clip. Use MP4 when you need longer segments.

**Export stuck after restart**  
Job IDs live in memory. Upload again and create a new job.

## License

Use and modify freely for your own projects. Add a license file if you want to publish this under specific terms.