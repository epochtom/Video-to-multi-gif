const COLORS = ["#e85d2a", "#e2b657", "#7db7c7", "#8fbf6a", "#d989c7", "#f0a07a"];

const state = {
  file: null,
  localUrl: null,
  videoId: null,
  uploading: false,
  duration: 0,
  inPoint: 0,
  outPoint: 0,
  clips: [],
  format: "gif",
  width: 480,
  fps: 12,
  dragging: false,
};

const els = {
  welcome: document.getElementById("welcome"),
  editor: document.getElementById("editor"),
  results: document.getElementById("results"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  player: document.getElementById("player"),
  playBtn: document.getElementById("playBtn"),
  clock: document.getElementById("clock"),
  inBtn: document.getElementById("inBtn"),
  outBtn: document.getElementById("outBtn"),
  addBtn: document.getElementById("addBtn"),
  timeline: document.getElementById("timeline"),
  track: document.getElementById("track"),
  range: document.getElementById("range"),
  playhead: document.getElementById("playhead"),
  clipBars: document.getElementById("clipBars"),
  ticks: document.getElementById("ticks"),
  clipList: document.getElementById("clipList"),
  clipCount: document.getElementById("clipCount"),
  clearBtn: document.getElementById("clearBtn"),
  exportBtn: document.getElementById("exportBtn"),
  status: document.getElementById("status"),
  topMeta: document.getElementById("topMeta"),
  widthInput: document.getElementById("widthInput"),
  widthLabel: document.getElementById("widthLabel"),
  fpsInput: document.getElementById("fpsInput"),
  fpsLabel: document.getElementById("fpsLabel"),
  partsInput: document.getElementById("partsInput"),
  splitBtn: document.getElementById("splitBtn"),
  sliceInput: document.getElementById("sliceInput"),
  sliceBtn: document.getElementById("sliceBtn"),
  resultGrid: document.getElementById("resultGrid"),
  zipLink: document.getElementById("zipLink"),
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function setStatus(message, isError = false) {
  els.status.textContent = message || "";
  els.status.classList.toggle("error", Boolean(isError));
}

function pct(time) {
  if (!state.duration) return 0;
  return Math.min(100, Math.max(0, (time / state.duration) * 100));
}

function timeFromEvent(event) {
  const rect = els.track.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  return (x / rect.width) * state.duration;
}

function renderTimeline() {
  const a = Math.min(state.inPoint, state.outPoint);
  const b = Math.max(state.inPoint, state.outPoint);
  els.range.style.left = `${pct(a)}%`;
  els.range.style.width = `${Math.max(0.4, pct(b) - pct(a))}%`;
  els.playhead.style.left = `${pct(els.player.currentTime || 0)}%`;

  els.clipBars.innerHTML = state.clips
    .map(
      (clip, i) =>
        `<div class="clip-bar" style="left:${pct(clip.start)}%;width:${pct(clip.end) - pct(clip.start)}%;background:${COLORS[i % COLORS.length]}"></div>`
    )
    .join("");

  const ticks = [];
  const steps = state.duration > 30 ? 8 : 6;
  for (let i = 0; i <= steps; i += 1) {
    const t = (state.duration * i) / steps;
    ticks.push(`<span class="tick" style="left:${(i / steps) * 100}%">${formatTime(t)}</span>`);
  }
  els.ticks.innerHTML = ticks.join("");
}

function renderClips() {
  els.clipCount.textContent = String(state.clips.length);
  els.exportBtn.disabled = state.clips.length === 0 || !state.file;
  els.clipList.innerHTML = state.clips
    .map((clip, i) => {
      const color = COLORS[i % COLORS.length];
      return `<li class="clip-item">
        <span class="swatch" style="background:${color}"></span>
        <span class="times">${formatTime(clip.start)} → ${formatTime(clip.end)}</span>
        <button type="button" data-play="${i}">Play</button>
        <button type="button" data-del="${i}">Remove</button>
      </li>`;
    })
    .join("");
}

function renderClock() {
  els.clock.textContent = `${formatTime(els.player.currentTime || 0)} / ${formatTime(state.duration)}`;
}

function addClip(start, end) {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(state.duration, Math.max(start, end));
  if (b - a < 0.05) {
    setStatus("Clip is too short.", true);
    return;
  }
  state.clips.push({
    start: a,
    end: b,
    label: `clip-${String(state.clips.length + 1).padStart(2, "0")}`,
  });
  renderClips();
  renderTimeline();
  setStatus(`${state.clips.length} clip${state.clips.length === 1 ? "" : "s"} ready.`);
}

function loadFile(file) {
  if (!file || !file.type.startsWith("video/")) {
    setStatus("Please choose a video file.", true);
    return;
  }
  if (state.localUrl) URL.revokeObjectURL(state.localUrl);
  state.file = file;
  state.videoId = null;
  state.clips = [];
  state.localUrl = URL.createObjectURL(file);
  els.player.src = state.localUrl;
  els.welcome.classList.add("hidden");
  els.editor.classList.remove("hidden");
  els.results.classList.add("hidden");
  els.topMeta.textContent = file.name;
  renderClips();
  setStatus("Uploading in the background…");
  uploadFile(file);
}

function uploadFile(file) {
  state.uploading = true;
  const data = new FormData();
  data.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const pctDone = Math.round((event.loaded / event.total) * 100);
    setStatus(`Uploading ${pctDone}%`);
  };
  xhr.onload = () => {
    state.uploading = false;
    try {
      const body = JSON.parse(xhr.responseText);
      if (xhr.status >= 400) throw new Error(body.detail || "Upload failed");
      state.videoId = body.id;
      if (body.duration) state.duration = body.duration;
      setStatus("Video ready. Mark clips, then export.");
      renderClock();
      renderTimeline();
    } catch (err) {
      setStatus(err.message || "Upload failed", true);
    }
  };
  xhr.onerror = () => {
    state.uploading = false;
    setStatus("Upload failed. Try again.", true);
  };
  xhr.send(data);
}

async function waitForUpload() {
  const started = Date.now();
  while (!state.videoId) {
    if (!state.uploading && !state.videoId) throw new Error("Upload failed.");
    if (Date.now() - started > 180000) throw new Error("Upload timed out.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

els.player.addEventListener("loadedmetadata", () => {
  state.duration = els.player.duration || 0;
  state.inPoint = 0;
  state.outPoint = Math.min(2, state.duration);
  renderClock();
  renderTimeline();
});

els.player.addEventListener("timeupdate", () => {
  renderClock();
  els.playhead.style.left = `${pct(els.player.currentTime || 0)}%`;
  els.playBtn.textContent = els.player.paused ? "Play" : "Pause";
});

els.playBtn.addEventListener("click", () => {
  if (els.player.paused) els.player.play();
  else els.player.pause();
});

els.inBtn.addEventListener("click", () => {
  state.inPoint = els.player.currentTime || 0;
  if (state.outPoint <= state.inPoint) state.outPoint = Math.min(state.duration, state.inPoint + 0.5);
  renderTimeline();
});

els.outBtn.addEventListener("click", () => {
  state.outPoint = els.player.currentTime || 0;
  if (state.outPoint <= state.inPoint) state.inPoint = Math.max(0, state.outPoint - 0.5);
  renderTimeline();
});

els.addBtn.addEventListener("click", () => addClip(state.inPoint, state.outPoint));

els.track.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  els.track.setPointerCapture(event.pointerId);
  const t = timeFromEvent(event);
  state.inPoint = t;
  state.outPoint = t;
  els.player.currentTime = t;
  renderTimeline();
});

els.track.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const t = timeFromEvent(event);
  state.outPoint = t;
  els.player.currentTime = t;
  renderTimeline();
});

