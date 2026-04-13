/**
 * Fog overlay — screen-space vignette that creates moody atmosphere.
 */

let fogGradientCache = null;
let fogCacheKey = '';

export function drawFog(ctx, width, height) {
  const key = `${width}x${height}`;
  if (key !== fogCacheKey) {
    fogGradientCache = null;
    fogCacheKey = key;
  }

  if (!fogGradientCache) {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.sqrt(cx * cx + cy * cy);
    fogGradientCache = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    fogGradientCache.addColorStop(0, 'rgba(5, 5, 10, 0)');
    fogGradientCache.addColorStop(0.5, 'rgba(5, 5, 10, 0.2)');
    fogGradientCache.addColorStop(0.75, 'rgba(5, 5, 10, 0.5)');
    fogGradientCache.addColorStop(1, 'rgba(5, 5, 10, 0.85)');
  }

  ctx.fillStyle = fogGradientCache;
  ctx.fillRect(0, 0, width, height);
}
