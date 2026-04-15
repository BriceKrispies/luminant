#!/usr/bin/env node
/**
 * Convert a traced SVG into a creature shape data module.
 *
 * Usage:
 *   node scripts/convert-svg.js docs/characters/char_01.svg ghost
 *
 * Reads an SVG file (from vtracer), normalizes coordinates to [-1,1],
 * classifies colors into palette roles, and outputs a JS module
 * at src/renderer/creatures/shapes/<name>.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const [,, svgPath, shapeName] = process.argv;

if (!svgPath || !shapeName) {
  console.error('Usage: node scripts/convert-svg.js <svg-file> <shape-name>');
  process.exit(1);
}

const svg = readFileSync(svgPath, 'utf-8');

// ── Parse SVG dimensions ──

const dimMatch = svg.match(/width="(\d+)" height="(\d+)"/);
const svgW = dimMatch ? parseInt(dimMatch[1]) : 100;
const svgH = dimMatch ? parseInt(dimMatch[2]) : 100;

// ── Extract paths ──

const pathRegex = /<path d="([^"]+)" fill="([^"]+)"(?:\s+transform="translate\(([^)]+)\)")?/g;
const rawPaths = [];
let m;
while ((m = pathRegex.exec(svg)) !== null) {
  rawPaths.push({
    d: m[1],
    fill: m[2],
    tx: m[3] ? parseFloat(m[3].split(',')[0]) : 0,
    ty: m[3] ? parseFloat(m[3].split(',')[1] || '0') : 0,
  });
}

console.log(`Parsed ${rawPaths.length} paths from ${svgPath}`);

// ── Parse SVG path data into command arrays ──

function parsePath(d) {
  const commands = [];
  // Tokenize: split on command letters, keeping the letter
  const tokens = d.match(/[A-Za-z][^A-Za-z]*/g) || [];

  let cx = 0, cy = 0; // current point for relative commands

  for (const token of tokens) {
    const cmd = token[0];
    const nums = token.slice(1).trim().match(/-?\d+\.?\d*/g)?.map(Number) || [];

    switch (cmd) {
      case 'M':
        for (let i = 0; i < nums.length; i += 2) {
          commands.push({ op: 'M', x: nums[i], y: nums[i + 1] });
          cx = nums[i]; cy = nums[i + 1];
        }
        break;
      case 'm':
        for (let i = 0; i < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1];
          commands.push({ op: 'M', x: cx, y: cy });
        }
        break;
      case 'L':
        for (let i = 0; i < nums.length; i += 2) {
          commands.push({ op: 'L', x: nums[i], y: nums[i + 1] });
          cx = nums[i]; cy = nums[i + 1];
        }
        break;
      case 'l':
        for (let i = 0; i < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1];
          commands.push({ op: 'L', x: cx, y: cy });
        }
        break;
      case 'C':
        for (let i = 0; i < nums.length; i += 6) {
          commands.push({
            op: 'C',
            x1: nums[i], y1: nums[i + 1],
            x2: nums[i + 2], y2: nums[i + 3],
            x: nums[i + 4], y: nums[i + 5],
          });
          cx = nums[i + 4]; cy = nums[i + 5];
        }
        break;
      case 'c':
        for (let i = 0; i < nums.length; i += 6) {
          commands.push({
            op: 'C',
            x1: cx + nums[i], y1: cy + nums[i + 1],
            x2: cx + nums[i + 2], y2: cy + nums[i + 3],
            x: cx + nums[i + 4], y: cy + nums[i + 5],
          });
          cx += nums[i + 4]; cy += nums[i + 5];
        }
        break;
      case 'Q':
        for (let i = 0; i < nums.length; i += 4) {
          commands.push({
            op: 'Q',
            x1: nums[i], y1: nums[i + 1],
            x: nums[i + 2], y: nums[i + 3],
          });
          cx = nums[i + 2]; cy = nums[i + 3];
        }
        break;
      case 'q':
        for (let i = 0; i < nums.length; i += 4) {
          commands.push({
            op: 'Q',
            x1: cx + nums[i], y1: cy + nums[i + 1],
            x: cx + nums[i + 2], y: cy + nums[i + 3],
          });
          cx += nums[i + 2]; cy += nums[i + 3];
        }
        break;
      case 'Z':
      case 'z':
        commands.push({ op: 'Z' });
        break;
      default:
        // Skip unsupported commands (H, V, A, S, T)
        break;
    }
  }

  return commands;
}

// ── Compute bounding box of all non-background paths ──

function isBackground(fill) {
  // White or near-white
  const hex = fill.replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r > 200 && g > 200 && b > 200;
}

function hexToLuminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Classify color into palette role based on luminance
function classifyColor(fill) {
  const lum = hexToLuminance(fill);
  if (lum > 0.65) return 'highlight';
  if (lum > 0.4) return 'base';
  if (lum > 0.25) return 'mid';
  return 'interior';
}

// Parse and collect bounding box
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

const parsedPaths = rawPaths
  .filter(p => !isBackground(p.fill))
  .map(p => {
    const commands = parsePath(p.d);

    // Apply translate transform and track bounds
    for (const cmd of commands) {
      if (cmd.x !== undefined) {
        cmd.x += p.tx;
        cmd.y += p.ty;
        minX = Math.min(minX, cmd.x); maxX = Math.max(maxX, cmd.x);
        minY = Math.min(minY, cmd.y); maxY = Math.max(maxY, cmd.y);
      }
      if (cmd.x1 !== undefined) {
        cmd.x1 += p.tx;
        cmd.y1 += p.ty;
      }
      if (cmd.x2 !== undefined) {
        cmd.x2 += p.tx;
        cmd.y2 += p.ty;
      }
    }

    return {
      commands,
      fill: p.fill,
      role: classifyColor(p.fill),
    };
  });

console.log(`Bounding box: (${minX.toFixed(1)}, ${minY.toFixed(1)}) to (${maxX.toFixed(1)}, ${maxY.toFixed(1)})`);

// ── Normalize coordinates to [-1, 1] ──

const centerX = (minX + maxX) / 2;
const centerY = (minY + maxY) / 2;
const extentX = (maxX - minX) / 2;
const extentY = (maxY - minY) / 2;
const maxExtent = Math.max(extentX, extentY);

function normalize(x, y) {
  return {
    x: Math.round(((x - centerX) / maxExtent) * 1000) / 1000,
    y: Math.round(((y - centerY) / maxExtent) * 1000) / 1000,
  };
}

// Normalize all coordinates
for (const path of parsedPaths) {
  for (const cmd of path.commands) {
    if (cmd.x !== undefined) {
      const n = normalize(cmd.x, cmd.y);
      cmd.x = n.x; cmd.y = n.y;
    }
    if (cmd.x1 !== undefined) {
      const n = normalize(cmd.x1, cmd.y1);
      cmd.x1 = n.x; cmd.y1 = n.y;
    }
    if (cmd.x2 !== undefined) {
      const n = normalize(cmd.x2, cmd.y2);
      cmd.x2 = n.x; cmd.y2 = n.y;
    }
  }
}

// ── Compact encoding: flatten commands into arrays ──
// Format: [op, ...coords] where op is 0=M, 1=L, 2=C, 3=Q, 4=Z

function encodeCommands(commands) {
  const encoded = [];
  for (const cmd of commands) {
    switch (cmd.op) {
      case 'M': encoded.push(0, cmd.x, cmd.y); break;
      case 'L': encoded.push(1, cmd.x, cmd.y); break;
      case 'C': encoded.push(2, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
      case 'Q': encoded.push(3, cmd.x1, cmd.y1, cmd.x, cmd.y); break;
      case 'Z': encoded.push(4); break;
    }
  }
  return encoded;
}

// ── Output JS module ──

const shapePaths = parsedPaths.map(p => ({
  data: encodeCommands(p.commands),
  fill: p.fill,
  role: p.role,
}));

const roleGroups = {};
for (const p of shapePaths) {
  if (!roleGroups[p.role]) roleGroups[p.role] = 0;
  roleGroups[p.role]++;
}
console.log('Color roles:', roleGroups);

const outputDir = 'src/renderer/creatures/shapes';
mkdirSync(outputDir, { recursive: true });

const output = `/**
 * SVG path data for the ${shapeName} creature shape.
 * Auto-generated from ${svgPath} by scripts/convert-svg.js
 *
 * Coordinates normalized to [-1, 1] centered on the character.
 * Paths sorted back-to-front (painter's order from the SVG).
 *
 * Each path: { data: Float32Array, role: string, fill: string }
 *   data encoding: [op, ...coords] where op: 0=M, 1=L, 2=C, 3=Q, 4=Z
 *   role: 'interior' | 'mid' | 'base' | 'highlight' — maps to archetype palette
 */

export const SHAPE_ID = '${shapeName}';
export const PATH_COUNT = ${shapePaths.length};

export const PATHS = [
${shapePaths.map(p => `  { data: new Float32Array([${p.data.join(',')}]), role: '${p.role}', fill: '${p.fill}' },`).join('\n')}
];
`;

const outPath = `${outputDir}/${shapeName}.js`;
writeFileSync(outPath, output);
console.log(`Wrote ${outPath} (${shapePaths.length} paths, ${output.length} bytes)`);