els.track.addEventListener("pointerup", () => {
  state.dragging = false;
  if (Math.abs(state.outPoint - state.inPoint) < 0.05) {
    els.player.currentTime = state.inPoint;
  }
});

els.clipList.addEventListener("click", (event) => {
  const play = event.target.getAttribute("data-play");
  const del = event.target.getAttribute("data-del");
  if (play != null) {
    const clip = state.clips[Number(play)];
    if (!clip) return;
    els.player.currentTime = clip.start;
    els.player.play();
    const stop = () => {
      if (els.player.currentTime >= clip.end) {
        els.player.pause();
        els.player.removeEventListener("timeupdate", stop);
      }
    };
    els.player.addEventListener("timeupdate", stop);
  }
  if (del != null) {
    state.clips.splice(Number(del), 1);
    renderClips();
    renderTimeline();
  }
});

els.clearBtn.addEventListener("click", () => {
  state.clips = [];
  renderClips();
  renderTimeline();
  setStatus("Clips cleared.");
});

els.splitBtn.addEventListener("click", () => {
  const parts = Math.max(2, Math.min(40, Number(els.partsInput.value) || 2));
  const slice = state.duration / parts;
  state.clips = Array.from({ length: parts }, (_, i) => ({
    start: i * slice,
    end: i === parts - 1 ? state.duration : (i + 1) * slice,
    label: `clip-${String(i + 1).padStart(2, "0")}`,
  }));
  renderClips();
  renderTimeline();
});

