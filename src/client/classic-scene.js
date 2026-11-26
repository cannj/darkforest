import * as THREE from 'three';
import { buildClassicDetails } from './classic-details.js';
import { classicCellSize } from './classic-prefabs.js';
export { classicCellSize } from './classic-prefabs.js';

export function buildClassicScene(board, material) {
  const group = new THREE.Group();
  const details = buildClassicDetails(material);
  group.add(details.group);
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
  return {
    group,
    groundLightSpots: details.groundLightSpots,
    animate: details.animate,
    update(view) {
      const doors = new Map([...view.terrainMemory, ...view.observation.doors].map((door) => [door.id, door.open]));
      const current = new Set(view.observation.cells.map(cell => cell.row + ',' + cell.col));
      details.update({ ...board, cells: board.cells.filter(cell => current.has(cell.row + ',' + cell.col)),
        edges: board.edges.filter(edge => current.has(edge.a.row + ',' + edge.a.col) || current.has(edge.b.row + ',' + edge.b.col)) }, doors);

    },
    dispose() {
      details.dispose();
      unknownGeometry.dispose(); unknownMaterial.dispose(); unknown.dispose();
      group.clear();
    },
  };
}
