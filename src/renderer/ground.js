/**
 * Ground layer — subtle dark terrain with noise-like texture.
 */

let noiseCanvas = null;
let noiseCtx = null;

function ensureNoiseTexture() {
  if (noiseCanvas) return;
  if (typeof document === 'undefined') return;
  noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = 256;
  noiseCanvas.height = 256;
  noiseCtx = noiseCanvas.getContext('2d');

  const imageData = noiseCtx.createImageData(256, 256);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 15 + 8;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v + 2;
    data[i + 3] = 255;
  }
  noiseCtx.putImageData(imageData, 0, 0);
}

export function drawGround(ctx, view, camera) {
  ensureNoiseTexture();

  // Tile the noise texture across the visible area
  const tileSize = 256;
  const startX = Math.floor(view.left / tileSize) * tileSize;
  const startY = Math.floor(view.top / tileSize) * tileSize;

  if (noiseCanvas) {
    ctx.globalAlpha = 0.6;
    for (let x = startX; x < view.right + tileSize; x += tileSize) {
      for (let y = startY; y < view.bottom + tileSize; y += tileSize) {
        ctx.drawImage(noiseCanvas, x, y, tileSize, tileSize);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
  ctx.lineWidth = 1;
  const gridSize = 128;
  const gridStartX = Math.floor(view.left / gridSize) * gridSize;
  const gridStartY = Math.floor(view.top / gridSize) * gridSize;
  ctx.beginPath();
  for (let x = gridStartX; x < view.right; x += gridSize) {
    ctx.moveTo(x, view.top);
    ctx.lineTo(x, view.bottom);
  }
  for (let y = gridStartY; y < view.bottom; y += gridSize) {
    ctx.moveTo(view.left, y);
    ctx.lineTo(view.right, y);
  }
  ctx.stroke();
}
