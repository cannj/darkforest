import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { buildRoom, braziers } from './room.js';
import { buildClassicScene, classicCellSize } from './client/classic-scene.js';
import { mountGame } from './client/game.ts';

const canvas = document.querySelector('#room');
const stage = document.querySelector('.stage');
const toggle = document.querySelector('#edges');
const resetView = document.querySelector('#reset-view');
const error = document.querySelector('#error');
const width = canvas.width;
const height = canvas.height;

const palettes = {
  stone: ['#252637', '#343345', '#494454', '#625362', '#816871', '#ac8782'],
  moss: ['#222d35', '#2d3c42', '#3b5050', '#4a6258', '#637764', '#89946a'],
  ember: ['#512e3d', '#84424a', '#be5b50', '#ee8960', '#ffc581', '#ffe4ab'],
};

function createGroundLightMask() {
  const size = 128;
  const bands = [[0.34, 255], [0.66, 165], [1, 82]];
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      data[y * size + x] = bands.find(([outerRadius]) => radius < outerRadius)?.[1] ?? 0;
    }
  }
  const mask = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  mask.needsUpdate = true;
  return mask;
}

const groundLightMask = createGroundLightMask();
const maxVisibleClassicCells = 9;
const groundLightSpots = Array.from({ length: maxVisibleClassicCells * braziers.length }, () => new THREE.Vector3());
const groundLightCount = { value: 0 };
function setGroundLights(spots) {
  groundLightCount.value = Math.min(spots.length, groundLightSpots.length);
  groundLightSpots.forEach((target, index) => target.copy(spots[index] ?? new THREE.Vector3()));
}
setGroundLights(braziers.map(({ x, z, scale }) => new THREE.Vector3(x, z, 3.05 * scale)));
const fireIntensity = 4.2;

function material(family, bias = 0, { glow = -1, ground = false } = {}) {
  return new THREE.ShaderMaterial({
    lights: true,
    defines: ground ? { GROUND_LIGHT: 1 } : {},
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      familyId: { value: Object.keys(palettes).indexOf(family) + 1 },
      bias: { value: bias },
      glow: { value: glow },
      groundLightMask: { value: groundLightMask },
      groundLightSpots: { value: groundLightSpots },
      groundLightCount,
    },
    vertexShader: /* glsl */ `
      varying vec3 worldPosition;
      varying vec3 viewPosition;
      varying vec3 viewNormal;
      varying float cellVisibility;

      void main() {
        vec4 localPosition = vec4(position, 1.0);
        vec3 localNormal = normal;
        cellVisibility = 1.0;
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
          localNormal = mat3(instanceMatrix) * localNormal;
        #endif
        #ifdef USE_INSTANCING_COLOR
          cellVisibility = instanceColor.r;
        #endif
        vec4 positionInView = modelViewMatrix * localPosition;
        worldPosition = (modelMatrix * localPosition).xyz;
        viewPosition = positionInView.xyz;
        viewNormal = normalMatrix * localNormal;
        gl_Position = projectionMatrix * positionInView;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <lights_pars_begin>

      uniform float familyId;
      uniform float bias;
      uniform float glow;
      varying vec3 worldPosition;
      varying vec3 viewPosition;
      varying vec3 viewNormal;
      varying float cellVisibility;

      #ifdef GROUND_LIGHT
        uniform sampler2D groundLightMask;
        uniform int groundLightCount;
        uniform vec3 groundLightSpots[${groundLightSpots.length}];

        float groundLight(vec3 normal) {
          float light = 0.0;
          for (int i = 0; i < ${groundLightSpots.length}; i++) {
            if (i >= groundLightCount) break;
            vec3 spot = groundLightSpots[i];
            vec2 offset = (worldPosition.xz - spot.xy) / spot.z;
            if (dot(offset, offset) < 1.0) {
              light = max(light, texture2D(groundLightMask, offset * 0.5 + 0.5).r);
            }
          }
          vec3 up = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
          return light * smoothstep(0.5, 0.95, dot(normal, up));
        }
      #endif

      void main() {
        vec3 normal = normalize(viewNormal);
        vec3 eveningLight = normalize(mat3(viewMatrix) * vec3(-0.71, 0.48, 0.51));
        float tone = 0.21 + 0.36 * max(dot(normal, eveningLight), 0.0) + bias;

        float directLight = 0.0;
        #if NUM_POINT_LIGHTS > 0
          for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            IncidentLight incident;
            getPointLightInfo(pointLights[i], viewPosition, incident);
            float luminance = dot(incident.color, vec3(0.2126, 0.7152, 0.0722));
            directLight += luminance * max(dot(normal, incident.direction), 0.0);
          }
        #endif

        #ifdef GROUND_LIGHT
          tone += 0.32 * groundLight(normal) + 0.07 * directLight;
        #else
          tone += 0.38 * directLight;
        #endif

        vec3 grainCell = floor((worldPosition + 0.004) * 14.0);
        float grain = fract(sin(dot(grainCell, vec3(31.71, 91.37, 47.11))) * 4375.19);
        tone += (grain - 0.5) * 0.035;

        if (glow >= 0.0) {
          tone = glow + 0.09 * max(dot(normal, eveningLight), 0.0);
        }

        float fogTone = glow >= 0.0 ? 0.05 : 0.055 + 0.43 * tone;
        tone = mix(fogTone, tone, cellVisibility);
        gl_FragColor = vec4(clamp(tone, 0.0, 1.0), familyId, cellVisibility, 1.0);
      }
    `,
  });
}

