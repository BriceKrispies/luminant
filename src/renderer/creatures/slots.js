/**
 * Slot and attachment system for creature rendering.
 *
 * A slot is a named position on a bone where attachments can be drawn.
 * Attachments are visual elements (shapes, features, accessories) that
 * are drawn at slot positions in a defined order.
 *
 * Supports:
 *   - Multiple attachments per slot
 *   - Explicit draw ordering
 *   - Visibility toggles
 *   - State/expression-based attachment swaps
 *   - Temporary overrides for attacks/effects
 *
 * The slot system is the bridge between skeleton poses and the draw layer.
 * It resolves "what to draw where" without containing drawing code.
 *
 * Extension seam: attachment definitions include a `deformable` flag and
 * optional `deformParams` for future deformable attachment support
 * (cloaks, tails, flames).
 */

/**
 * @typedef {Object} AttachmentDef
 * @property {string} type — draw type: 'shape', 'eye', 'feature', 'accent', 'weapon', 'fx'
 * @property {Object} params — type-specific draw parameters
 * @property {number} [drawOrder=0] — lower draws first
 * @property {boolean} [visible=true]
 * @property {boolean} [deformable=false] — extension seam for future deformable attachments
 * @property {Object} [deformParams] — params for deformation system (future)
 */

/**
 * @typedef {Object} SlotDef
 * @property {string} name — slot identifier
 * @property {string} bone — bone this slot is attached to
 * @property {number} [drawOrder=0] — slot-level draw order
 * @property {AttachmentDef[]} [attachments] — default attachments
 */

/**
 * Create a slot layout from definitions.
 * Returns a resolved set of slots with bone indices and draw-ordered attachment lists.
 *
 * @param {SlotDef[]} slotDefs
 * @param {Object} skeleton
 * @returns {Object} resolved slot layout
 */
export function createSlotLayout(slotDefs, skeleton) {
  const slots = [];
  const nameToIndex = {};

  for (let i = 0; i < slotDefs.length; i++) {
    const def = slotDefs[i];
    const boneIdx = skeleton.getBoneIndex(def.bone);

    nameToIndex[def.name] = i;
    slots.push({
      name: def.name,
      boneIndex: boneIdx,
      drawOrder: def.drawOrder || 0,
      attachments: (def.attachments || []).map(a => ({
        type: a.type,
        params: { ...a.params },
        drawOrder: a.drawOrder || 0,
        visible: a.visible !== false,
        deformable: a.deformable || false,
        deformParams: a.deformParams ? { ...a.deformParams } : null,
      })),
    });
  }

  // Pre-compute draw order
  const drawOrderedIndices = slots
    .map((_, i) => i)
    .sort((a, b) => slots[a].drawOrder - slots[b].drawOrder);

  return {
    slots,
    nameToIndex,
    drawOrderedIndices,

    getSlot(name) {
      const idx = nameToIndex[name];
      return idx !== undefined ? slots[idx] : null;
    },

    getSlotIndex(name) {
      const idx = nameToIndex[name];
      return idx !== undefined ? idx : -1;
    },
  };
}

/**
 * Resolve the active attachment set for a frame.
 * Applies skin overrides, expression swaps, and temporary overrides.
 *
 * @param {Object} slotLayout — base layout from createSlotLayout
 * @param {Object} [skinOverrides] — { slotName: AttachmentDef[] } from active skin
 * @param {Object} [expressionOverrides] — { slotName: AttachmentDef[] } from expression
 * @param {Object} [tempOverrides] — { slotName: { attachments, visible } } from one-shot effects
 * @returns {Object[]} resolved slots with final attachment lists
 */
export function resolveAttachments(slotLayout, skinOverrides, expressionOverrides, tempOverrides) {
  const resolved = [];

  for (const slotIdx of slotLayout.drawOrderedIndices) {
    const slot = slotLayout.slots[slotIdx];
    let attachments = slot.attachments;
    let visible = true;

    // Apply skin overrides (full replacement for slot)
    if (skinOverrides && skinOverrides[slot.name]) {
      attachments = skinOverrides[slot.name];
    }

    // Apply expression overrides (face slots typically)
    if (expressionOverrides && expressionOverrides[slot.name]) {
      attachments = expressionOverrides[slot.name];
    }

    // Apply temp overrides (attack smear, effect attachments)
    if (tempOverrides && tempOverrides[slot.name]) {
      const override = tempOverrides[slot.name];
      if (override.attachments) attachments = override.attachments;
      if (override.visible === false) visible = false;
    }

    // Filter by visibility
    const visibleAttachments = visible
      ? attachments.filter(a => a.visible !== false)
        .sort((a, b) => (a.drawOrder || 0) - (b.drawOrder || 0))
      : [];

    resolved.push({
      slotIndex: slotIdx,
      boneIndex: slot.boneIndex,
      name: slot.name,
      attachments: visibleAttachments,
    });
  }

  return resolved;
}

/**
 * Create an attachment definition.
 * Convenience builder for common attachment types.
 */
export const attachment = {
  shape(shape, params = {}) {
    return {
      type: 'shape',
      params: { shape, ...params },
      drawOrder: params.drawOrder || 0,
      visible: params.visible !== false,
      deformable: params.deformable || false,
      deformParams: params.deformParams || null,
    };
  },

  eye(style, params = {}) {
    return {
      type: 'eye',
      params: { style, ...params },
      drawOrder: params.drawOrder || 10,
      visible: params.visible !== false,
    };
  },

  feature(featureType, params = {}) {
    return {
      type: 'feature',
      params: { featureType, ...params },
      drawOrder: params.drawOrder || 5,
      visible: params.visible !== false,
    };
  },

  accent(accentType, params = {}) {
    return {
      type: 'accent',
      params: { accentType, ...params },
      drawOrder: params.drawOrder || -5,
      visible: params.visible !== false,
      deformable: params.deformable || false,
      deformParams: params.deformParams || null,
    };
  },

  fx(fxType, params = {}) {
    return {
      type: 'fx',
      params: { fxType, ...params },
      drawOrder: params.drawOrder || 20,
      visible: params.visible !== false,
    };
  },
};
