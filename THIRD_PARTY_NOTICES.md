# Third-Party Notices

## LibreSprite flood-fill concept

The scanline flood-fill concept used in `src/editor/paint/pixelPaint.ts` was adapted from LibreSprite's `src/doc/algorithm/floodfill.cpp`.

That upstream source file explicitly states that it is released under the MIT License. The TypeScript implementation in this repository is a browser-oriented rewrite and does not include LibreSprite's C++ application framework, UI, document model, or other GPL-covered editor code.

Source project: LibreSprite/LibreSprite  
Source file: `src/doc/algorithm/floodfill.cpp`  
Upstream authorship notice: flood-fill routine by Shawn Hargreaves; changes by David Capello  
License for that source file: MIT License

The upstream file does not state a year or a formal copyright-holder line in its header. No missing copyright data is invented here. The following MIT permission and warranty notice is retained for this adapted component:

### MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