els.sliceBtn.addEventListener("click", () => {
  const every = Math.max(0.5, Number(els.sliceInput.value) || 2);
  const clips = [];
  for (let t = 0, i = 1; t < state.duration - 0.05; t += every, i += 1) {
    clips.push({
      start: t,
      end: Math.min(state.duration, t + every),
      label: `clip-${String(i).padStart(2, "0")}`,
    });
  }
  state.clips = clips;
  renderClips();
  renderTimeline();
});

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((other) => other.classList.remove("on"));
    btn.classList.add("on");
    state.format = btn.dataset.format;
  });
});

els.widthInput.addEventListener("input", () => {
  state.width = Number(els.widthInput.value);
  els.widthLabel.textContent = `${state.width} px`;
});

els.fpsInput.addEventListener("input", () => {
  state.fps = Number(els.fpsInput.value);
  els.fpsLabel.textContent = `${state.fps} fps`;
});

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (file) loadFile(file);
});

document.getElementById("demoBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  setStatus("Loading demo…");
  const res = await fetch("/demo.mp4");
  const blob = await res.blob();
  loadFile(new File([blob], "demo.mp4", { type: "video/mp4" }));
});

["dragenter", "dragover"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("over");
  });
});

["dragleave", "drop"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("over");
  });
});

els.dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadFile(file);
});

document.addEventListener("keydown", (event) => {
  if (!state.file) return;
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (event.code === "Space") {
    event.preventDefault();
    if (els.player.paused) els.player.play();
    else els.player.pause();
  }
  if (event.key === "i" || event.key === "I") els.inBtn.click();
  if (event.key === "o" || event.key === "O") els.outBtn.click();
  if (event.key === "Enter") els.addBtn.click();
});

els.exportBtn.addEventListener("click", async () => {
  if (!state.clips.length) return;
  els.exportBtn.disabled = true;
  setStatus("Preparing export…");
  try {
    await waitForUpload();
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: state.videoId,
        format: state.format,
        width: state.width,
        fps: state.fps,
        clips: state.clips,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Could not start export");
    await pollJob(body.id);
  } catch (err) {
    setStatus(err.message || "Export failed", true);
    els.exportBtn.disabled = state.clips.length === 0;
  }
});

async function pollJob(jobId) {
  while (true) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.detail || "Job failed");
    if (job.status === "error") throw new Error(job.error || "Export failed");
    setStatus(`Exporting ${job.progress} / ${job.total}`);
    if (job.status === "done") {
      showResults(jobId, job.files);
      const extra = job.files.filter((file) => file.last_frame).length;
      setStatus(
        `Done. ${job.files.length} clip${job.files.length === 1 ? "" : "s"} and ${extra} last frame${extra === 1 ? "" : "s"} exported.`
      );
      els.exportBtn.disabled = state.clips.length === 0;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function showResults(jobId, files) {
  els.results.classList.remove("hidden");
  els.zipLink.href = `/api/jobs/${jobId}/zip`;
  els.resultGrid.innerHTML = files
    .map((file) => {
      const url = `/api/jobs/${jobId}/files/${encodeURIComponent(file.filename)}`;
      const media =
        file.format === "gif"
          ? `<img src="${url}" alt="${file.filename}" />`
          : `<video src="${url}" muted loop playsinline controls></video>`;
      const frame = file.last_frame;
      const frameUrl = frame
        ? `/api/jobs/${jobId}/files/${encodeURIComponent(frame.filename)}`
        : "";
      const frameBlock = frame
        ? `<div class="shot"><span class="tag">Last frame</span><img src="${frameUrl}" alt="${frame.filename}" /><div class="meta"><span>${frame.filename}<br>${bytes(frame.bytes)}</span><a href="${frameUrl}" download>Download</a></div></div>`
        : "";
      return `<article class="card"><div class="pair"><div class="shot"><span class="tag">Clip</span>${media}<div class="meta"><span>${file.filename}<br>${bytes(file.bytes)}</span><a href="${url}" download>Download</a></div></div>${frameBlock}</div></article>`;
    })
    .join("");
  els.results.scrollIntoView({ behavior: "smooth", block: "start" });
}
