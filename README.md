# Parenchyma Measure

Desktop tool for measuring mammary parenchyma from ultrasound video of dairy heifer calves.

An ultrasound clip is split into still images; the operator picks a clear frame, draws the
tissue outline, and the tool computes **area, width and depth in millimetres** and exports a CSV.
Frame choice and outlining stay manual — the tool handles scaling, measurement and
record-keeping, and stores every outline so a segmentation model can be trained later.

Built for the mammary gland development research of Racheal Bryant, Lincoln University,
New Zealand.

## Requirements

- Windows
- Node.js 20+

ffmpeg is bundled, so `.avi` clips from the scanner work without installing anything.

## Setup

```bash
npm install
npm run dev      # opens the app window, hot reloads on save
```

`npm run dev` opens its own desktop window. The `localhost:5173` browser tab is only the dev
server — file dialogs and video decoding do not work there.

## Build a Windows executable

```bash
npm run dist     # → release/  (installer + portable .exe)
```

## How a project is stored

One folder holds everything, and paths inside `project.json` are **relative**, so the folder
can be moved, copied to a USB stick, or opened on another machine:

```
<Project>/
  project.json            timepoints, captures, outlines, scale
  <Timepoint>/<clip>/     the video plus the stills extracted from it
  measurements.csv        exported measurements
```

## Workflow

1. Create or open a project.
2. Add a timepoint — any name (`Week 1`, `Aug 12 scan`); no fixed schedule.
3. Add a video: it is copied into the project, split into stills, and opens the measuring screen.
4. Drag the video to a clear frame → **Capture ▸** → draw the outline on the right.
5. **Save measurement** (it advances to the next unmeasured capture), then **Export CSV**.

## Scale

Measurements are millimetres, derived from pixels-per-centimetre read off the scanner's depth
ruler. Set the project default in **Settings**; override it on a single image if that clip used
a different depth. The effective scale is written to every CSV row, so an override is never
hidden.

Quarter (`LF` / `RF` / `LR` / `RR`) works the same way: a project default with a per-image
override.

## CSV output

```
calf_id, quarter, timepoint, date, diet, clip, frame, area_mm2, width_mm, depth_mm, scale_px_per_cm
```

## Layout

```
electron/     main process: window, ffmpeg, file dialogs, project read/write
src/screens/  Start · Timepoints · TimepointView · MeasureView
src/measure.ts  area/width/depth, self-intersection check, scale resolution
src/paths.ts    relative ↔ absolute path handling, filename sanitising
```
