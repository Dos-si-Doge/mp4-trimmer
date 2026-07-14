# MP4 Trimmer

A local, browser-based GUI for trimming/cutting MP4 (and other video) files using ffmpeg. Drag in a video, scrub to set start/end, and save the trimmed clip to a location you choose — the original file is never modified.

## Running it

```
npm install
npm start
```

Opens a server at `http://localhost:5173` and auto-opens it in your default browser. Use **Chrome or Edge** (the save flow depends on the File System Access API, which Firefox/Safari don't support — the UI shows a notice and disables saving if unsupported).

## Architecture

- **Backend** (`server/`): Express app. Serves `public/` statically and exposes:
  - `POST /api/upload` — accepts a multipart file upload (via `multer`), stores it in `server/tmp/`, returns a `fileId`. If the client disconnects before a response is sent (`res.writableEnded` still false when `res`'s `close` fires), the partially-written file is deleted.
  - `POST /api/trim/start` — given `{ fileId, start, end, mode, jobId }`, starts an ffmpeg job (`server/ffmpeg.js`) in the background and returns `{ jobId }`. The `jobId` is generated **client-side** (not by the server) so the client can always call `/api/trim/cancel/:jobId` even if this request itself gets aborted before a response arrives. The job is tracked in an in-memory `jobs` Map (progress, status, the child process handle, file paths).
  - `GET /api/trim/progress/:jobId` — polled by the client (every 300ms) for `{ status, progress, error }`. Progress comes from parsing ffmpeg's `-progress pipe:1` machine-readable output (`out_time=` lines) against the selected duration.
  - `GET /api/trim/download/:jobId` — streams the finished output once `status === 'done'`. Deletes both the uploaded original and the generated output from `server/tmp/` when the response closes (success, error, or client abort).
  - `POST /api/trim/cancel/:jobId` — kills the ffmpeg job and deletes its (incomplete) input/output files.
  - A periodic sweep (every minute) deletes files for any job that finished but was never downloaded within 5 minutes, in case a client disconnects mid-flow.
  - On startup, opens the app URL in the OS default browser (`start`/`open`/`xdg-open` depending on platform).
  - Requires `ffmpeg` to be on `PATH`.
- **Frontend** (`public/`): plain HTML/CSS/JS, no framework or build step.
  - Video preview/scrubbing happens entirely client-side via `URL.createObjectURL()` on the dropped `File` — no upload needed just to preview.
  - The file is only uploaded to the server when the user clicks **Cut & Save**.
  - Saving uses `window.showSaveFilePicker()` to get a destination handle *before* any network activity (required — it must be called synchronously from the user gesture), then drives `/api/trim/start` → polls `/api/trim/progress` (updating the progress bar) → fetches `/api/trim/download` and pipes it into the file handle (`response.body.pipeTo(writable, { signal })`).
  - A single `AbortController` per Cut & Save operation is passed as `signal` to every fetch/pipe call. Clicking **Cancel** aborts it (which also calls `/api/trim/cancel`); because the destination file is written via `pipeTo`'s writable stream, an abort discards the in-progress write instead of leaving a partial file at the user-chosen path.

## Trim modes

- **Fast (copy)** — `ffmpeg -ss <start> -to <end> -i in -c copy`. Near-instant, no re-encoding, but the cut may snap to the nearest keyframe (off by up to a couple seconds depending on the source's keyframe interval).
- **Accurate (re-encode)** — `ffmpeg -i in -ss <start> -to <end> -c:v libx264 -crf 18 -preset medium -c:a copy`. Frame-accurate but slower.

## Notes for future changes

- `server/tmp/` is gitignored and created at server startup; it should always end up empty shortly after any job finishes, errors, or is canceled.
- **Killing ffmpeg must kill the whole process tree, not just the direct child.** On this machine `ffmpeg` on `PATH` resolves to a Chocolatey shim (a small stub .exe that spawns the real ffmpeg binary as its own child process). Calling `.kill()` on the direct child only kills the shim — the real encoder keeps running in the background and finishes the job anyway, silently defeating cancellation. `killProcessTree()` in `server/index.js` uses `taskkill /pid <pid> /T /F` on Windows to kill the whole tree; if you change how ffmpeg is invoked, re-verify cancellation actually stops encoding (check `tasklist`/output file size mid-cancel), not just that the API call returns.
- **Detecting "client disconnected before we responded" must use `res.on('close')` + `res.writableEnded`, not `req.on('close')`.** `req`'s `close` event fires once the request body has been fully *received*, which on a large upload happens well before multer finishes writing it to disk and calling back — using it to gate cleanup deletes files from perfectly successful uploads. `res`'s `close` only fires once the exchange is fully torn down, and `res.writableEnded` tells you whether a response was actually sent, which is the correct signal for "this was a genuine abort."
- The dual-handle range slider is two overlapping `<input type="range">` elements with transparent tracks — see `.range` rules in `public/style.css` for the pointer-events trick that lets both thumbs stay independently draggable.
- No automated tests exist yet; changes should be verified manually by running the app and exercising drag-and-drop, scrubbing, both trim modes, the save flow, and cancellation (with a large/slow file so there's actually time to click Cancel) in a real Chromium browser.
