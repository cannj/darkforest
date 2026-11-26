import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildRoom } from '../room.js';

export const classicCellSize = 4;
export const roomScale = new THREE.Vector3(0.375, 0.55, 0.46);

const sections = {
  'stone-chamber': ['floor', 'pillars', 'debris', 'moss', 'braziers'],
  'open-court': ['floor', 'moss'],
  'broken-corner': ['floor', 'side-wall', 'pillars', 'debris', 'moss'],
  'window-ruin': ['floor', 'pillars', 'moss', 'braziers'],
};

export function roomAsset(template, material, edge = false) {
  const group = new THREE.Group();
  const animate = buildRoom(group, material, { sections: edge ? ['arch', 'ivy'] : sections[template], archCenter: 0 });
  if (template === 'broken-corner' && !edge) {
    for (const child of [...group.children]) if (child.userData.roomSection === 'side-wall' && (child.position.z > -1.7 || child.position.z < -2.8)) child.removeFromParent();
  }
  group.scale.copy(roomScale);
  if (edge) group.position.z = 3.73 * roomScale.z;
  group.updateMatrixWorld(true);
  const staticParts = new Map();
  const sourceGeometry = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    sourceGeometry.add(object.geometry);
    if (object.userData.animated) return;
    if (!staticParts.has(object.material)) staticParts.set(object.material, []);
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    staticParts.get(object.material).push(geometry);
  });
  const output = new THREE.Group();
  for (const [surface, shapes] of staticParts) {
    const geometry = mergeGeometries(shapes);
    shapes.forEach(shape => shape.dispose());
    output.add(new THREE.Mesh(geometry, surface));
  }
  const staticMeshes = [];
  group.traverse(object => { if (object.isMesh && !object.userData.animated) staticMeshes.push(object); });
  staticMeshes.forEach(object => object.removeFromParent());
  if (!edge && sections[template].includes('braziers')) output.add(group);
  for (const geometry of sourceGeometry) {
    let animated = false;
    group.traverse(object => { if (object.userData.animated && object.geometry === geometry) animated = true; });
    if (!animated) geometry.dispose();
  }
  if (template === 'window-ruin' && !edge) {
    const window = roomAsset('stone-chamber', material, true).group;
    window.scale.set(0.22, 0.64, 0.5); window.position.set(-1.45, 0, -0.65);
    output.add(window);
  }
  return { group: output, animate };
}

export function edgePrefab(kind, leaf = false) {
  const pieces = [];
  const stone = new RoundedBoxGeometry(1, 1, 1, 1, 0.075);
  const add = (x, y, w, h, d = 0.3) => {
    const shape = stone.clone(); shape.scale(w, h, d); shape.translate(x, y, 0); pieces.push(shape);
  };
  if (leaf) {
    add(0, 0.46, 0.76, 0.88, 0.12);
    for (const x of [-0.25, 0.25]) add(x, 0.46, 0.045, 0.86, 0.16);
  } else {
    for (let tier = 0; tier < 4; tier++) {
      const cuts = tier % 2 ? [-2,-1.55,-0.6,0.42,1.44,2] : [-2,-1.05,-0.06,0.97,2];
      for (let i = 1; i < cuts.length; i++) {
        const left = cuts[i - 1], right = cuts[i];
        if (kind === 'window' && tier > 0 && tier < 3 && left < 0.6 && right > -0.6) continue;
        add((left + right) / 2, 0.16 + tier * 0.27, right - left - 0.035, 0.25);
      }
    }
    if (kind === 'window') for (const x of [-0.4,0,0.4]) add(x, 0.64, 0.055, 0.62, 0.14);
  }
  stone.dispose();
  const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose()); return geometry;
}
