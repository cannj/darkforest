import * as THREE from 'three';
import { braziers } from '../room.js';
import { roomAsset, edgePrefab, roomScale, classicCellSize } from './classic-prefabs.js';

// Input is the server's sparse current-only BoardProjection. No remembered or
// unknown cell is ever passed through the room factory.
export function buildClassicDetails(material) {
  const group = new THREE.Group();
  const groundLightSpots = [];
  const animations = [];
  let signature;
  function clear() {
    const geometries = new Set(); const materials = new Set();
    group.traverse(object => { if (object.isMesh) { geometries.add(object.geometry); materials.add(object.material); } });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(surface => surface.dispose());
    group.clear(); animations.length = 0; groundLightSpots.length = 0;
  }
  return {
    group, groundLightSpots,
    update(board, doors = new Map()) {
      const next = JSON.stringify([board, [...doors]]);
      if (next === signature) return;
      clear(); signature = next;
      const position = cell => new THREE.Vector3((cell.col - (board.cols - 1) / 2) * classicCellSize, 0.14,
        (cell.row - (board.rows - 1) / 2) * classicCellSize);
      for (const cell of board.cells) {
        const asset = roomAsset(cell.template, material);
        const origin = position(cell);
        asset.group.position.copy(origin);
        group.add(asset.group); animations.push(asset.animate);
        if (!['stone-chamber', 'window-ruin'].includes(cell.template)) continue;
        for (const fire of braziers) {
          const location = new THREE.Vector3(fire.x, fire.y + 1.28 * fire.scale, fire.z).multiply(roomScale).add(origin);
          const light = new THREE.PointLight(0xffbd85, 4.2 * fire.scale * roomScale.x ** 2, 5.5 * fire.scale * roomScale.z, 2);
          light.position.copy(location); group.add(light);
          groundLightSpots.push(new THREE.Vector3(location.x, location.z, 3.05 * fire.scale * roomScale.z));
        }
      }
      const seen = new Set();
      for (const edge of board.edges) {
        if (seen.has(edge.id)) continue;
        seen.add(edge.id);
        const origin = position(edge.a).add(position(edge.b)).multiplyScalar(0.5);
        const angle = edge.a.col !== edge.b.col ? Math.PI / 2 : 0;
        const boundary = edge.kind === 'door' ? roomAsset('stone-chamber', material, true).group :
          new THREE.Mesh(edgePrefab(edge.kind), material('stone', 0));
        boundary.position.copy(origin); boundary.rotation.y = angle; group.add(boundary);
        if (edge.kind === 'door' && !doors.get(edge.id)) {
          const leaf = new THREE.Mesh(edgePrefab('door', true), material('ember', -0.21));
          leaf.position.copy(origin); leaf.rotation.y = angle; group.add(leaf);
        }
      }
    },
    animate(time) { animations.forEach(animate => animate(time)); },
    dispose() { clear(); signature = undefined; },
  };
}
