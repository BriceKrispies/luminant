/**
 * Debug overlay — shows FPS, entity count, subsystem timings, enemy counts.
 * Renders into a DOM element for crispness.
 */

export function createDebugOverlay(element) {
  let visible = false;
  let data = {};

  return {
    get visible() { return visible; },

    toggle() {
      visible = !visible;
      element.classList.toggle('hidden', !visible);
    },

    update(info) {
      data = info;
      if (!visible) return;

      const lines = [
        `FPS: ${data.fps || 0}`,
        `Entities: ${data.activeEntities || 0}`,
        `  Enemies: ${data.enemyCount || 0}`,
        `  Projectiles: ${data.projectileCount || 0}`,
        `  Pickups: ${data.pickupCount || 0}`,
        ``,
        `Sim step:   ${fmt(data.stepMs)} ms`,
        `  Grid:     ${fmt(data.gridMs)} ms`,
        `  Player:   ${fmt(data.playerMs)} ms`,
        `  Enemies:  ${fmt(data.enemiesMs)} ms`,
        `  Projs:    ${fmt(data.projMs)} ms`,
        `  Collide:  ${fmt(data.collisionMs)} ms`,
        `  Deaths:   ${fmt(data.deathsMs)} ms`,
        `Render:     ${fmt(data.renderMs)} ms`,
        ``,
        `Col checks: ${data.collisionChecks || 0}`,
        `Dmg events: ${data.damageEvents || 0}`,
        `Kills/frame: ${data.killsThisFrame || 0}`,
        ``,
        `Level: ${data.level || 1}`,
        `Wave: ${(data.wave || 0) + 1}`,
        `Total kills: ${data.totalKills || 0}`,
        `Time: ${(data.time || 0).toFixed(1)}s`,
      ];

      // Mode + policy info
      if (data.mode) {
        lines.push('');
        lines.push(`Mode: ${data.mode}`);
        if (data.mode === 'auto' && data.policyName) {
          lines.push(`Policy: ${data.policyName}`);
        }
        if (data.autoAction && data.mode === 'auto') {
          const a = data.autoAction;
          lines.push(`Action: dx=${(a.dx||0).toFixed(2)} dy=${(a.dy||0).toFixed(2)} atk=${a.attack?'Y':'N'}`);
        }
      }

      element.textContent = lines.join('\n');
    },
  };
}

function fmt(ms) {
  if (ms == null) return '---';
  return ms.toFixed(2);
}
