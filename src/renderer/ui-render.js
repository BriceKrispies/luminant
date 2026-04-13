/**
 * In-canvas HUD rendering.
 * Draws HP bar, XP bar, level, kill count, timer, and wave info on the canvas.
 */

export function drawHUD(ctx, width, height, state) {
  if (!state || !state.playing) return;

  const pad = 16;
  const barH = 8;
  const barY = height - pad - barH;
  const barW = 180;

  // HP bar
  const hpRatio = Math.max(0, Math.min(1, state.hp / state.maxHp));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(pad, barY, barW, barH);
  ctx.fillStyle = hpRatio > 0.3 ? '#e44' : '#f22';
  ctx.fillRect(pad, barY, barW * hpRatio, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(pad, barY, barW, barH);

  // HP text
  ctx.fillStyle = '#ccc';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`HP ${Math.ceil(state.hp)}/${Math.ceil(state.maxHp)}`, pad, barY - 4);

  // XP bar
  const xpX = pad + barW + 20;
  const xpW = 250;
  const xpRatio = state.xpToNext > 0 ? Math.min(1, state.xp / state.xpToNext) : 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(xpX, barY, xpW, barH);
  ctx.fillStyle = '#4af';
  ctx.fillRect(xpX, barY, xpW * xpRatio, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(xpX, barY, xpW, barH);

  // Level
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(`LV ${state.level}`, xpX, barY - 4);

  // Kill count
  ctx.fillStyle = '#888';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`Kills: ${state.kills}`, width - pad, barY + barH - 1);

  // Wave
  ctx.fillText(`Wave ${state.wave + 1}`, width - pad, barY - 4);

  // Timer
  const mins = Math.floor(state.time / 60);
  const secs = Math.floor(state.time % 60).toString().padStart(2, '0');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aaa';
  ctx.font = '12px monospace';
  ctx.fillText(`${mins}:${secs}`, width / 2, pad + 12);

  // Weapon name
  ctx.fillStyle = '#668';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(state.weaponName || '', pad, barY - 18);
}
