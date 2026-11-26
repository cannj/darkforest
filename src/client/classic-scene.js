import * as THREE from 'three';
import { prefab, edgePrefab, classicCellSize } from './classic-prefabs.js';
export { classicCellSize } from './classic-prefabs.js';

export function buildClassicScene(board, material, mapMemory = { cells: [], edges: [] }) {
  const group = new THREE.Group();
  const batches = [];
  const markers = [];
  const unknownGeometry = new THREE.BoxGeometry(3.88, 0.08, 3.88);
  const unknownMaterial = material('stone', 0, { glow: 0.18 });
  const known = new Set(board.cells.map(c => c.row + ',' + c.col));
  const unknown = new THREE.InstancedMesh(unknownGeometry, unknownMaterial, board.rows * board.cols - known.size);
  const unknownMatrix = new THREE.Matrix4();
  const neutralVisibility = new THREE.Color(1, 0, 0);
  let unknownIndex = 0;
  for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
    if (known.has(row + ',' + col)) continue;
    unknownMatrix.makeTranslation((col - (board.cols - 1) / 2) * classicCellSize, 0, (row - (board.rows - 1) / 2) * classicCellSize);
    unknown.setMatrixAt(unknownIndex, unknownMatrix);
    unknown.setColorAt(unknownIndex++, neutralVisibility);
  }
  group.add(unknown);
  const coordinate = (value, count) => (value - (count - 1) / 2) * classicCellSize;
  const position = (cell) => new THREE.Vector3(coordinate(cell.col, board.cols), 0, coordinate(cell.row, board.rows));
  const rememberedMaterial = material('stone', 0, { glow: 0.36 });
  const markerMaterial = material('stone', 0, { glow: 0.57 });
  function rememberedBox(geometry, surface, origin, angle = 0) {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.position.copy(origin);
    mesh.rotation.y = angle;
    group.add(mesh);
    markers.push(mesh);
    return mesh;
  }
  // Flat terrain and low boundary symbols keep remembered layout distinct from the scene.
  for (const cell of mapMemory.cells) {
    if (known.has(cell.row + ',' + cell.col)) continue;
    rememberedBox(new THREE.BoxGeometry(3.5, 0.06, 3.5), rememberedMaterial, position(cell).add(new THREE.Vector3(0, 0.08, 0)));
    if (cell.terrain === 'moss') rememberedBox(new THREE.BoxGeometry(1.15, 0.04, 0.85), markerMaterial, position(cell).add(new THREE.Vector3(-0.6, 0.13, 0.6)));
  }
  const currentEdges = new Set(board.edges.map(edge => edge.id));
  const rememberedDoors = [];
  for (const edge of mapMemory.edges) {
    if (currentEdges.has(edge.id)) continue;
    const origin = position(edge.a).add(position(edge.b)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.2, 0));
    const angle = edge.a.col !== edge.b.col ? Math.PI / 2 : 0;
    if (edge.kind === 'wall') rememberedBox(new THREE.BoxGeometry(3.7, 0.25, 0.18), markerMaterial, origin, angle);
    else {
      for (const offset of [-1.45, 1.45]) {
        const end = new THREE.Vector3(offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(origin);
        rememberedBox(new THREE.BoxGeometry(0.65, 0.25, 0.18), markerMaterial, end, angle);
      }
      const leaf = rememberedBox(new THREE.BoxGeometry(2.2, 0.16, edge.kind === 'window' ? 0.08 : 0.2), markerMaterial, origin, angle);
      if (edge.kind === 'window') {
        rememberedBox(new THREE.BoxGeometry(2.2, 0.08, 0.08), rememberedMaterial, origin.clone().add(new THREE.Vector3(0, 0.18, 0)), angle);
      } else rememberedDoors.push({ leaf, edge, angle });
    }
  }
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  function batch(geometry, family, entries, edge = false, leaf = false) {
    const glow = family === 'ember' && !edge ? 0.62 : -1;
    const surface = material(family, family === 'moss' ? 0.14 : 0.12, { glow });
    const mesh = new THREE.InstancedMesh(geometry, surface, entries.length);
    const transforms = entries.map((entry, index) => {
      const origin = edge ? position(entry.a).add(position(entry.b)).multiplyScalar(0.5) : position(entry);
      const angle = edge && entry.a.col !== entry.b.col ? Math.PI / 2 : 0;
      rotation.setFromAxisAngle(up, angle);
      matrix.compose(origin, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.setRGB(0, 0, 0));
      return { origin, angle };
    });
    group.add(mesh);
    batches.push({ mesh, entries, edge, leaf, transforms });
  }
  const cellsByPrefab = new Map();
  for (const cell of board.cells) {
    const key = `${cell.template}:${cell.terrain}`;
    if (!cellsByPrefab.has(key)) cellsByPrefab.set(key, []);
    cellsByPrefab.get(key).push(cell);
  }
  for (const cells of cellsByPrefab.values()) {
    for (const { family, geometry } of prefab(cells[0].template, cells[0].terrain)) batch(geometry, family, cells);
  }
  for (const kind of ['wall', 'door', 'window']) {
    const entries = board.edges.filter((edge) => edge.kind === kind);
    if (!entries.length) continue;
    batch(edgePrefab(kind), 'stone', entries, true);
    if (kind === 'door') batch(edgePrefab(kind, true), 'ember', entries, true, true);
  }
  return {
    group,
    update(view) {
      const visible = new Set(view.observation.cells.map((cell) => `${cell.row},${cell.col}`));
      const doors = new Map([...view.terrainMemory, ...view.observation.doors].map((door) => [door.id, door.open]));
      for (const { leaf, edge, angle } of rememberedDoors) leaf.rotation.y = angle + (doors.get(edge.id) ? Math.PI / 2 : 0);
      const isVisible = (cell) => visible.has(`${cell.row},${cell.col}`);
      for (const { mesh, entries, edge, leaf, transforms } of batches) {
        entries.forEach((entry, index) => {
          const lit = edge ? isVisible(entry.a) || isVisible(entry.b) : isVisible(entry);
          mesh.setColorAt(index, color.setRGB(lit ? 1 : 0, 0, 0));
          if (leaf) {
            const { origin, angle } = transforms[index];
            // An unknown door is closed; only this player's observed/remembered state can open it.
            rotation.setFromAxisAngle(up, angle + (doors.get(entry.id) ? Math.PI / 2 : 0));
            matrix.compose(origin, rotation, scale);
            mesh.setMatrixAt(index, matrix);
          }
        });
        mesh.instanceColor.needsUpdate = true;
        if (leaf) mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const { mesh } of batches) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
      for (const mesh of markers) mesh.geometry.dispose();
      rememberedMaterial.dispose(); markerMaterial.dispose();
      unknownGeometry.dispose(); unknownMaterial.dispose(); unknown.dispose();
      group.clear();
    },
  };
}
