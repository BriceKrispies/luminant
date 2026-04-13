/**
 * Visual effects layer — hit impacts, death flashes, etc.
 * Lightweight particle-free effects using canvas drawing.
 */

const activeEffects = [];

export function addEffect(type, x, y, data = {}) {
  activeEffects.push({
    type,
    x, y,
    time: 0,
    duration: data.duration || 0.3,
    ...data,
  });
}

export function updateEffects(dt) {
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    activeEffects[i].time += dt;
    if (activeEffects[i].time >= activeEffects[i].duration) {
      activeEffects.splice(i, 1);
    }
  }
}

export function drawEffects(ctx, snapshot, camera) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const fx of activeEffects) {
    const t = fx.time / fx.duration;

    if (fx.type === 'hit') {
      const mag = Math.min((fx.magnitude || 10) / 10, 3);
      const r = 15 * mag * (1 - t);
      const alpha = Math.min(0.6 * mag, 1) * (1 - t);
      ctx.fillStyle = `rgba(255, 200, 80, ${alpha})`;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (fx.type === 'death') {
      const mag = Math.min((fx.magnitude || 1), 3);
      const r = 30 * mag * t;
      const alpha = 0.5 * mag * (1 - t);
      const grad = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      grad.addColorStop(0, `rgba(255, 100, 40, ${Math.min(alpha, 1)})`);
      grad.addColorStop(1, `rgba(255, 60, 20, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(fx.x - r, fx.y - r, r * 2, r * 2);
    }

    if (fx.type === 'levelup') {
      const r = 80 * t;
      const alpha = 0.4 * (1 - t);
      ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
      ctx.lineWidth = 3 * (1 - t);
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (fx.type === 'slash') {
      const alpha = 0.7 * (1 - t);
      const sweepT = Math.min(t * 3, 1); // fast sweep then fade
      const halfAngle = (fx.coneAngle || 1.0) / 2;
      const range = (fx.range || 70) * (0.6 + sweepT * 0.4);

      ctx.save();
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.angle);

      // Cone arc fill
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, range, -halfAngle, halfAngle);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 240, 200, ${alpha * 0.25})`;
      ctx.fill();

      // Bright leading edge arc
      const edgeAngle = -halfAngle + sweepT * halfAngle * 2;
      ctx.strokeStyle = `rgba(255, 255, 240, ${alpha})`;
      ctx.lineWidth = 3 * (1 - t);
      ctx.beginPath();
      ctx.arc(0, 0, range * 0.9, edgeAngle - 0.15, edgeAngle + 0.15);
      ctx.stroke();

      // Outer arc border
      ctx.strokeStyle = `rgba(255, 220, 160, ${alpha * 0.5})`;
      ctx.lineWidth = 2 * (1 - t);
      ctx.beginPath();
      ctx.arc(0, 0, range, -halfAngle, halfAngle);
      ctx.stroke();

      ctx.restore();
    }

    if (fx.type === 'pickup') {
      const yOff = -20 * t;
      const alpha = 1 - t;
      ctx.fillStyle = `rgba(100, 200, 255, ${alpha})`;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`+${fx.value || ''}`, fx.x, fx.y + yOff);
    }
  }

  ctx.restore();
}

export function clearEffects() {
  activeEffects.length = 0;
}
