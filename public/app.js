(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const startRange = document.getElementById('startRange');
  const endRange = document.getElementById('endRange');
  const rangeFill = document.getElementById('rangeFill');
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  const setStartBtn = document.getElementById('setStartBtn');
  const setEndBtn = document.getElementById('setEndBtn');
  const previewLoopBtn = document.getElementById('previewLoopBtn');
  const cutSaveBtn = document.getElementById('cutSaveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const status = document.getElementById('status');
  const unsupportedNotice = document.getElementById('unsupportedNotice');

  const MIN_GAP = 0.05;
  const POLL_INTERVAL_MS = 300;
  let currentFile = null;
  let duration = 0;
  let loopHandler = null;
  let activeJob = null; // { jobId, controller }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const supportsSavePicker = typeof window.showSaveFilePicker === 'function';
  if (!supportsSavePicker) {
    unsupportedNotice.classList.remove('hidden');
    cutSaveBtn.disabled = true;
  }

  function formatTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  }

  function parseTime(str) {
    const m = String(str).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!m) return NaN;
    const [, h, mi, s, ms] = m;
    return Number(h) * 3600 + Number(mi) * 60 + Number(s) + (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0);
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setProgress(fraction) {
    const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
  }

  function updateFill() {
    if (duration <= 0) return;
    const startPct = (Number(startRange.value) / duration) * 100;
    const endPct = (Number(endRange.value) / duration) * 100;
    rangeFill.style.left = startPct + '%';
    rangeFill.style.width = Math.max(0, endPct - startPct) + '%';
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) {
      setStatus('Please drop a video file.', 'error');
      return;
    }
    currentFile = file;
    const url = URL.createObjectURL(file);
    preview.src = url;
    editor.classList.remove('hidden');
    setStatus('');
  }

  preview.addEventListener('loadedmetadata', () => {
    duration = preview.duration;
    startRange.min = 0;
    startRange.max = duration;
    startRange.value = 0;
    endRange.min = 0;
    endRange.max = duration;
    endRange.value = duration;
    startTimeInput.value = formatTime(0);
    endTimeInput.value = formatTime(duration);
    updateFill();
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  // Range <-> time field sync
  startRange.addEventListener('input', () => {
    let v = Number(startRange.value);
    if (v > Number(endRange.value) - MIN_GAP) {
      v = Math.max(0, Number(endRange.value) - MIN_GAP);
      startRange.value = v;
    }
    startTimeInput.value = formatTime(v);
    preview.currentTime = v;
    updateFill();
  });

  endRange.addEventListener('input', () => {
    let v = Number(endRange.value);
    if (v < Number(startRange.value) + MIN_GAP) {
      v = Math.min(duration, Number(startRange.value) + MIN_GAP);
      endRange.value = v;
    }
    endTimeInput.value = formatTime(v);
    preview.currentTime = v;
    updateFill();
  });

  startTimeInput.addEventListener('change', () => {
    const v = parseTime(startTimeInput.value);
    if (!Number.isFinite(v)) {
      startTimeInput.value = formatTime(Number(startRange.value));
      return;
    }
    const clamped = Math.min(Math.max(v, 0), Number(endRange.value) - MIN_GAP);
    startRange.value = clamped;
    startTimeInput.value = formatTime(clamped);
    preview.currentTime = clamped;
    updateFill();
  });

  endTimeInput.addEventListener('change', () => {
    const v = parseTime(endTimeInput.value);
    if (!Number.isFinite(v)) {
      endTimeInput.value = formatTime(Number(endRange.value));
      return;
    }
    const clamped = Math.max(Math.min(v, duration), Number(startRange.value) + MIN_GAP);
    endRange.value = clamped;
    endTimeInput.value = formatTime(clamped);
    preview.currentTime = clamped;
    updateFill();
  });

  setStartBtn.addEventListener('click', () => {
    const v = Math.min(preview.currentTime, Number(endRange.value) - MIN_GAP);
    startRange.value = Math.max(0, v);
    startTimeInput.value = formatTime(Number(startRange.value));
    updateFill();
  });

  setEndBtn.addEventListener('click', () => {
    const v = Math.max(preview.currentTime, Number(startRange.value) + MIN_GAP);
    endRange.value = Math.min(duration, v);
    endTimeInput.value = formatTime(Number(endRange.value));
    updateFill();
  });

  previewLoopBtn.addEventListener('click', () => {
    if (loopHandler) {
      preview.removeEventListener('timeupdate', loopHandler);
      loopHandler = null;
    }
    preview.currentTime = Number(startRange.value);
    preview.play();
    loopHandler = () => {
      if (preview.currentTime >= Number(endRange.value)) {
        preview.pause();
        preview.removeEventListener('timeupdate', loopHandler);
        loopHandler = null;
      }
    };
    preview.addEventListener('timeupdate', loopHandler);
  });

  cutSaveBtn.addEventListener('click', async () => {
    if (!currentFile) return;
    const start = Number(startRange.value);
    const end = Number(endRange.value);
    if (!(start < end)) {
      setStatus('Start must be before end.', 'error');
      return;
    }

    const baseName = currentFile.name.replace(/\.[^.]+$/, '');
    let fileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${baseName}-trimmed.mp4`,
        types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus(`Could not open save dialog: ${err.message}`, 'error');
      return;
    }

    const controller = new AbortController();
    activeJob = { jobId: null, controller };
    cutSaveBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    progressWrap.classList.remove('hidden');
    setProgress(0);

    try {
      setStatus('Uploading…');
      const formData = new FormData();
      formData.append('file', currentFile);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData, signal: controller.signal });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      const { fileId } = await uploadRes.json();

      const mode = document.querySelector('input[name="mode"]:checked').value;
      // Generated client-side (rather than read from the response) so a Cancel click
      // can still reach the server even if this request itself gets aborted mid-flight.
      const jobId = crypto.randomUUID();
      activeJob.jobId = jobId;
      setStatus(mode === 'accurate' ? 'Trimming (re-encoding, this may take a while)…' : 'Trimming…');
      const startRes = await fetch('/api/trim/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, start, end, mode, jobId }),
        signal: controller.signal,
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start trim');
      }

      // Poll for progress until the job finishes, fails, or is canceled.
      while (true) {
        await sleep(POLL_INTERVAL_MS);
        const progRes = await fetch(`/api/trim/progress/${jobId}`, { signal: controller.signal });
        const data = await progRes.json();
        if (data.status === 'error') throw new Error(data.error || 'Trim failed');
        if (data.status === 'canceled') throw new DOMException('Canceled', 'AbortError');
        setProgress(data.progress);
        if (data.status === 'done') break;
      }

      setStatus('Saving to disk…');
      const downloadRes = await fetch(`/api/trim/download/${jobId}`, { signal: controller.signal });
      if (!downloadRes.ok) {
        const err = await downloadRes.json().catch(() => ({}));
        throw new Error(err.error || 'Download failed');
      }
      const writable = await fileHandle.createWritable();
      await downloadRes.body.pipeTo(writable, { signal: controller.signal });

      setStatus('Saved.', 'success');
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatus('Canceled.');
        if (activeJob && activeJob.jobId) {
          fetch(`/api/trim/cancel/${activeJob.jobId}`, { method: 'POST' }).catch(() => {});
        }
      } else {
        setStatus(`Error: ${err.message}`, 'error');
      }
    } finally {
      cutSaveBtn.classList.remove('hidden');
      cancelBtn.classList.add('hidden');
      progressWrap.classList.add('hidden');
      activeJob = null;
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (activeJob) activeJob.controller.abort();
  });
})();
