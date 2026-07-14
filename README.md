# MP4 Trimmer

A local, browser-based GUI for trimming/cutting video files using ffmpeg. Drag in a video, scrub to set the start and end points with a live preview, and save the trimmed clip wherever you like — the original file is never modified.

## Features

- Drag-and-drop (or browse) to load a video, previewed instantly in the browser.
- Dual-handle scrubber synced with numeric `HH:MM:SS.mmm` time fields and "set to playhead" buttons.
- Loop playback of just the selected range to check your in/out points.
- Two trim modes:
  - **Fast (copy)** — near-instant, no re-encoding; the cut may snap to the nearest keyframe.
  - **Accurate (re-encode)** — frame-accurate cuts, slower.
- Saving uses your browser's native "Save As" dialog — you choose the destination and filename every time, so the source file can't be overwritten.
- Live progress bar while trimming, with a **Cancel** button that stops ffmpeg and deletes the incomplete output.

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [ffmpeg](https://ffmpeg.org/) available on your `PATH`
- Chrome or Edge — saving relies on the File System Access API, which Firefox and Safari don't support. The app will show a notice and disable saving if your browser is unsupported.

## Setup

```
npm install
npm start
```

This opens `http://localhost:5173` in your default browser automatically. If it doesn't, open that URL yourself in Chrome or Edge.

## Usage

1. Drag a video onto the drop zone (or click "browse").
2. Use the range slider or the Start/End time fields to pick your cut points. Click "Preview selection" to loop-play just that range.
3. Choose **Fast** or **Accurate** trim mode.
4. Click **Cut & Save…**, pick where to save the trimmed file in the dialog that appears, and watch the progress bar while it processes. Click **Cancel** at any point to stop and discard the incomplete output.

The original file stays untouched on disk throughout — trimming happens on a temporary server-side copy that's deleted once the save completes.

## Architecture

See [CLAUDE.md](CLAUDE.md) for details on how the frontend and backend fit together.

## License

MIT — see [LICENSE](LICENSE).
