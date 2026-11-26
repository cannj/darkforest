import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const classicCellSize = 4;

// Prefabs stay inside the cell; only authoritative shared edges close exits.
export function prefab(template, terrain) {
  const parts = new Map();
  function add(family, shape) {
    if (!parts.has(family)) parts.set(family, []);
    parts.get(family).push(shape);
  }
  function box(family, x, y, z, w, h, d, angle = 0) {
    const shape = new THREE.BoxGeometry(w, h, d);
    shape.rotateY(angle);
    shape.translate(x, y, z);
    add(family, shape);
  }
  box(terrain, 0, 0, 0, 3.88, 0.2, 3.88);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    box(terrain, (col - 1.5) * 0.94, 0.13, (row - 1.5) * 0.94, 0.88, 0.09, 0.88);
  }
  if (template === 'stone-chamber') {
    // Four dressed piers and paired capstones outline an old chamber.
    for (const x of [-1.37, 1.37]) for (const z of [-1.37, 1.37]) {
      box('stone', x, 0.3, z, 0.72, 0.22, 0.72);
      box('stone', x, 0.83, z, 0.46, 0.85, 0.46);
      box('stone', x, 1.32, z, 0.66, 0.16, 0.66);
      box('moss', x + 0.2, 0.23, z - 0.24, 0.48, 0.08, 0.25);
    }
    for (const z of [-1.37, 1.37]) box('stone', 0, 0.22, z, 1.8, 0.09, 0.24);
    for (const z of [-1.02, 1.02]) {
      const x = z * -0.82;
      box('stone', x, 0.32, z, 0.45, 0.31, 0.45, Math.PI / 4);
      box('stone', x, 0.51, z, 0.61, 0.12, 0.61, Math.PI / 4);
      const flame = new THREE.OctahedronGeometry(0.32);
      flame.scale(0.72, 1.25, 0.72);
      flame.rotateZ(z * 0.19);
      flame.translate(x, 0.8, z);
      add('ember', flame);
    }
  } else if (template === 'open-court') {
    // A low, mossy court with a diamond mosaic and broken garden edging.
    box('stone', 0, 0.22, 0, 1.22, 0.08, 1.22, Math.PI / 4);
    box('moss', 0, 0.27, 0, 0.8, 0.04, 0.8, Math.PI / 4);
    for (const x of [-1.32, 1.32]) {
      box('stone', x, 0.3, -1.22, 0.82, 0.25, 0.74);
      box('moss', x, 0.45, -1.22, 0.66, 0.07, 0.57);
      box('moss', x, 0.23, 1.28, 0.8, 0.12, 0.72);
    }
  } else if (template === 'broken-corner') {
    // Stepped masonry and a fallen column make an asymmetric silhouette.
    box('stone', -1.3, 0.51, -1.25, 0.8, 0.82, 0.62);
    box('stone', -1.32, 1.06, -1.27, 0.63, 0.3, 0.53);
    box('stone', -0.68, 0.34, -1.3, 0.48, 0.45, 0.6);
    box('stone', 1.17, 0.38, 1.1, 0.55, 0.48, 1.4, -0.65);
    for (let i = 0; i < 5; i++) {
      box(i % 2 ? 'moss' : 'stone', -1.3 + i * 0.58, 0.25, 1.34 - (i % 2) * 0.38, 0.37, 0.2, 0.34, i * 0.4);
    }
  } else if (template === 'window-ruin') {
    // A freestanding, carved window fragment sits outside the walkable center.
    for (const x of [-1.55, -0.55]) {
      box('stone', x, 0.83, -1.3, 0.27, 1.3, 0.43);
      box('stone', x, 1.5, -1.3, 0.39, 0.14, 0.52);
    }
    box('stone', -1.05, 0.43, -1.3, 1.27, 0.18, 0.5);
    box('stone', -1.05, 1.63, -1.3, 1.45, 0.18, 0.56);
    box('moss', -1.3, 0.23, -0.77, 0.9, 0.08, 0.3);
    box('stone', 1.34, 0.38, 1.3, 0.65, 0.47, 0.66);
    box('moss', 1.34, 0.65, 1.3, 0.76, 0.07, 0.71);
  }
  return [...parts].map(([family, shapes]) => {
    const geometry = mergeGeometries(shapes);
    shapes.forEach((shape) => shape.dispose());
    return { family, geometry };
  });
}

export function edgePrefab(kind, leaf = false) {
  const pieces = [];
  const add = (x, y, w, h, d = 0.24) => {
    const shape = new THREE.BoxGeometry(w, h, d);
    shape.translate(x, y, 0);
    pieces.push(shape);
  };
  if (leaf) {
    add(0, 0.73, 2.42, 1.14, 0.14);
    for (const x of [-0.8, 0, 0.8]) add(x, 0.73, 0.07, 1.1, 0.22);
    add(0, 0.42, 2.4, 0.09, 0.25);
  } else if (kind === 'wall') {
    for (let tier = 0; tier < 3; tier++) {
      for (let brick = 0; brick < 4; brick++) add((brick - 1.5) * 0.98, 0.35 + tier * 0.38, 0.94, 0.35, 0.3);
    }
    add(0, 1.4, 3.94, 0.16, 0.4);
  } else {
    for (const x of [-1.53, 1.53]) add(x, 0.85, 0.72, 1.4, 0.42);
    add(0, 1.63, 3.8, 0.22, 0.46);
    if (kind === 'window') {
      add(0, 0.48, 2.45, 0.65, 0.3);
      for (const x of [-0.6, 0.6]) add(x, 1.1, 0.1, 0.78, 0.14);
    }
  }
  const geometry = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  return geometry;
}

