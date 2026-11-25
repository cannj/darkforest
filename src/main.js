import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { buildRoom, braziers } from './room.js';

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
const groundLightSpots = braziers.map(({ x, z, scale }) => new THREE.Vector3(x, z, 3.05 * scale));
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
    },
    vertexShader: /* glsl */ `
      varying vec3 worldPosition;
      varying vec3 viewPosition;
      varying vec3 viewNormal;

      void main() {
        vec4 positionInView = modelViewMatrix * vec4(position, 1.0);
        worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        viewPosition = positionInView.xyz;
        viewNormal = normalMatrix * normal;
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

      #ifdef GROUND_LIGHT
        uniform sampler2D groundLightMask;
        uniform vec3 groundLightSpots[${groundLightSpots.length}];

        float groundLight(vec3 normal) {
          float light = 0.0;
          for (int i = 0; i < ${groundLightSpots.length}; i++) {
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

        gl_FragColor = vec4(clamp(tone, 0.0, 1.0), familyId, 0.0, 1.0);
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

    float tone = texel.r + (Strength - 1.0) * 0.62;
    float dither = bayer4(gl_FragCoord.xy) * 0.37;
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
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 10, 40);
  camera.position.set(12, 11.2, 15);
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0.95, -0.25);
  orbit.enablePan = false;
  orbit.enableZoom = false;
  orbit.minPolarAngle = THREE.MathUtils.degToRad(59);
  orbit.maxPolarAngle = THREE.MathUtils.degToRad(70);
  orbit.update();
  orbit.saveState();

  const animateFire = buildRoom(scene, material);
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
  resetView.addEventListener('click', () => orbit.reset());

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
