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

      // Renderer info
      if (data.renderer) {
        lines.push(`Renderer: ${data.renderer}`);
      }

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

        // Utility AI debug info
        const ai = data.aiDebug;
        if (ai) {
          lines.push('');
          lines.push(`Intent: ${ai.intention}`);
          lines.push(`Danger: ${(ai.danger||0).toFixed(2)}  Encircle: ${(ai.encirclement||0).toFixed(2)}`);
          lines.push(`PrefRange: ${(ai.preferredRange||0).toFixed(0)}`);
          if (ai.intentionScores) {
            const sorted = Object.entries(ai.intentionScores)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4);
            lines.push(`Scores: ${sorted.map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' ')}`);
          }
          if (ai.topCandidates && ai.topCandidates.length > 0) {
            const labels = ai.topCandidates.map(c => {
              const tag = c.label || dirLabel(c.dirIndex);
              return `${tag}(${c.score.toFixed(1)})`;
            });
            lines.push(`Candidates: ${labels.join(' ')}`);
          }
        }
      }

      element.textContent = lines.join('\n');
    },
  };
}

const DIR_LABELS = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW'];
function dirLabel(idx) {
  if (idx >= 0 && idx < 8) return DIR_LABELS[idx];
  if (idx === -1) return 'hold';
  if (idx === -2) return 'orb+';
  if (idx === -3) return 'orb-';
  return '?';
}

function fmt(ms) {
  if (ms == null) return '---';
  return ms.toFixed(2);
}
