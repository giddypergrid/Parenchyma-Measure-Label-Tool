# Parenchyma Measure

**Open it at
[giddypergrid.github.io/Parenchyma-Measure-Label-Tool](https://giddypergrid.github.io/Parenchyma-Measure-Label-Tool/)**

A browser tool for measuring mammary parenchyma from ultrasound scans of dairy heifer calves. Built
for the mammary gland development research of A/Prof Racheal Bryant at Lincoln University, and in
weekly use by her group.

Load a scan, draw around the tissue, and it returns area, width and depth in millimetres and exports
a CSV. It replaced a manual MATLAB workflow where each measurement was traced and converted by hand.

```
  ultrasound clip (.avi)          ┌──────────────────────────┐
  or still images         ──────► │  pick a clear frame      │
                                  │  draw the outline        │  ◄── the operator does this
                                  └────────────┬─────────────┘
                                               │  pixels
                                               ▼
                                  ┌──────────────────────────┐
                                  │  scale: 308 px/cm        │
                                  │  area · width · depth    │
                                  └────────────┬─────────────┘
                                               ▼
                                    area_mm2, width_mm, depth_mm  →  CSV
```

## Decisions

**It runs entirely in the browser.** It began as an Electron desktop app, which meant Racheal and
Kate had to install something, and every fix meant sending them a new `.exe`. It now runs from
GitHub Pages, so a link is the whole install and an update reaches them on refresh. No file leaves
their machine.

**Frame choice and outlining stay manual.** The tissue boundary in an ultrasound is ambiguous, and
the researchers are the ones qualified to judge where it sits. The tool handles scaling,
arithmetic and record keeping. Every outline is stored, so the accumulated set can train a
segmentation model later.

**Scale is a project default with a per-image override, and it is written to every CSV row.** The
Philips Lumify exports at 308 px/cm, which is a property of the 1280x720 export rather than the
scanner, so a clip captured differently needs a different number. Writing the effective scale into
each row means an override is never hidden from whoever reads the CSV afterwards.

**Quarter numbering follows the group's own convention**, confirmed with Kate in August 2026:
1 = left front, 2 = left rear, 3 = right rear, 4 = right front. Same pattern as scale, a project
default with a per-image override.

## CSV output

```
calf_id, quarter, timepoint, date, diet, clip, frame, area_mm2, width_mm, depth_mm, scale_px_per_cm
```

## Where to look

| File | Why |
|---|---|
| [`src/measure.ts`](src/measure.ts) | Area, width and depth from the outline. Self-intersection check and scale resolution live here. |
| [`src/screens/MeasureView.tsx`](src/screens/MeasureView.tsx) | The drawing canvas, Konva, and the capture flow |
| [`src/screens/Timepoints.tsx`](src/screens/Timepoints.tsx) | How a study is organised: project, timepoint, clip, capture |

A project is one folder and every path inside `project.json` is relative, so it can be copied to a
USB stick or opened on another machine and still resolve.

---

React 19, TypeScript, Vite, Konva for the canvas, Zustand for state. Deployed to GitHub Pages from
`docs/`.
