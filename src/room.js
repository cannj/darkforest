import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const braziers = [
  { x: 2.85, y: 0.05, z: 0.8, scale: 1 },
  { x: -3.6, y: 0.05, z: -1.85, scale: 0.78 },
];

export function buildRoom(scene, material, { sections, archCenter = -0.35 } = {}) {
  let section = 'floor';
  const created = [];
  let seed = 31821;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  const stoneTones = [-0.24, -0.12, -0.055, 0, 0.055, 0.12];
  const stone = stoneTones.map((bias) => material('stone', bias));
  const floorStone = stoneTones.slice(1, 5).map((bias) => material('stone', bias, { ground: true }));
  const moss = [-0.15, -0.045, 0.04, 0.15].map((bias) => material('moss', bias));
  const ember = [0.32, 0.52, 0.72, 0.9].map((glow) => material('ember', 0, { glow }));
  const brazierMetal = material('ember', -0.21);
  const box = new RoundedBoxGeometry(1, 1, 1, 1, 0.075);
  const rubble = new THREE.DodecahedronGeometry(0.5);
  const spark = new THREE.OctahedronGeometry(0.5);

  function mesh(geometry, surface, x, y, z, width, height, depth, parent = scene) {
    const object = new THREE.Mesh(geometry, surface);
    object.position.set(x, y, z);
    object.scale.set(width, height, depth);
    object.userData.roomSection = section;
    created.push(object);
    parent.add(object);
    return object;
  }

  function slab(x, y, z, width, height, depth, surface, parent = scene) {
    return mesh(box, surface, x, y, z, width, height, depth, parent);
  }

  function pick(items) {
    return items[Math.floor(random() * items.length)];
  }

  slab(0, -0.57, 0, 10.35, 0.5, 8.2, stone[0]);
  slab(0, -0.29, 0, 10.18, 0.2, 8.04, stone[1]);
  for (let x = -4.5; x <= 4.5; x++) {
    slab(x, -0.39, 4.02, 0.96, 0.39, 0.24, pick(stone.slice(0, 3)));
  }
  for (let z = -3.5; z <= 3.5; z++) {
    slab(5.02, -0.39, z, 0.24, 0.39, 0.96, pick(stone.slice(0, 3)));
  }

  for (let row = 0; row < 8; row++) {
    const cuts = row % 2 ? [-5, -4.45, -3.3, -2.15, -1, 0.15, 1.3, 2.45, 3.6, 4.75, 5] :
      [-5, -3.9, -2.82, -1.7, -0.58, 0.58, 1.7, 2.82, 3.9, 5];
    for (let i = 1; i < cuts.length; i++) {
      const size = cuts[i] - cuts[i - 1];
      const tile = slab((cuts[i] + cuts[i - 1]) / 2, -0.125 + random() * 0.035, row - 3.5,
        size - 0.06, 0.24, 0.93, pick(floorStone));
      tile.rotation.y = (random() - 0.5) * 0.045;
    }
  }

  section = 'arch';
  const wallBase = -3.73;
  const archX = archCenter;
  const opening = 1.03;
  const spring = 1.56;
  const archDepth = 0.83;
  const archRim = 1.4;
  const wallTop = 3.1;

  const wallSpans = [[-4.95, 4.94], [-4.95, 4.94], [-4.91, 4.65],
    [-4.86, 4.25], [-4.39, 3.56], [-3.83, 2.47]];
  for (const [row, [leftEdge, rightEdge]] of wallSpans.entries()) {
    const bottom = row * 0.5;
    const top = bottom + 0.5;
    const cutout = bottom < spring ? archRim : Math.sqrt(Math.max(0, archRim ** 2 - (bottom - spring) ** 2));
    const spans = [[leftEdge, archX - cutout + 0.1], [archX + cutout - 0.1, rightEdge]];
    for (const [left, right] of spans) {
      const count = Math.ceil((right - left) / 1.17);
      const spacing = (right - left) / count;
      let start = left;
      for (let i = 1; i <= count; i++) {
        const end = i === count ? right : left + i * spacing + (random() - 0.5) * 0.38;
        slab((start + end) / 2, (bottom + top) / 2, wallBase + (random() - 0.5) * 0.09,
          end - start - 0.045, 0.46, 0.66, pick(stone.slice(1, 5)));
        start = end;
      }
    }
  }

  const archShape = new THREE.Shape();
  archShape.moveTo(-archRim, 0);
  archShape.lineTo(-opening, 0);
  archShape.absarc(0, 0, opening, Math.PI, 0, true);
  archShape.lineTo(archRim, 0);
  archShape.absarc(0, 0, archRim, 0, Math.PI, false);
  const archMortar = new THREE.ExtrudeGeometry(archShape, {
    depth: 0.62, bevelEnabled: false, curveSegments: 10,
  });
  mesh(archMortar, stone[1], archX, spring, wallBase - 0.37, 1, 1, 1);

  for (let index = 0; index < 9; index++) {
    const step = Math.PI / 9;
    const start = index * step + 0.019;
    const end = (index + 1) * step - 0.019;
    const outer = index === 4 ? archRim + 0.14 : archRim + 0.04;
    const edge = new THREE.Shape();
    edge.moveTo(Math.cos(start) * opening, Math.sin(start) * opening);
    edge.lineTo(Math.cos(start) * outer, Math.sin(start) * outer);
    edge.lineTo(Math.cos(end) * outer, Math.sin(end) * outer);
    edge.lineTo(Math.cos(end) * opening, Math.sin(end) * opening);
    edge.closePath();
    const voussoir = new THREE.ExtrudeGeometry(edge, {
      depth: archDepth, bevelThickness: 0.025, bevelSize: 0.023, bevelSegments: 1, steps: 1,
    });
    mesh(voussoir, stone[index === 4 ? 5 : 3 + (index % 2)], archX, spring, wallBase - 0.41, 1, 1, 1);
  }

  for (const side of [-1, 1]) {
    const x = archX + side * 1.2;
    slab(x, 0.14, wallBase, 0.57, 0.28, 1, stone[3]);
    for (let row = 0; row < 3; row++) {
      slab(x, 0.47 + row * 0.39, wallBase, 0.37, 0.365, 0.89, stone[3 + (row % 2)]);
    }
    slab(x, 1.53, wallBase, 0.55, 0.17, 1, stone[4]);
  }
  slab(archX, 0.04, -2.72, 2.22, 0.14, 0.55, stone[3]);
  slab(archX, 0.13, -3.17, 2.1, 0.15, 0.54, stone[2]);

  for (const [x, width, offset] of [[-3.39, 0.71, -0.03], [-2.48, 0.95, 0],
    [-1.49, 0.96, 0.03], [-0.53, 0.94, 0.01], [0.47, 0.97, 0], [1.39, 0.85, 0], [2.18, 0.5, -0.055]]) {
    slab(x, wallTop + offset, wallBase, width, 0.22, 0.76, pick(stone.slice(2, 5)));
  }

  section = 'side-wall';
  const wallHeights = [6, 6, 6, 5, 4, 3, 2, 1];
  for (let row = 0; row < 6; row++) {
    for (let column = 0; column < wallHeights.length; column++) {
      if (row >= wallHeights[column]) continue;
      const z = -3.34 + column * 0.87 + (row % 2) * 0.12;
      slab(-4.71 + (random() - 0.5) * 0.12, 0.25 + row * 0.48, z,
        0.75, 0.45, 0.83, pick(stone.slice(1, 5)));
    }
  }

  section = 'pillars';
  for (const [x, z, height] of [[-4.62, 1.79, 1.48], [4.56, -2.82, 1.89]]) {
    slab(x, 0.13, z, 1.04, 0.26, 0.97, stone[3]);
    for (let y = 0.45; y < height; y += 0.43) {
      slab(x, y, z, 0.72, 0.39, 0.67, pick(stone.slice(2, 5))).rotation.y = (random() - 0.5) * 0.16;
    }
    slab(x, height, z, 0.86, 0.18, 0.79, stone[3]).rotation.y = -0.12;
  }

  section = 'debris';
  for (const [x, z, spread, count] of [[-3.65, 1.72, 0.85, 7], [4.12, -2.03, 0.72, 8], [3.4, 3.45, 0.72, 5], [-2.8, -3.2, 0.57, 7]]) {
    for (let i = 0; i < count; i++) {
      const size = 0.16 + random() * 0.46;
      const rock = mesh(rubble, pick(stone.slice(1, 5)), x + (random() - 0.5) * spread * 2,
        size * 0.21, z + (random() - 0.5) * spread * 2, size, size * 0.73, size * 0.81);
      rock.rotation.set(random(), random() * 6, random());
    }
  }

  section = 'moss';
  const mossPatches = [
    [-4.12, 0.04, 0.58, 0.55, 1.45, 28], [-4.21, 0.05, -2.87, 0.55, 0.7, 17],
    [3.27, 0.04, -3.17, 1.25, 0.38, 29], [4.02, 0.04, 2.7, 0.73, 0.76, 26],
    [-1.58, 0.04, 3.3, 1.06, 0.58, 19], [0.76, 0.04, -1.07, 0.5, 0.47, 12],
    [-3.14, 3.16, -3.7, 0.67, 0.23, 14], [1.85, 3.18, -3.69, 0.57, 0.29, 19],
    [-4.65, 1.76, 0.05, 0.29, 0.54, 13], [2.89, 0.21, -3.39, 0.63, 0.13, 15],
  ];
  for (const [x, y, z, spreadX, spreadZ, count] of mossPatches) {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random());
      const size = 0.09 + random() * 0.24;
      const clump = mesh(rubble, pick(moss), x + Math.cos(angle) * distance * spreadX, y,
        z + Math.sin(angle) * distance * spreadZ, size * 1.7, size * (distance > 0.68 ? 0.55 : 0.88), size);
      clump.rotation.y = angle;
    }
  }

  for (const [x, z] of [[-4.24, 0.45], [-3.86, 1.25], [3.98, 2.46], [4.31, -2.93], [-1.98, 3.38], [3.07, -3.17]]) {
    for (let blade = 0; blade < 5; blade++) {
      const bladeHeight = 0.17 + random() * 0.26;
      const leaf = mesh(spark, moss[2 + (blade % 2)], x + (random() - 0.5) * 0.24, bladeHeight * 0.47,
        z + (random() - 0.5) * 0.24, 0.105, bladeHeight, 0.075);
      leaf.rotation.set((random() - 0.5) * 0.9, random(), (random() - 0.5) * 0.9);
    }
  }

  section = 'ivy';
  for (const [x, top, count] of [[-2.9, 3.23, 11], [-2.12, 3.18, 7], [1.76, 3.18, 13], [2.23, 3.11, 8]]) {
    for (let i = 0; i < count; i++) {
      const size = 0.15 - i * 0.004;
      const drift = Math.sin(i * 0.64) * 0.1 + i * 0.012;
      const leaf = mesh(rubble, pick(moss), x + drift, top - i * 0.103, wallBase + 0.38,
        size * 1.5, 0.15, size);
      leaf.rotation.z = (i % 2 ? 1 : -1) * 0.4;
    }
  }

  section = 'braziers';
  const pedestalBase = new THREE.CylinderGeometry(0.52, 0.59, 0.22, 8);
  const stem = new THREE.CylinderGeometry(0.15, 0.22, 0.49, 6);
  const bowl = new THREE.CylinderGeometry(0.51, 0.26, 0.29, 8, 1, true);
  const coals = new THREE.CylinderGeometry(0.465, 0.38, 0.075, 8);
  const lip = new THREE.TorusGeometry(0.505, 0.047, 4, 8);
  const flameShape = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.7, 0.08), new THREE.Vector2(1, 0.26),
    new THREE.Vector2(0.64, 0.58), new THREE.Vector2(0.23, 0.77), new THREE.Vector2(0, 1),
  ], 5);

  const fires = braziers.map(({ x, y, z, scale }, fireIndex) => {
    const brazier = new THREE.Group();
    brazier.position.set(x, y, z);
    brazier.scale.setScalar(scale);
    scene.add(brazier);
    mesh(pedestalBase, stone[2], 0, 0.11, 0, 1, 1, 1, brazier);
    mesh(stem, stone[1], 0, 0.42, 0, 1, 1, 1, brazier);
    mesh(bowl, brazierMetal, 0, 0.74, 0, 1, 1, 1, brazier);
    mesh(coals, ember[1], 0, 0.82, 0, 1, 1, 1, brazier);
    mesh(lip, ember[0], 0, 0.885, 0, 1, 1, 1, brazier).rotation.x = -Math.PI / 2;

    for (let i = 0; i < 7; i++) {
      const angle = i * 1.85;
      mesh(rubble, ember[i % 3], Math.cos(angle) * 0.32, 0.88, Math.sin(angle) * 0.32,
        0.19, 0.095, 0.13, brazier).rotation.y = angle;
    }

    const tongues = [
      [-0.05, -0.075, 0.33, 0.97, ember[1]], [0.18, -0.02, 0.18, 0.63, ember[2]],
      [-0.13, 0.14, 0.195, 0.72, ember[2]], [0.054, 0.21, 0.133, 0.55, ember[3]],
    ].map(([tx, tz, radius, height, surface], index) => ({
      object: mesh(flameShape, surface, tx, 0.84, tz, radius, height, radius, brazier),
      radius, height, phase: index * 1.53 + fireIndex,
    }));
    const sparks = Array.from({ length: 6 }, (_, index) => ({
      object: mesh(spark, ember[index % 2 ? 2 : 3], 0, 1, 0, 0.06, 0.08, 0.06, brazier),
      phase: random(), angle: random() * Math.PI * 2,
    }));
    for (const { object } of [...tongues, ...sparks]) object.userData.animated = true;
    return { tongues, sparks };
  });

  if (sections) {
    if (!sections.includes('braziers')) fires.length = 0;
    for (const object of created) {
      if (!sections.includes(object.userData.roomSection) ||
          (object.userData.roomSection === 'moss' && !sections.includes('arch') && object.position.y > 0.3)) object.removeFromParent();
    }
    for (const child of [...scene.children]) if (child.isGroup && child.children.length === 0) child.removeFromParent();
    const surfaces = [...stone, ...floorStone, ...moss, ...ember, brazierMetal];
    const retainedMaterials = new Set(created.filter(object => object.parent).map(object => object.material));
    for (const surface of surfaces) if (!retainedMaterials.has(surface)) surface.dispose();
    const retained = new Set(created.filter(object => object.parent).map(object => object.geometry));
    for (const geometry of new Set(created.map(object => object.geometry))) if (!retained.has(geometry)) geometry.dispose();
  }

  return (time) => {
    for (const { tongues, sparks } of fires) {
      for (const { object, radius, height, phase } of tongues) {
        const wave = Math.sin(time * 8 + phase);
        object.scale.set(radius * (1 - 0.12 * wave), height * (1 + 0.18 * wave), radius);
        object.rotation.set(Math.sin(time * 5 + phase) * 0.14, time * 0.8 + phase, wave * 0.17);
      }
      for (const { object, phase, angle } of sparks) {
        const progress = (time * 0.63 + phase) % 1;
        const distance = 0.12 + progress * 0.49;
        object.position.set(Math.cos(angle + progress * 2) * distance, 1.05 + progress * 1.61,
          Math.sin(angle + progress * 2) * distance);
        object.scale.setScalar(0.083 * (1 - progress * 0.8));
      }
    }
  };
}
