import { expect, test } from 'vitest';
import * as THREE from 'three';
import { buildClassicDetails } from '../src/client/classic-details.js';
import { buildClassicScene } from '../src/client/classic-scene.js';

test('当前石室有火盆局部光，离开当前视野后移除模型和灯光', () => {
  const material = () => new THREE.MeshBasicMaterial();
  const board = { rows: 10, cols: 10, cells: [{ row: 1, col: 1, terrain: 'stone', template: 'stone-chamber' }], edges: [] };
  const detail = buildClassicScene(board, material);
  detail.update({ terrainMemory: [], observation: { cells: [{ row: 1, col: 1 }], doors: [] } });
  const lights = [];
  detail.group.traverse(object => { if (object.isPointLight) lights.push(object); });
  expect(lights).toHaveLength(2);
  expect(detail.groundLightSpots).toHaveLength(2);
  detail.update({ terrainMemory: [], observation: { cells: [], doors: [] } });
  const detailedObjects = [];
  detail.group.traverse(object => { if (object.isPointLight || (object.isMesh && !object.isInstancedMesh)) detailedObjects.push(object); });
  expect(detailedObjects).toHaveLength(0);
  expect(detail.groundLightSpots).toHaveLength(0);
  detail.dispose();
});

test('四类场景的中心通路不被装饰物挡住，共享门打开后能穿过拱门', () => {
  for (const template of ['stone-chamber', 'open-court', 'broken-corner', 'window-ruin']) {
    const detail = buildClassicDetails(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    detail.update({ rows: 1, cols: 1, cells: [{ row: 0, col: 0, terrain: 'stone', template }], edges: [] });
    detail.group.updateMatrixWorld(true);
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(x, 0, z).normalize(), 0, Math.hypot(x, z) * 2);
      expect(ray.intersectObject(detail.group, true), template).toHaveLength(0);
    }
    detail.dispose();
  }
  const detail = buildClassicDetails(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  detail.update({ rows: 2, cols: 1, cells: [], edges: [{ id: 'door', kind: 'door', a: { row: 0, col: 0 }, b: { row: 1, col: 0 } }] }, new Map([['door', true]]));
  detail.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.5, -2), new THREE.Vector3(0, 0, 1), 0, 4);
  expect(ray.intersectObject(detail.group, true)).toHaveLength(0);
  detail.dispose();
});
