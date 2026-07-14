const { spawn } = require('child_process');

function formatSeconds(seconds) {
  return seconds.toFixed(3);
}

function trim({ inputPath, outputPath, start, end, mode, onProgress }) {
  const startStr = formatSeconds(start);
  const endStr = formatSeconds(end);
  const totalDuration = Math.max(end - start, 0.001);

  const trimArgs = mode === 'accurate'
    ? [
        '-i', inputPath,
        '-ss', startStr,
        '-to', endStr,
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'medium',
        '-c:a', 'copy',
      ]
    : [
        '-ss', startStr,
        '-to', endStr,
        '-i', inputPath,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
      ];

  const args = ['-progress', 'pipe:1', '-nostats', ...trimArgs, '-y', outputPath];

  const proc = spawn('ffmpeg', args);
  let stderr = '';
  let stdoutBuf = '';

  proc.stdout.on('data', (chunk) => {
    if (!onProgress) return;
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      const m = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/);
      if (m) {
        const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress(Math.min(seconds / totalDuration, 1));
      } else if (line === 'progress=end') {
        onProgress(1);
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const promise = new Promise((resolve, reject) => {
    proc.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });

    proc.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`ffmpeg terminated (${signal})`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.trim().split('\n').slice(-15).join('\n');
        reject(new Error(tail || `ffmpeg exited with code ${code}`));
      }
    });
  });

  return { process: proc, promise };
}

module.exports = { trim };
