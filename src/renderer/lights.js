/**
 * Dynamic light pool rendering.
 * Creates atmospheric colored light pools around the player and key locations.
 */

const AMBIENT_LIGHTS = [
  { ox: -300, oy: -200, radius: 250, color: [40, 80, 200], intensity: 0.15 },
  { ox: 400, oy: 100, radius: 200, color: [40, 200, 80], intensity: 0.12 },
  { ox: -100, oy: 350, radius: 180, color: [200, 120, 40], intensity: 0.1 },
  { ox: 200, oy: -350, radius: 220, color: [100, 40, 200], intensity: 0.08 },
];

export function drawLights(ctx, snapshot, camera, view) {
  if (!snapshot.player) return;

  const px = snapshot.player.x;
  const py = snapshot.player.y;
  const time = snapshot.time;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Player light — warm center glow
  drawRadialLight(ctx, px, py, 180, [255, 200, 120], 0.25);
  drawRadialLight(ctx, px, py, 80, [255, 230, 180], 0.15);

  // Ambient floating lights
  for (const light of AMBIENT_LIGHTS) {
    const wobbleX = Math.sin(time * 0.3 + light.ox) * 30;
    const wobbleY = Math.cos(time * 0.4 + light.oy) * 30;
    const lx = px + light.ox + wobbleX;
    const ly = py + light.oy + wobbleY;

    // Only draw if in view
    if (lx > view.left - light.radius && lx < view.right + light.radius &&
        ly > view.top - light.radius && ly < view.bottom + light.radius) {
      const pulse = 1 + Math.sin(time * 0.8 + light.ox * 0.01) * 0.15;
      drawRadialLight(ctx, lx, ly, light.radius * pulse, light.color, light.intensity);
    }
  }

  // Enemy cluster glow — subtle color where many enemies gather
  const enemyClusters = findClusters(snapshot.entities.filter(e => e.type >= 2 && e.type <= 9), 150);
  for (const cluster of enemyClusters) {
    if (cluster.count >= 5) {
      drawRadialLight(ctx, cluster.x, cluster.y, 100, [200, 60, 40], 0.04 * Math.min(cluster.count / 10, 1));
    }
  }

  ctx.restore();
}

function drawRadialLight(ctx, x, y, radius, [r, g, b], intensity) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${intensity})`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${intensity * 0.4})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function findClusters(entities, gridSize) {
  const cells = new Map();
  for (const e of entities) {
    const key = `${Math.floor(e.x / gridSize)},${Math.floor(e.y / gridSize)}`;
    if (!cells.has(key)) cells.set(key, { x: 0, y: 0, count: 0 });
    const c = cells.get(key);
    c.x += e.x;
    c.y += e.y;
    c.count++;
  }
  const clusters = [];
  for (const c of cells.values()) {
    c.x /= c.count;
    c.y /= c.count;
    clusters.push(c);
  }
  return clusters;
}
