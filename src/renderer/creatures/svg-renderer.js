/**
 * SVG path renderer for creature shapes.
 *
 * Executes pre-parsed SVG path data on a Canvas 2D context,
 * mapping color roles to the creature's archetype palette.
 *
 * Path data format: Float32Array of [op, ...coords]
 *   op 0 = moveTo(x, y)
 *   op 1 = lineTo(x, y)
 *   op 2 = bezierCurveTo(x1, y1, x2, y2, x, y)
 *   op 3 = quadraticCurveTo(x1, y1, x, y)
 *   op 4 = closePath()
 */

/**
 * Execute a single path's data on a canvas context.
 */
function tracePath(ctx, data) {
  let i = 0;
  ctx.beginPath();
  while (i < data.length) {
    const op = data[i];
    switch (op) {
      case 0: // moveTo
        ctx.moveTo(data[i + 1], data[i + 2]);
        i += 3;
        break;
      case 1: // lineTo
        ctx.lineTo(data[i + 1], data[i + 2]);
        i += 3;
        break;
      case 2: // bezierCurveTo
        ctx.bezierCurveTo(
          data[i + 1], data[i + 2],
          data[i + 3], data[i + 4],
          data[i + 5], data[i + 6],
        );
        i += 7;
        break;
      case 3: // quadraticCurveTo
        ctx.quadraticCurveTo(
          data[i + 1], data[i + 2],
          data[i + 3], data[i + 4],
        );
        i += 5;
        break;
      case 4: // closePath
        ctx.closePath();
        i += 1;
        break;
      default:
        i += 1; // skip unknown
        break;
    }
  }
}

/**
 * Map a path's role to a palette color.
 */
function roleToColor(role, pal, hueShift, alpha) {
  const a = alpha !== undefined ? alpha : 1;
  switch (role) {
    case 'highlight': return paletteCSS(pal.highlight, hueShift, a);
    case 'base': return paletteCSS(pal.base, hueShift, a);
    case 'mid': return paletteCSS(pal.base, hueShift, a * 0.85);
    case 'interior': return paletteCSS(pal.interior, hueShift, a);
    default: return paletteCSS(pal.base, hueShift, a);
  }
}

/**
 * Remap an original SVG fill color through the palette's tonal range.
 * Preserves the original luminance/contrast while applying the palette's hue.
 * This gives much richer results than the 4-level role classification.
 */
function remapColor(fill, pal, hueShift, alpha) {
  const a = alpha !== undefined ? alpha : 1;
  // Parse hex to luminance
  const h = fill.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;

  // Lerp between interior (dark) and highlight (light) based on luminance
  const t = Math.pow(lum, 0.8); // slight gamma for richer darks
  const dark = pal.interior;
  const light = pal.highlight;
  const mapped = [
    dark[0] + (light[0] - dark[0]) * t,
    dark[1] + (light[1] - dark[1]) * t,
    dark[2] + (light[2] - dark[2]) * t,
  ];

  return paletteCSS(mapped, hueShift, a);
}

const TAU = Math.PI * 2;

function paletteCSS(rgb, hueShift, alpha) {
  let [r, g, b] = rgb;
  if (hueShift) {
    const cos = Math.cos(hueShift * TAU);
    const sin = Math.sin(hueShift * TAU);
    const nr = r * (0.667 + cos * 0.333) + g * (0.333 - cos * 0.333 + sin * 0.577) + b * (0.333 - cos * 0.333 - sin * 0.577);
    const ng = r * (0.333 - cos * 0.333 - sin * 0.577) + g * (0.667 + cos * 0.333) + b * (0.333 - cos * 0.333 + sin * 0.577);
    const nb = r * (0.333 - cos * 0.333 + sin * 0.577) + g * (0.333 - cos * 0.333 - sin * 0.577) + b * (0.667 + cos * 0.333);
    r = Math.max(0, Math.min(1, nr));
    g = Math.max(0, Math.min(1, ng));
    b = Math.max(0, Math.min(1, nb));
  }
  const ri = r * 255 | 0;
  const gi = g * 255 | 0;
  const bi = b * 255 | 0;
  if (alpha >= 1) return `rgb(${ri},${gi},${bi})`;
  return `rgba(${ri},${gi},${bi},${alpha.toFixed(3)})`;
}

/**
 * Draw a complete SVG-based creature shape.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} paths - Array of { data, role, fill } from shape module
 * @param {Object} pal - Archetype palette
 * @param {number} hueShift - Variation hue shift
 * @param {number} alpha - Global opacity
 * @param {boolean} useOriginalColors - If true, use SVG fill colors instead of palette mapping
 */
/**
 * Color modes:
 *   'remap'   — luminance-based remap through palette (default, best quality)
 *   'role'    — 4-level role classification (simpler, less contrast)
 *   'original' — raw SVG colors (no palette influence)
 */
export function drawSVGShape(ctx, paths, pal, hueShift, alpha, colorMode) {
  const a = alpha !== undefined ? alpha : 1;
  const mode = colorMode || 'remap';

  for (const path of paths) {
    tracePath(ctx, path.data);

    if (mode === 'original') {
      ctx.fillStyle = path.fill;
    } else if (mode === 'role') {
      ctx.fillStyle = roleToColor(path.role, pal, hueShift, a);
    } else {
      // 'remap' — luminance-based palette mapping
      ctx.fillStyle = remapColor(path.fill, pal, hueShift, a);
    }

    ctx.fill();
  }
}