function applyPalettes(pass) {
  const shader = pass.pixelatedMaterial;
  const shades = Object.values(palettes).flat();
  shader.uniforms.swatches = {
    value: shades.map((color) => {
      const rgb = Number.parseInt(color.slice(1), 16);
      return new THREE.Vector3(rgb >> 16, (rgb >> 8) & 255, rgb & 255).divideScalar(255);
    }),
  };

  const edgeOutput = 'gl_FragColor = texel * Strength;';
  if (!shader.fragmentShader.includes(edgeOutput)) {
    throw new Error('RenderPixelatedPass shader output changed');
  }

  const shadeCount = palettes.stone.length;
  shader.fragmentShader = /* glsl */ `
    uniform vec3 swatches[${shades.length}];

    float bayer2(vec2 point) {
      vec2 bit = mod(floor(point), 2.0);
      return bit.x * 2.0 + bit.y * 3.0 - bit.x * bit.y * 4.0;
    }

    float bayer4(vec2 point) {
      float rank = 4.0 * bayer2(point) + bayer2(point * 0.5);
      return (rank + 0.5) / 16.0 - 0.5;
    }
  ` + shader.fragmentShader.replace(edgeOutput, /* glsl */ `
    int family = int(texel.g + 0.5);
    if (family == 0) {
      gl_FragColor = vec4(23.0, 22.0, 34.0, 255.0) / 255.0;
      return;
    }

    float tone = texel.r + (Strength - 1.0) * mix(0.30, 0.62, texel.b);
    float dither = bayer4(gl_FragCoord.xy) * mix(0.16, 0.37, texel.b);
    int shade = int(clamp(floor(tone * ${shadeCount - 1}.0 + 0.5 + dither), 0.0, ${shadeCount - 1}.0));
    gl_FragColor = vec4(swatches[(family - 1) * ${shadeCount} + shade], 1.0);
  `);
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000);

  const scene = new THREE.Scene();
  const fireLights = braziers.map(({ x, y, z, scale }) => {
    const light = new THREE.PointLight(0xffbd85, fireIntensity * scale, 5.5 * scale, 2);
    light.position.set(x, y + 1.28 * scale, z);
    scene.add(light);
    return { light, scale };
  });
  const halfHeight = 5.35;
  const halfWidth = halfHeight * width / height;
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 300);
  camera.position.set(12, 11.2, 15);
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0.95, -0.25);
  orbit.enablePan = false;
  orbit.enableZoom = false;
  orbit.minPolarAngle = THREE.MathUtils.degToRad(59);
  orbit.maxPolarAngle = THREE.MathUtils.degToRad(70);
  orbit.update();
  orbit.saveState();

  const legacyRoom = new THREE.Group();
  scene.add(legacyRoom);
  const animateFire = buildRoom(legacyRoom, material);
  const board = new THREE.Group();
  const pawn = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), material('ember', 0, { glow: 0.9 }));
  const pawnBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.55), material('ember', 0, { glow: 0.52 }));
  scene.add(board, pawn, pawnBase);
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const tiles = new Map();
  const terrainMaterials = {
    stone: { visible: material('stone', 0.08), fog: material('stone', 0, { glow: 0.04 }) },
    moss: { visible: material('moss', 0.1), fog: material('moss', 0, { glow: 0.04 }) },
  };
  const targetMaterial = material('moss', 0, { glow: 0.9 });
  const memoryMaterial = material('stone', 0, { glow: 0.55 });
  memoryMaterial.wireframe = true;
  const targetGeometry = new THREE.OctahedronGeometry(0.33);
  const memoryGeometry = new THREE.BoxGeometry(0.72, 0.18, 0.72);
  let boardVersion;
  let classic;
  let focusSelf = false;
  const ownPosition = new THREE.Vector3();
  const focusButton = document.querySelector('#focus-self');
  const overviewButton = document.querySelector('#map-overview');
  function focusOnSelf() {
    const offset = camera.position.clone().sub(orbit.target);
    orbit.target.copy(ownPosition);
    camera.position.copy(ownPosition).add(offset);
    orbit.update();
    canvas.dataset.cameraMode = 'follow';
    viewChanged = true;
  }
  focusButton.addEventListener('click', () => {
    focusSelf = true;
    camera.zoom = 3.2;
    camera.updateProjectionMatrix();
    focusOnSelf();
  });
  overviewButton.addEventListener('click', () => { focusSelf = false; orbit.reset(); canvas.dataset.cameraMode = 'overview'; });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2 || event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey)) { focusSelf = false; canvas.dataset.cameraMode = 'free'; }
  });
  mountGame((view) => {
    const isClassic = view.exploration === 'player-vision';
    const cellSize = isClassic ? classicCellSize : 1;
    const x = (col) => (col - (view.board.cols - 1) / 2) * cellSize;
    const z = (row) => (row - (view.board.rows - 1) / 2) * cellSize;
    if (boardVersion !== view.board.version) {
      classic?.dispose();
      classic = undefined;
      for (const mesh of board.children) mesh.geometry?.dispose();
      board.clear();
      tiles.clear();
      legacyRoom.visible = !isClassic;
      for (const { light } of fireLights) light.visible = !isClassic;
      focusButton.hidden = overviewButton.hidden = !isClassic;
      focusSelf = false;
      if (isClassic) {
        classic = buildClassicScene(material);
        board.add(classic.group);
        const halfHeight = Math.max(view.board.rows, view.board.cols) * classicCellSize * 0.44;
        camera.left = -halfHeight * width / height;
        camera.right = halfHeight * width / height;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.zoom = 1;
        camera.position.set(48, 52, 60);
        orbit.target.set(0, 0.6, 0);
        orbit.enableZoom = true;
        orbit.minZoom = 1;
        orbit.maxZoom = 9;
        orbit.enablePan = true;
        camera.updateProjectionMatrix();
        orbit.update();
        orbit.saveState();
        focusSelf = true;
        camera.zoom = 3.2;
        camera.updateProjectionMatrix();
        document.querySelector('h1').textContent = '黑暗森林 · 经典地图';
      } else {
        for (const cell of view.board.cells) {
          const tile = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.06, 0.94), terrainMaterials[cell.terrain].fog);
          tile.position.set(x(cell.col), 0.12, z(cell.row));
          tiles.set(`${cell.row},${cell.col}`, { tile, terrain: cell.terrain });
          board.add(tile);
        }
        for (const edge of view.board.edges) {
          const horizontal = edge.a.row !== edge.b.row;
          const height = edge.kind === 'wall' ? 0.5 : 0.28;
          const cue = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 0.9 : 0.1, height, horizontal ? 0.1 : 0.9),
            material(edge.kind === 'door' ? 'ember' : 'stone', 0, { glow: edge.kind === 'window' ? 0.55 : 0.25 }));
          cue.position.set(x((edge.a.col + edge.b.col) / 2), 0.18 + height / 2, z((edge.a.row + edge.b.row) / 2));
          if (edge.kind === 'window') cue.material.wireframe = true;
          board.add(cue);
        }
      }
      boardVersion = view.board.version;
    }
    classic?.update(view);
    if (classic?.groundLightSpots) setGroundLights(classic.groundLightSpots);
    const visible = new Set(view.observation.cells.map((c) => `${c.row},${c.col}`));
    for (const [key, { tile, terrain }] of tiles) tile.material = terrainMaterials[terrain][visible.has(key) ? 'visible' : 'fog'];
    dynamic.clear();
    for (const player of view.observation.players) {
      const target = new THREE.Mesh(targetGeometry, targetMaterial);
      target.position.set(x(player.position.col), isClassic ? 1.1 : 0.65, z(player.position.row));
      target.scale.setScalar(isClassic ? 1.8 : 1);
      dynamic.add(target);
    }
    for (const sighting of view.memory) {
      if (view.observation.players.some((p) => p.id === sighting.id)) continue;
      const marker = new THREE.Mesh(memoryGeometry, memoryMaterial);
      marker.position.set(x(sighting.position.col), 0.3, z(sighting.position.row));
      marker.scale.setScalar(isClassic ? 1.8 : 1);
      dynamic.add(marker);
    }
    pawn.position.set(x(view.self.position.col), isClassic ? 1.1 : 0.65, z(view.self.position.row));
    pawn.scale.setScalar(isClassic ? 1.8 : 1);
    pawnBase.scale.setScalar(isClassic ? 1.8 : 1);
    ownPosition.set(pawn.position.x, 0.6, pawn.position.z);
    if (focusSelf) focusOnSelf();
    pawnBase.position.set(pawn.position.x, 0.25, pawn.position.z);
    canvas.dataset.mapView = isClassic ? 'classic' : 'legacy';
    canvas.dataset.round = String(view.round);
    canvas.dataset.position = `${view.self.position.row},${view.self.position.col}`;
    canvas.dataset.visiblePlayers = view.observation.players.map((p) => p.id).join(',');
    canvas.dataset.visibleCells = String(visible.size);
    canvas.dataset.memoryCells = (view.mapMemory?.cells ?? []).map(c => `${c.row},${c.col}`).join(';');
    canvas.dataset.rememberedCells = (view.mapMemory?.cells ?? []).filter(c => !visible.has(`${c.row},${c.col}`)).map(c => `${c.row},${c.col}`).join(';');
    canvas.dataset.layoutCells = view.board.cells.map(c => `${c.row},${c.col}`).join(';');
    canvas.dataset.layoutEdges = view.board.edges.map(e => e.id).join(';');
    canvas.dataset.cameraMode = isClassic ? (focusSelf ? 'follow' : canvas.dataset.cameraMode ?? 'overview') : 'legacy';
    canvas.setAttribute('aria-label', `${isClassic ? '探索棋盘' : '公开棋盘'}，自己的棋子位于行 ${view.self.position.row} 列 ${view.self.position.col}。当前可见 ${visible.size} 格、${view.observation.players.length} 名目标。已探索记忆 ${(view.mapMemory?.cells.length ?? 0) - (view.mapMemory ? visible.size : 0)} 格。拖动或按方向键旋转视角。`);
    viewChanged = true;
  });
  const edges = { normalEdgeStrength: 0.14, depthEdgeStrength: 0.22 };
  // The canvas is already the low-resolution target. CSS scales the completed frame.
  const pass = new RenderPixelatedPass(1, scene, camera, edges);
  applyPalettes(pass);
  pass.setSize(width, height);
  pass.renderToScreen = true;

  function draw(time) {
    for (const [index, { light, scale }] of fireLights.entries()) {
      const phase = index * 1.7;
      light.intensity = fireIntensity * scale * (1 + 0.08 * Math.sin(time * 9 + phase) + 0.05 * Math.sin(time * 17.9));
    }
    animateFire(time);
    classic?.animate?.(time);
    pass.render(renderer, null);
  }

  function fitCanvas() {
    const fit = Math.min(stage.clientWidth / width, (window.innerHeight - 122) / height);
    const scale = Math.max(1, Math.floor(fit));
    canvas.style.width = `${width * scale}px`;
  }

  window.addEventListener('resize', fitCanvas);
  fitCanvas();
  let lastDraw = 0;
  let viewChanged = false;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  orbit.addEventListener('change', () => { viewChanged = true; });

  renderer.setAnimationLoop((milliseconds) => {
    const advanceFire = !motion.matches && milliseconds - lastDraw >= 1000 / 24;
    if (advanceFire) {
      lastDraw = milliseconds;
    }
    if (advanceFire || viewChanged) {
      viewChanged = false;
      draw(lastDraw / 1000);
    }
  });

  canvas.tabIndex = 0;
  const keyRotation = {
    ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
  };
  canvas.addEventListener('keydown', (event) => {
    const direction = keyRotation[event.key];
    if (!direction) return;
    event.preventDefault();
    const [left, up] = direction;
    const step = Math.PI / 36;
    if (left) orbit.rotateLeft(left * step);
    else orbit.rotateUp(up * step);
  });

  resetView.disabled = false;
  resetView.addEventListener('click', () => { focusSelf = false; orbit.reset(); canvas.dataset.cameraMode = 'overview'; });

  toggle.disabled = false;
  toggle.addEventListener('click', () => {
    const enabled = toggle.getAttribute('aria-pressed') === 'false';
    toggle.setAttribute('aria-pressed', String(enabled));
    pass.normalEdgeStrength = enabled ? edges.normalEdgeStrength : 0;
    pass.depthEdgeStrength = enabled ? edges.depthEdgeStrength : 0;
    draw(lastDraw / 1000);
  });

  draw(0);
}

try {
  start();
} catch (cause) {
  error.hidden = false;
  error.textContent = '无法打开石室预览。请使用支持 WebGL 2 的浏览器。';
  console.error(cause);
}
