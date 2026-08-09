# Third-Party Notices

This project vendors a small amount of reference data adapted from other
open-source projects. Their original licenses are reproduced below, as
required by those licenses' terms.

## zwiftmap

`shared/data/zwiftmapSurfaceZones.ts` and `shared/data/surfaceCrr.ts` contain
reference data adapted from the hand-mapped `worldConfigs` surface data and
CRR table in
[zwiftmap](https://github.com/andipaetzold/zwiftmap). Only the location
labels, coarse/detailed surface categories, and rolling-resistance values are
used; the underlying lat/lng polygon coordinates and route-geometry
computation code are not copied - see the notices in those files for details.

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
