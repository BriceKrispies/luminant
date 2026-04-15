/**
 * Skin / variant system.
 *
 * Separates skeleton definition, attachment sets, animation sets,
 * and procedural secondary profiles so multiple characters can share
 * a common base runtime shape while varying in look and motion identity.
 *
 * A skin definition contains:
 *   - skeletonId — which skeleton to use
 *   - palette — color overrides
 *   - slotOverrides — attachment replacements per slot
 *   - clipOverrides — clip replacements
 *   - secondaryProfile — which secondary motion module to use
 *   - expressionProfile — which expression config to use
 *   - variation — per-entity variation ranges (hue, scale, etc.)
 */

/**
 * @typedef {Object} SkinDef
 * @property {string} id
 * @property {string} name
 * @property {string} skeletonId
 * @property {Object} palette — { base, highlight, glow, eye, interior }
 * @property {Object} [slotOverrides] — { slotName: AttachmentDef[] }
 * @property {Object} [clipOverrides] — { clipName: Clip }
 * @property {string} [secondaryId] — secondary motion profile ID
 * @property {string} [expressionId] — expression profile ID
 * @property {Object} [variation] — per-entity variation ranges
 */

/**
 * Resolve a skin definition into a concrete runtime configuration.
 * Merges base archetype defaults with skin-specific overrides.
 *
 * @param {Object} archetype — base archetype definition
 * @param {SkinDef} skin — skin to resolve
 * @returns {Object} resolved config with palette, slots, clips, profiles
 */
export function resolveSkin(archetype, skin) {
  // Palette: skin overrides archetype
  const palette = skin.palette
    ? { ...archetype.palette, ...skin.palette }
    : { ...archetype.palette };

  // Slot overrides: merge skin slots over archetype defaults
  const slotOverrides = skin.slotOverrides || null;

  // Clip overrides: merge
  const clipOverrides = skin.clipOverrides || null;

  // Secondary and expression profile IDs
  const secondaryId = skin.secondaryId || archetype.secondaryId || archetype.id;
  const expressionId = skin.expressionId || archetype.expressionId || archetype.id;

  // Variation: merge ranges
  const variation = skin.variation
    ? { ...archetype.variation, ...skin.variation }
    : { ...archetype.variation };

  return {
    skinId: skin.id,
    archetypeId: archetype.id,
    skeletonId: skin.skeletonId || archetype.skeletonId || archetype.id,
    palette,
    slotOverrides,
    clipOverrides,
    secondaryId,
    expressionId,
    variation,
  };
}

/**
 * Registry for skin definitions.
 * Allows lookup by entity type or archetype + variant.
 */
const skinRegistry = new Map();

export function registerSkin(id, skinDef) {
  skinRegistry.set(id, skinDef);
}

export function getSkin(id) {
  return skinRegistry.get(id) || null;
}

export function listSkins() {
  return Array.from(skinRegistry.keys());
}

/**
 * Default skin factory — creates a default skin from an archetype.
 * Used when no custom skin is specified.
 */
export function createDefaultSkin(archetype) {
  return {
    id: `${archetype.id}_default`,
    name: `${archetype.name} Default`,
    skeletonId: archetype.id,
    palette: archetype.palette,
    slotOverrides: null,
    clipOverrides: null,
    secondaryId: archetype.id,
    expressionId: archetype.id,
    variation: archetype.variation,
  };
}
