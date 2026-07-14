# Changelog

## Unreleased

### Added
- Initial version of the MP4 Trimmer app.
- Drag-and-drop video loading with instant client-side preview (no upload needed to preview).
- Dual-handle scrubber with synced numeric time fields (HH:MM:SS.mmm) and "set to playhead" buttons.
- Preview-selection playback loop (plays from start, auto-pauses at end).
- Fast (stream-copy) and Accurate (re-encode) trim modes.
- Cut & Save flow using the File System Access API's native save dialog — trimmed output streams directly to the chosen destination; the original file is never opened for writing.
- Express backend that spawns ffmpeg, with per-request temp file cleanup and error surfacing.
- Server now auto-opens the app in the default browser on startup instead of requiring a manual click.
- Live progress bar during Cut & Save, driven by ffmpeg's `-progress` output.
- Cancel button to abort an in-progress Cut & Save: kills the ffmpeg job (including package-manager shim wrappers, via a full process-tree kill) and deletes the incomplete output file.

### Fixed
- Canceling during the upload phase (before trimming even starts) no longer leaves a 0-byte temp file behind in `server/tmp/`.
- The client now generates the trim job ID upfront so Cancel can still reach the server even if it's clicked while the `/api/trim/start` request itself is in flight.
