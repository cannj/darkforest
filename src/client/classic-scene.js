import * as THREE from 'three';
import { buildClassicDetails } from './classic-details.js';
import { classicCellSize } from './classic-prefabs.js';
export { classicCellSize } from './classic-prefabs.js';

function buildGrayLayout(board, material, mapMemory) {
  const group = new THREE.Group();
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
  for (const cell of mapMemory?.cells ?? []) {
    if (known.has(cell.row + ',' + cell.col)) continue;
    rememberedBox(new THREE.BoxGeometry(3.5, 0.06, 3.5), rememberedMaterial, position(cell).add(new THREE.Vector3(0, 0.08, 0)));
    if (cell.terrain === 'moss') rememberedBox(new THREE.BoxGeometry(1.15, 0.04, 0.85), markerMaterial, position(cell).add(new THREE.Vector3(-0.6, 0.13, 0.6)));
  }
  const currentEdges = new Set(board.edges.map(edge => edge.id));
  const rememberedDoors = [];
  for (const edge of mapMemory?.edges ?? []) {
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
  return {
    group,
    updateDoors(terrainMemory) {
      const doors = new Map(terrainMemory.map(door => [door.id, door.open]));
      for (const { leaf, edge, angle } of rememberedDoors) leaf.rotation.y = angle + (doors.get(edge.id) ? Math.PI / 2 : 0);
    },
    dispose() {
      for (const mesh of markers) mesh.geometry.dispose();
      rememberedMaterial.dispose(); markerMaterial.dispose();
      unknownGeometry.dispose(); unknownMaterial.dispose(); unknown.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}

export function buildClassicScene(material) {
  const group = new THREE.Group();
  const details = buildClassicDetails(material);
  group.add(details.group);
  let grayLayout;
  let grayLayoutKey;
  return {
    group,
    groundLightSpots: details.groundLightSpots,
    animate: details.animate,
    update({ board, mapMemory, terrainMemory, observation }) {
      const nextGrayLayoutKey = JSON.stringify([board, mapMemory]);
      if (nextGrayLayoutKey !== grayLayoutKey) {
        grayLayout?.dispose();
        grayLayout = buildGrayLayout(board, material, mapMemory);
        group.add(grayLayout.group);
        grayLayoutKey = nextGrayLayoutKey;
      }
      grayLayout.updateDoors(terrainMemory);
      details.update(board, new Map(observation.doors.map(door => [door.id, door.open])));
    },
    dispose() {
      grayLayout?.dispose();
      details.dispose();
      group.clear();
    },
  };
}
