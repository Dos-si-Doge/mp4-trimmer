const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const multer = require('multer');
const ffmpeg = require('./ffmpeg');

const PORT = process.env.PORT || 5173;
const TMP_DIR = path.join(__dirname, 'tmp');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const JOB_STALE_MS = 5 * 60 * 1000;
const JOB_SWEEP_INTERVAL_MS = 60 * 1000;

fs.mkdirSync(TMP_DIR, { recursive: true });

function safeUnlink(filePath, attemptsLeft = 10) {
  fs.unlink(filePath, (err) => {
    if (!err) return;
    if (err.code === 'ENOENT') return;
    if (attemptsLeft > 0) {
      // On Windows a just-killed process can hold the file handle briefly.
      setTimeout(() => safeUnlink(filePath, attemptsLeft - 1), 300);
    } else {
      console.error(`Failed to delete ${filePath}: ${err.code} ${err.message}`);
    }
  });
}

// ffmpeg on PATH may be a package-manager shim (e.g. Chocolatey) that spawns the
// real ffmpeg binary as its own child process. Killing just the direct child leaves
// that grandchild encoding in the background, so we kill the whole process tree.
function killProcessTree(proc, callback) {
  const done = callback || (() => {});
  if (!proc || proc.pid == null) {
    done();
    return;
  }
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${proc.pid} /T /F`, () => done());
  } else {
    try { proc.kill('SIGKILL'); } catch {}
    done();
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      const name = `${crypto.randomUUID()}-input${ext}`;
      // Recorded even though multer hasn't finished yet, so an aborted upload
      // (e.g. the user hits Cancel) can still find the partial file to delete.
      req.__uploadFilename = name;
      cb(null, name);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error('Only video files are supported'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
});

// Only files this server itself created via multer, matching this exact pattern, may be trimmed.
const FILE_ID_PATTERN = /^[0-9a-f-]{36}-input\.[a-zA-Z0-9]+$/;
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/;

// jobId -> { status, progress, error, inputPath, outputPath, process, canceled, updatedAt }
const jobs = new Map();

function sweepStaleJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    const isFinished = job.status === 'done' || job.status === 'error' || job.status === 'canceled';
    if (isFinished && now - job.updatedAt > JOB_STALE_MS) {
      safeUnlink(job.inputPath);
      safeUnlink(job.outputPath);
      jobs.delete(jobId);
    }
  }
}
setInterval(sweepStaleJobs, JOB_SWEEP_INTERVAL_MS).unref();

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.warn(`Could not auto-open browser: ${err.message}`);
  });
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.post('/api/upload', (req, res) => {
  // Fires when the connection is torn down. If we never got to send a response
  // (writableEnded still false), the client disconnected early (e.g. hit Cancel)
  // partway through — multer creates the destination file as soon as it starts
  // parsing the part, so that can otherwise leave a 0-byte file behind.
  res.on('close', () => {
    if (res.writableEnded) return;
    if (req.__uploadFilename) safeUnlink(path.join(TMP_DIR, req.__uploadFilename));
  });

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (req.__uploadFilename) safeUnlink(path.join(TMP_DIR, req.__uploadFilename));
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    res.json({ fileId: req.file.filename });
  });
});

app.post('/api/trim/start', (req, res) => {
  const { fileId, start, end, mode, jobId } = req.body || {};

  if (typeof fileId !== 'string' || !FILE_ID_PATTERN.test(fileId)) {
    res.status(400).json({ error: 'Invalid fileId' });
    return;
  }
  const inputPath = path.join(TMP_DIR, fileId);
  if (!fs.existsSync(inputPath)) {
    res.status(404).json({ error: 'Uploaded file not found (it may have already been processed)' });
    return;
  }

  const startSec = Number(start);
  const endSec = Number(end);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
    res.status(400).json({ error: 'Invalid start/end time range' });
    return;
  }
  const trimMode = mode === 'accurate' ? 'accurate' : 'fast';

  // The client generates the jobId (rather than the server) so it can still cancel
  // a job it never got a response for, e.g. if it aborts while this request is in flight.
  if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId) || jobs.has(jobId)) {
    res.status(400).json({ error: 'Invalid jobId' });
    return;
  }
  const outputPath = path.join(TMP_DIR, `${jobId}-output.mp4`);

  const job = {
    status: 'running',
    progress: 0,
    error: null,
    inputPath,
    outputPath,
    process: null,
    canceled: false,
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);

  const { process: proc, promise } = ffmpeg.trim({
    inputPath,
    outputPath,
    start: startSec,
    end: endSec,
    mode: trimMode,
    onProgress: (fraction) => {
      job.progress = fraction;
      job.updatedAt = Date.now();
    },
  });
  job.process = proc;

  promise
    .then(() => {
      if (job.canceled) return;
      job.status = 'done';
      job.progress = 1;
      job.updatedAt = Date.now();
    })
    .catch((err) => {
      job.updatedAt = Date.now();
      if (job.canceled) {
        job.status = 'canceled';
        return;
      }
      job.status = 'error';
      job.error = err.message;
      safeUnlink(inputPath);
      safeUnlink(outputPath);
    });

  res.json({ jobId });
});

app.get('/api/trim/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId' });
    return;
  }
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ status: job.status, progress: job.progress, error: job.error });
});

app.get('/api/trim/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId' });
    return;
  }
  const job = jobs.get(jobId);
  if (!job || job.status !== 'done') {
    res.status(404).json({ error: 'Job not ready' });
    return;
  }

  const cleanup = () => {
    safeUnlink(job.inputPath);
    safeUnlink(job.outputPath);
    jobs.delete(jobId);
  };

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="trimmed.mp4"');

  const readStream = fs.createReadStream(job.outputPath);
  readStream.on('error', () => {
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: 'Failed to read trimmed output' });
  });
  res.on('close', cleanup);
  readStream.pipe(res);
});

app.post('/api/trim/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId' });
    return;
  }
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const wasRunning = job.process && job.process.exitCode === null && job.process.signalCode === null;

  job.canceled = true;
  job.updatedAt = Date.now();
  job.status = 'canceled';

  const cleanup = () => {
    safeUnlink(job.inputPath);
    safeUnlink(job.outputPath);
    jobs.delete(jobId);
  };

  if (wasRunning) {
    killProcessTree(job.process, cleanup);
  } else {
    cleanup();
  }

  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`MP4 Trimmer running at ${url}`);
  openBrowser(url);
});
