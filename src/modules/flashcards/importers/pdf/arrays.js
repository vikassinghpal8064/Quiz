// Pure numeric helpers for the PDF importer.
//
// Everything here operates on plain typed arrays (luma samples, boolean masks)
// and has no DOM, canvas or pdf.js dependency, so the pairing, blank-page and
// "these two pages look unrelated" logic can be unit-tested in Node.
//
// The browser layer (imaging.js) is responsible for turning a rendered page
// into the luma array these functions consume.

// Average of a numeric array. Empty input is 0 rather than NaN.
export function mean(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

// Population standard deviation, optionally given the already-computed mean.
export function stddev(values, average) {
  if (!values || values.length === 0) return 0;
  const mu = average ?? mean(values);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - mu;
    sum += d * d;
  }
  return Math.sqrt(sum / values.length);
}

// mean / stddev / min / max for one luma sample per pixel.
export function imageStats(luma) {
  const n = luma?.length ?? 0;
  if (n === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  let sum = 0;
  let min = luma[0];
  let max = luma[0];
  for (let i = 0; i < n; i += 1) {
    const v = luma[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mu = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const d = luma[i] - mu;
    variance += d * d;
  }
  return { mean: mu, stddev: Math.sqrt(variance / n), min, max };
}

// A page is "blank" when it is almost uniform. A clean scanned page of text has
// a wide spread of luma; a blank white (or, for that matter, blank black) page
// has almost none. The stddev test catches both without caring about colour.
export const DEFAULT_BLANK_STDDEV = 7;

export function isBlankStats(stats, { stddev: maxStddev = DEFAULT_BLANK_STDDEV } = {}) {
  if (!stats) return false;
  return stats.stddev <= maxStddev;
}

// Fraction of pixels whose luma differs by more than `threshold`. Used for both
// the Mode D "matched pairs look identical" warning and the Mode E page diff.
export function differingFraction(a, b, { threshold = 40 } = {}) {
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  if (n === 0) return 0;
  let diff = 0;
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(a[i] - b[i]) > threshold) diff += 1;
  }
  return diff / n;
}

// 1 = identical, 0 = completely different. The Mode D pairing warning fires
// when two pages that are supposed to be the same card score below this.
export function similarity(a, b, opts) {
  return 1 - differingFraction(a, b, opts);
}

export const DEFAULT_PAIR_SIMILARITY = 0.6;

export function looksUnrelated(score, { min = DEFAULT_PAIR_SIMILARITY } = {}) {
  return score < min;
}

// Build a boolean mask (1 = changed) from two same-length luma arrays.
export function diffMask(a, b, { threshold = 40 } = {}) {
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    mask[i] = Math.abs(a[i] - b[i]) > threshold ? 1 : 0;
  }
  return mask;
}

// Separable morphological dilation by `radius` pixels. Runs in two linear
// passes (horizontal, then vertical) using a sliding window, so a 1000x1500
// mask with radius 8 stays well under a few million operations - unlike the
// naive r^2 neighbourhood scan.
export function dilate(mask, width, height, radius = 0) {
  if (radius <= 0) return mask;
  const r = Math.min(radius, Math.max(width, height));
  const horizontal = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let acc = 0;
    for (let x = 0; x <= r && x < width; x += 1) acc += mask[row + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = acc > 0 ? 1 : 0;
      const add = x + r + 1;
      const drop = x - r;
      if (add < width) acc += mask[row + add];
      if (drop >= 0) acc -= mask[row + drop];
    }
  }

  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let acc = 0;
    for (let y = 0; y <= r && y < height; y += 1) acc += horizontal[y * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = acc > 0 ? 1 : 0;
      const add = y + r + 1;
      const drop = y - r;
      if (add < height) acc += horizontal[add * width + x];
      if (drop >= 0) acc -= horizontal[drop * width + x];
    }
  }

  return out;
}

// The four highlighter colours the importer looks for, with the swatch the UI
// shows. Ordered warm-to-cool so the picker reads naturally.
export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "Yellow", swatch: "#fde047" },
  { id: "orange", label: "Orange", swatch: "#fb923c" },
  { id: "green", label: "Green", swatch: "#4ade80" },
  { id: "pink", label: "Pink", swatch: "#f472b6" },
];

// Classify one pixel as a highlighter colour, or null. Tuned for translucent
// marker over white paper: the channel that survives is much stronger than the
// others, so the tests are expressed as channel differences rather than absolute
// values (a faint yellow is still yellow).
export function highlightColorFor(r, g, b) {
  if (r >= 200 && g >= 185 && r + g - 2 * b >= 80 && b <= 180) return "yellow";
  if (r >= 205 && g >= 110 && g <= 195 && b <= 140 && r - g >= 40) return "orange";
  if (g >= 180 && g - r >= 25 && g - b >= 25) return "green";
  if (r >= 195 && b >= 140 && r - g >= 35 && b - g >= 10) return "pink";
  return null;
}

// Build a mask (1 = highlighted) from raw RGBA data, keeping only the enabled
// colours. `colors` is a Set/array of colour ids.
export function highlightMask(rgba, colors) {
  const enabled = colors instanceof Set ? colors : new Set(colors ?? []);
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    const color = highlightColorFor(rgba[i], rgba[i + 1], rgba[i + 2]);
    mask[p] = color && enabled.has(color) ? 1 : 0;
  }
  return mask;
}

// Merge bounding boxes that overlap or sit within `gap` pixels of each other.
// A highlighter drawn across three lines of text arrives as three thin bands;
// this fuses them into the one block the reader sees.
export function mergeBoxes(boxes, { gap = 8 } = {}) {
  const list = boxes.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (!nearBox(list[i], list[j], gap)) continue;
        const a = list[i];
        const b = list[j];
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.width, b.x + b.width);
        const bottom = Math.max(a.y + a.height, b.y + b.height);
        list[i] = { x, y, width: right - x, height: bottom - y, area: (a.area ?? 0) + (b.area ?? 0) };
        list.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  list.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return list;
}

function nearBox(a, b, gap) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const separatedX = bx2 + gap < a.x || ax2 + gap < b.x;
  const separatedY = by2 + gap < a.y || ay2 + gap < b.y;
  return !separatedX && !separatedY;
}

// Connected-component labelling (4-connected) over a boolean mask, returning a
// bounding box and pixel count per region. Regions smaller than `minArea` are
// dropped. Uses an explicit stack so a large blob cannot blow the JS call stack.
export function labelRegions(mask, width, height, { minArea = 1, dilate: radius = 0 } = {}) {
  const work = radius > 0 ? dilate(mask, width, height, radius) : mask;
  const seen = new Uint8Array(width * height);
  const regions = [];
  const stack = [];

  for (let start = 0; start < work.length; start += 1) {
    if (!work[start] || seen[start]) continue;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const n = idx - 1;
        if (work[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (work[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - width;
        if (work[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (work[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }

    if (area >= minArea) {
      regions.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
    }
  }

  // Reading order: top to bottom, then left to right.
  regions.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return regions;
}
