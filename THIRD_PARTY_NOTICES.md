# Third-Party Notices

This project vendors a small amount of reference data adapted from other
open-source projects. Their original licenses are reproduced below, as
required by those licenses' terms.

## ZwiftInsider

`shared/data/frameSpeedData.ts` and `shared/data/wheelSpeedData.ts` reproduce
per-frame and per-wheel flat/climb speed-test figures (seconds gained/lost
per hour vs. a baseline bike, at Stage 0 and Stage 5 upgrade) published by
[ZwiftInsider](https://zwiftinsider.com/) at
[zwiftinsider.com/charts-frames](https://zwiftinsider.com/charts-frames/),
[/charts-tt](https://zwiftinsider.com/charts-tt/), and
[/charts-wheels](https://zwiftinsider.com/charts-wheels/), sourced from their
public results spreadsheet. The rolling-resistance (Crr) constants in
`shared/utils/classifyWheel.ts` are likewise taken from ZwiftInsider's
published Crr-by-surface table at
[zwiftinsider.com/crr](https://zwiftinsider.com/crr/). This data is not
released under a specific open-source license; it's reproduced here with
attribution as ZwiftInsider's own bot-test results, publicly shared by them
for exactly this kind of community use. No ZwiftInsider code is used - only
the numeric test results.

## zwift-data

This project depends on the [zwift-data](https://github.com/andipaetzold/zwift-data)
npm package for structured reference data on Zwift worlds, routes, segments,
and bike frames (used throughout `shared/utils/` and `shared/data/`, e.g.
`catalog.ts`, `routeClimbs.ts`, and `routeSegments.ts`). It is used as-is at
runtime rather than vendored/copied, but its MIT license is reproduced below
per its terms.

```
MIT License

Copyright (c) 2021 Andi Pätzold

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## zwiftmap

`shared/data/zwiftmapSurfaceZones.ts`, `shared/data/surfaceCrr.ts`, and
`shared/data/zwiftmapSurfacePolygons.json`/`.ts` contain reference data
adapted from the hand-mapped `worldConfigs` surface data and CRR table in
[zwiftmap](https://github.com/andipaetzold/zwiftmap). This includes the full
per-world surface polygon coordinates (`zwiftmapSurfacePolygons.json`,
extracted via `scripts/route-surfaces/extract-surface-polygons.mjs`), used by
`shared/utils/surfaceGeometry.ts` to compute real per-route surface
composition from each route's GPS trace - the same point-in-polygon
classification method zwiftmap's own `frontend/src/util/surface.ts` uses,
reimplemented here rather than copied. zwiftmap's route-matching/road-graph
code is not copied.

```
MIT License

Copyright (c) 2021 Andi Pätzold

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
