import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

const app = document.querySelector('#app');
const hint = document.querySelector('#sceneHint');
const soundToggle = document.querySelector('#soundToggle');
const driftToggle = document.querySelector('#driftToggle');
const resetViewButton = document.querySelector('#resetView');
const statusTime = document.querySelector('#statusTime');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isCompact = window.matchMedia('(max-width: 760px)').matches;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tempVector = new THREE.Vector3();
const tempSpherical = new THREE.Spherical();
const clock = new THREE.Clock();

function getRenderScale(width = window.innerWidth) {
  const compact = width < 760;
  const minimum = compact ? 1.25 : 1.5;
  const maximum = compact ? 1.75 : 2;
  return Math.min(Math.max(window.devicePixelRatio || 1, minimum), maximum);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#04090c');
scene.fog = new THREE.FogExp2('#061018', 0.011);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(getRenderScale());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', '可拖动旋转、滚轮缩放的雨夜便利店三维场景');
renderer.domElement.tabIndex = 0;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.052;
controls.enablePan = false;
controls.minDistance = 9.5;
controls.maxDistance = 34;
controls.minPolarAngle = 0.78;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minAzimuthAngle = 0.1;
controls.maxAzimuthAngle = 0.72;
controls.rotateSpeed = 0.48;
controls.zoomSpeed = 0.72;

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.38;

const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  samples: isCompact ? 2 : 4
});
renderTarget.texture.name = 'Scene.rt';
const composer = new EffectComposer(renderer, renderTarget);
composer.setPixelRatio(getRenderScale());
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  isCompact ? 0.14 : 0.18,
  0.22,
  0.95
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const cinematicPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(
            window.innerWidth * getRenderScale(),
            window.innerHeight * getRenderScale()
          )
        },
        uGrain: { value: 0.008 },
        uVignette: { value: 0.2 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float radius = length(centered);
      vec3 color = texture2D(tDiffuse, vUv).rgb;

          vec2 texel = 1.0 / uResolution;
          vec3 blur = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
          blur += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
          blur += texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
          blur += texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
          color += (color - blur * 0.25) * 0.16;

          float grain = hash(vUv * uResolution + fract(uTime) * 731.0) - 0.5;
          color += grain * uGrain;

          float vignette = smoothstep(0.82, 0.26, radius);
      color *= mix(1.0 - uVignette, 1.0, vignette);

      float luma = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(luma), color, 1.06);
          color += vec3(-0.004, 0.002, 0.005) * (1.0 - luma);
          color += vec3(0.006, 0.002, -0.002) * luma;
      color = (color - 0.5) * 1.035 + 0.5;

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `
});
composer.addPass(cinematicPass);

function makeTexture(width, height, draw, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
  return texture;
}

function createAsphaltTexture() {
  return makeTexture(768, 768, (ctx, width, height) => {
    ctx.fillStyle = '#14191d';
    ctx.fillRect(0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 22;
      data[i] = Math.max(0, data[i] + noise);
      data[i + 1] = Math.max(0, data[i + 1] + noise);
      data[i + 2] = Math.max(0, data[i + 2] + noise);
    }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const size = Math.random() * 2.4 + 0.3;
      ctx.fillStyle = `rgba(190, 205, 207, ${Math.random() * 0.09})`;
      ctx.fillRect(x, y, size, size);
    }
    ctx.strokeStyle = 'rgba(3, 7, 9, 0.42)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      let x = Math.random() * width;
      let y = Math.random() * height;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (Math.random() - 0.5) * 48;
        y += Math.random() * 34;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { repeat: [7, 7] });
}

function createConcreteTexture() {
  return makeTexture(512, 512, (ctx, width, height) => {
    ctx.fillStyle = '#565954';
    ctx.fillRect(0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 28;
      data[i] += noise;
      data[i + 1] += noise;
      data[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = 'rgba(20, 24, 23, 0.32)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= height; y += 128) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let x = 0; x <= width; x += 170) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, { repeat: [6, 2] });
}

const asphaltTexture = createAsphaltTexture();
const concreteTexture = createConcreteTexture();

const signTexture = makeTexture(2048, 360, (ctx, width, height) => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#105455');
  gradient.addColorStop(0.55, '#0d4346');
  gradient.addColorStop(1, '#092f34');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255, 236, 197, 0.08)';
  ctx.fillRect(0, 0, width, 8);
  ctx.fillStyle = 'rgba(5, 18, 20, 0.44)';
  ctx.fillRect(0, height - 13, width, 13);
  ctx.strokeStyle = 'rgba(243, 220, 177, 0.48)';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  ctx.fillStyle = '#ffcf7f';
  ctx.fillRect(64, 76, 10, 208);
  ctx.fillStyle = '#fff3da';
  ctx.font = '600 190px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('日々屋', 122, 178);

  ctx.fillStyle = '#ffe4b6';
  ctx.font = '600 58px "Helvetica Neue", "Hiragino Sans", sans-serif';
  ctx.letterSpacing = '8px';
  ctx.fillText('HIBIYA MART', 760, 138);

  ctx.fillStyle = 'rgba(250, 237, 209, 0.9)';
  ctx.font = '500 34px "Helvetica Neue", "Hiragino Sans", sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('宵町三丁目店', 760, 202);

  ctx.fillStyle = '#ffc578';
  ctx.font = '600 28px "Helvetica Neue", "Hiragino Sans", sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('OPEN 24 HOURS', 1555, 169);
  ctx.fillStyle = 'rgba(119, 212, 200, 0.9)';
  ctx.beginPath();
  ctx.arc(1482, 168, 7, 0, Math.PI * 2);
  ctx.fill();
});

const bladeTexture = makeTexture(320, 1200, (ctx, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#071419';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e992ba';
  ctx.lineWidth = 8;
  ctx.shadowColor = '#ff84b8';
  ctx.shadowBlur = 28;
  ctx.strokeRect(14, 14, width - 28, height - 28);
  ctx.shadowBlur = 20;
  ctx.strokeStyle = '#77d4c8';
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, width - 64, height - 64);
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#f7b3d0';
  ctx.font = '600 130px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['宵', '町', '通', 'り'].forEach((letter, index) => {
    ctx.fillText(letter, width / 2, 190 + index * 220);
  });
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#8ee0d4';
  ctx.font = '500 22px "Helvetica Neue", sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('YOIMACHI', width / 2, 1090);
});

const vendingTexture = makeTexture(512, 1024, (ctx, width, height) => {
  ctx.fillStyle = '#102329';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0b4f52';
  ctx.fillRect(0, 0, width, 104);
  ctx.fillStyle = '#bdf4e8';
  ctx.font = '600 34px "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '7px';
  ctx.fillText('DRINKS', width / 2, 67);

  ctx.fillStyle = '#e8f8ee';
  ctx.fillRect(34, 132, width - 68, 584);
  ctx.fillStyle = '#0a1b20';
  ctx.fillRect(50, 148, width - 100, 552);
  const colors = ['#f3c86e', '#8ad5ca', '#e47a62', '#e8e0b5', '#77a9c8', '#d393b8', '#9ec886'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 78 + col * 75;
      const y = 174 + row * 127;
      ctx.fillStyle = 'rgba(229, 245, 232, 0.18)';
      ctx.fillRect(x - 11, y + 76, 62, 4);
      ctx.fillStyle = colors[(row * 5 + col) % colors.length];
      ctx.beginPath();
      ctx.roundRect(x, y, 40, 78, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 250, 225, 0.78)';
      ctx.fillRect(x + 6, y + 24, 28, 9);
      ctx.fillStyle = 'rgba(8, 23, 26, 0.55)';
      ctx.fillRect(x + 11, y + 44, 18, 4);
    }
  }

  ctx.fillStyle = '#0a1b20';
  ctx.fillRect(34, 748, width - 68, 126);
  ctx.fillStyle = '#76d6c7';
  ctx.font = '600 44px "Helvetica Neue", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('¥ 130', 62, 826);
  ctx.fillStyle = '#f3c86e';
  ctx.fillRect(366, 774, 76, 74);
  ctx.fillStyle = '#102329';
  ctx.font = '600 25px "Helvetica Neue", sans-serif';
  ctx.fillText('HOT', 377, 820);

  ctx.fillStyle = '#d95f4d';
  ctx.fillRect(34, 900, width - 68, 78);
  ctx.fillStyle = '#fff0d1';
  ctx.font = '600 30px "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '3px';
  ctx.fillText('つめたい / あたたかい', width / 2, 950);
});

const posterTexture = makeTexture(640, 900, (ctx, width, height) => {
  ctx.fillStyle = '#eadfc8';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#c55d48';
  ctx.fillRect(0, 0, width, 126);
  ctx.fillStyle = '#fff1d0';
  ctx.font = '600 54px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.fillText('今夜のできたて', width / 2, 82);

  ctx.fillStyle = '#c9854d';
  ctx.beginPath();
  ctx.ellipse(width / 2, 410, 175, 160, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4e9ca';
  ctx.beginPath();
  ctx.ellipse(width / 2, 418, 132, 124, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d3a36';
  ctx.beginPath();
  ctx.ellipse(width / 2, 420, 38, 44, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI / 9;
    ctx.fillStyle = '#315e4d';
    ctx.beginPath();
    ctx.arc(width / 2 + Math.cos(angle) * 86, 420 + Math.sin(angle) * 78, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#324b48';
  ctx.font = '600 48px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.fillText('おむすびとおでん', width / 2, 710);
  ctx.fillStyle = '#b85d4b';
  ctx.font = '500 32px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.fillText('夜の小さなごほうび', width / 2, 780);
  ctx.fillStyle = '#6f7569';
  ctx.font = '400 22px "Helvetica Neue", sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('HIBIYA MART', width / 2, 842);
});

const menuTexture = makeTexture(720, 420, (ctx, width, height) => {
  ctx.fillStyle = '#f3e6ca';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0b4f51';
  ctx.fillRect(0, 0, width, 86);
  ctx.fillStyle = '#f7e9c9';
  ctx.font = '600 40px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.fillText('今夜のあたたかいもの', width / 2, 60);
  ctx.fillStyle = '#294b48';
  ctx.font = '600 48px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.fillText('おでん　五種盛り', width / 2, 192);
  ctx.fillStyle = '#c25d49';
  ctx.font = '600 72px "Helvetica Neue", sans-serif';
  ctx.fillText('¥ 398', width / 2, 300);
  ctx.fillStyle = '#56665d';
  ctx.font = '400 28px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.fillText('大根・たまご・こんにゃく', width / 2, 364);
});

const decalTexture = makeTexture(512, 512, (ctx, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(248, 236, 207, 0.88)';
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, width - 44, height - 44);
  ctx.fillStyle = 'rgba(248, 236, 207, 0.92)';
  ctx.font = '600 104px "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('24H', width / 2, 208);
  ctx.font = '500 39px "Helvetica Neue", sans-serif';
  ctx.letterSpacing = '9px';
  ctx.fillText('OPEN', width / 2, 284);
  ctx.font = '400 27px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.letterSpacing = '2px';
  ctx.fillText('コーヒー・ATM・コピー', width / 2, 356);
});

const streetSignTexture = makeTexture(720, 220, (ctx, width, height) => {
  ctx.fillStyle = '#155458';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(242, 226, 190, 0.78)';
  ctx.lineWidth = 5;
  ctx.strokeRect(13, 13, width - 26, height - 26);
  ctx.fillStyle = '#f1dfb6';
  ctx.font = '600 76px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.fillText('宵町通り  →', width / 2, 139);
});

const glowTexture = makeTexture(256, 256, (ctx, width, height) => {
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.18, 'rgba(255, 244, 210, 0.44)');
  gradient.addColorStop(0.52, 'rgba(255, 223, 160, 0.12)');
  gradient.addColorStop(1, 'rgba(255, 223, 160, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
});

const contactTexture = makeTexture(256, 256, (ctx, width, height) => {
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.34)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
});

const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color('#02060a') },
    horizonColor: { value: new THREE.Color('#0b1b22') },
    bottomColor: { value: new THREE.Color('#020507') }
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition).y;
      vec3 lower = mix(bottomColor, horizonColor, smoothstep(-0.35, 0.08, h));
      vec3 color = mix(lower, topColor, smoothstep(0.02, 0.72, h));
      gl_FragColor = vec4(color, 1.0);
    }
  `
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(82, 40, 20), skyMaterial));

const asphaltMaterial = new THREE.MeshPhysicalMaterial({
  color: '#293235',
  map: asphaltTexture,
  roughness: 0.34,
  metalness: 0.24,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  envMapIntensity: 1.3,
  clearcoat: 0.8,
  clearcoatRoughness: 0.12
});
const concreteMaterial = new THREE.MeshPhysicalMaterial({
  color: '#666861',
  map: concreteTexture,
  roughness: 0.42,
  metalness: 0.08,
  clearcoat: 0.36,
  clearcoatRoughness: 0.3,
  envMapIntensity: 0.7
});
const wallMaterial = new THREE.MeshStandardMaterial({
  color: '#d6cfbc',
  roughness: 0.68,
  metalness: 0.02
});
const wallSideMaterial = new THREE.MeshStandardMaterial({
  color: '#b9b5a7',
  roughness: 0.74,
  metalness: 0.03
});
const tealMaterial = new THREE.MeshStandardMaterial({
  color: '#0b4d4f',
  roughness: 0.36,
  metalness: 0.18
});
const darkTealMaterial = new THREE.MeshStandardMaterial({
  color: '#082d31',
  roughness: 0.3,
  metalness: 0.24
});
const trimMaterial = new THREE.MeshStandardMaterial({
  color: '#2b3e40',
  roughness: 0.28,
  metalness: 0.58
});
const creamMaterial = new THREE.MeshStandardMaterial({
  color: '#e5dcc7',
  roughness: 0.54,
  metalness: 0.04
});
const darkMaterial = new THREE.MeshStandardMaterial({
  color: '#11191d',
  roughness: 0.52,
  metalness: 0.26
});
const blackMaterial = new THREE.MeshStandardMaterial({
  color: '#070b0d',
  roughness: 0.62,
  metalness: 0.12
});
const metalMaterial = new THREE.MeshStandardMaterial({
  color: '#697778',
  roughness: 0.24,
  metalness: 0.8,
  envMapIntensity: 1.4
});
const warmLightMaterial = new THREE.MeshBasicMaterial({
  color: '#ffc77d',
  toneMapped: false
});
const coolLightMaterial = new THREE.MeshBasicMaterial({
  color: '#7ce0d2',
  toneMapped: false
});
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#b9d2cf',
  roughness: 0.03,
  metalness: 0.04,
  transparent: true,
  opacity: 0.055,
  depthWrite: false,
  side: THREE.DoubleSide,
  envMapIntensity: 1.5,
  clearcoat: 1,
  clearcoatRoughness: 0.03
});
const interiorFloorMaterial = new THREE.MeshStandardMaterial({
  color: '#c5bca7',
  roughness: 0.46,
  metalness: 0.05
});
const interiorCeilingMaterial = new THREE.MeshStandardMaterial({
  color: '#d8ceb9',
  roughness: 0.7,
  metalness: 0.02,
  emissive: '#2a1d0d',
  emissiveIntensity: 0.25
});
const whiteLineMaterial = new THREE.MeshStandardMaterial({
  color: '#6c6e66',
  roughness: 0.42,
  metalness: 0.18
});

const geometryCache = new Map();
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const planeGeometry = new THREE.PlaneGeometry(1, 1);

function roundedGeometry(width, height, depth, radius = 0.05) {
  const key = `${width}|${height}|${depth}|${radius}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new RoundedBoxGeometry(width, height, depth, 4, radius));
  }
  return geometryCache.get(key);
}

function box(parent, x, y, z, sx, sy, sz, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function roundedBox(parent, x, y, z, sx, sy, sz, material, radius = 0.05, cast = true, receive = true) {
  const mesh = new THREE.Mesh(roundedGeometry(sx, sy, sz, radius), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function horizontalPlane(parent, x, y, z, sx, sz, material, rotation = 0) {
  const mesh = new THREE.Mesh(planeGeometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.scale.set(sx, sz, 1);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function verticalPlane(parent, x, y, z, sx, sy, material) {
  const mesh = new THREE.Mesh(planeGeometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, 1);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, x, y, z, radiusTop, radiusBottom, height, material, segments = 12, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rod(parent, from, to, radius, material, segments = 8) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function line(parent, points, color = '#142126', opacity = 0.8) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const object = new THREE.Line(geometry, material);
  parent.add(object);
  return object;
}

function cable(parent, points, color = '#070c0f', radius = 0.018, segments = 36) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.25 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addContactShadow(parent, x, z, sx, sz, opacity = 0.52, y = 0.021) {
  const material = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity,
    depthWrite: false,
    color: '#000000'
  });
  const mesh = new THREE.Mesh(planeGeometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(sx, sz, 1);
  parent.add(mesh);
  return mesh;
}

function addGlowSprite(parent, x, y, z, scale, color, opacity = 0.32) {
  const material = new THREE.SpriteMaterial({
    map: glowTexture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(scale, scale, 1);
  parent.add(sprite);
  return sprite;
}

const roadReflector = new Reflector(new THREE.PlaneGeometry(52, 18), {
  clipBias: 0.003,
  textureWidth: isCompact ? 640 : 1280,
  textureHeight: isCompact ? 640 : 1280,
  color: 0x26383d
});
roadReflector.rotation.x = -Math.PI / 2;
roadReflector.position.set(0, 0.008, 9.5);
scene.add(roadReflector);

const roadSurface = new THREE.Mesh(new THREE.PlaneGeometry(52, 18), asphaltMaterial);
roadSurface.rotation.x = -Math.PI / 2;
roadSurface.position.set(0, 0.014, 9.5);
roadSurface.receiveShadow = true;
scene.add(roadSurface);

box(scene, 0, 0.08, 1.82, 34, 0.16, 3.64, concreteMaterial, false, true);
box(scene, 0, 0.15, 3.67, 34, 0.2, 0.24, creamMaterial, false, true);
box(scene, 0, 0.12, 0.02, 34, 0.24, 0.2, darkMaterial, false, true);

for (let i = 0; i < 9; i++) {
  const stripe = box(scene, -9.2 + i * 0.82, 0.023, 5.25, 0.46, 0.012, 3.15, whiteLineMaterial, false, false);
  stripe.rotation.y = -0.08;
}
for (let i = 0; i < 5; i++) {
  box(scene, 7.5, 0.022, 5.6 + i * 1.8, 0.13, 0.012, 0.92, whiteLineMaterial, false, false);
}
box(scene, 0.3, 0.024, 12.2, 27, 0.012, 0.14, whiteLineMaterial, false, false);

const manholeMaterial = new THREE.MeshStandardMaterial({
  color: '#3f4848',
  roughness: 0.32,
  metalness: 0.65
});
const manhole = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.035, 32), manholeMaterial);
manhole.position.set(4.8, 0.027, 7.9);
manhole.receiveShadow = true;
scene.add(manhole);
for (let i = 0; i < 6; i++) {
  box(scene, 4.8, 0.05, 7.9 - 0.42 + i * 0.17, 1.08, 0.012, 0.045, darkMaterial, false, false);
}

const puddleMaterial = new THREE.MeshPhysicalMaterial({
  color: '#31515a',
  roughness: 0.05,
  metalness: 0.48,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  envMapIntensity: 1.8
});
const puddleData = [
  [-6.6, 5.1, 1.4, 0.55, -0.12],
  [-2.2, 7.3, 2.2, 0.74, 0.08],
  [1.3, 5.5, 1.15, 0.48, -0.18],
  [5.8, 6.2, 1.9, 0.6, 0.14],
  [8.2, 10.4, 2.5, 0.8, -0.08],
  [-10.2, 9.2, 2.8, 0.7, 0.05],
  [3.1, 12.3, 1.7, 0.5, 0.16]
];
puddleData.forEach(([x, z, sx, sz, rotation]) => {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), puddleMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.position.set(x, 0.031, z);
  mesh.scale.set(sx, sz, 1);
  scene.add(mesh);
});

const rippleMaterial = new THREE.MeshBasicMaterial({
  color: '#b2d7d2',
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending
});
const ripples = [];
for (let i = 0; i < 24; i++) {
  const source = puddleData[i % puddleData.length];
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 32), rippleMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(
    source[0] + (Math.random() - 0.5) * source[2] * 0.7,
    0.038 + i * 0.0002,
    source[1] + (Math.random() - 0.5) * source[3] * 0.7
  );
  scene.add(ring);
  ripples.push({
    mesh: ring,
    phase: Math.random(),
    speed: 0.19 + Math.random() * 0.2,
    strength: 1.4 + Math.random() * 2.1
  });
}

const buildingMaterial = new THREE.MeshStandardMaterial({
  color: '#111a1e',
  roughness: 0.86,
  metalness: 0.08
});
const buildingEdgeMaterial = new THREE.MeshStandardMaterial({
  color: '#1e2a2d',
  roughness: 0.75,
  metalness: 0.12
});

const distantBuildings = new THREE.Group();
scene.add(distantBuildings);
const distantSpecs = [
  [-15, 7, -10, 7, 14, 9],
  [-7.5, 5.5, -11, 5.5, 11, 8],
  [3.5, 6, -12, 7, 12, 7],
  [12.5, 8, -9, 8, 16, 9],
  [20, 5.5, -5, 7, 11, 10]
];
distantSpecs.forEach(([x, y, z, w, h, d]) => {
  box(distantBuildings, x, y, z, w, h, d, buildingMaterial, false, true);
  box(distantBuildings, x, y + h / 2 + 0.1, z, w + 0.18, 0.18, d + 0.18, buildingEdgeMaterial, false, false);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (Math.random() > 0.42) continue;
      const windowMaterial = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.7 ? '#ffc984' : '#6d9e9f',
        transparent: true,
        opacity: 0.35 + Math.random() * 0.35,
        toneMapped: false
      });
      const windowMesh = new THREE.Mesh(planeGeometry, windowMaterial);
      windowMesh.position.set(
        x - w * 0.34 + col * (w * 0.22),
        y - h * 0.3 + row * (h * 0.18),
        z + d / 2 + 0.012
      );
      windowMesh.scale.set(0.46, 0.58, 1);
      distantBuildings.add(windowMesh);
    }
  }
});

const leftBuilding = new THREE.Group();
leftBuilding.position.set(-10.7, 0, -2.9);
scene.add(leftBuilding);
box(leftBuilding, 0, 5.4, 0, 6.2, 10.8, 8.8, buildingMaterial, true, true);
box(leftBuilding, 0, 10.85, 0, 6.5, 0.22, 9.1, buildingEdgeMaterial, false, true);
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 3; col++) {
    if ((row + col) % 4 === 1) continue;
    const lit = Math.random() > 0.58;
    const material = new THREE.MeshBasicMaterial({
      color: lit ? '#d9b579' : '#2c4b50',
      transparent: true,
      opacity: lit ? 0.42 : 0.24,
      toneMapped: false
    });
    const windowMesh = new THREE.Mesh(planeGeometry, material);
    windowMesh.position.set(-1.72 + col * 1.72, 2.2 + row * 1.55, 4.412);
    windowMesh.scale.set(0.86, 0.94, 1);
    leftBuilding.add(windowMesh);
  }
}
box(leftBuilding, 1.8, 7.4, 4.46, 0.08, 4.8, 0.08, metalMaterial, false, false);
const leftBladeTexture = makeTexture(260, 800, (ctx, width, height) => {
  ctx.fillStyle = '#081216';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d8b775';
  ctx.lineWidth = 5;
  ctx.strokeRect(12, 12, width - 24, height - 24);
  ctx.fillStyle = '#e7c987';
  ctx.font = '600 92px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ['喫', '茶', '灯'].forEach((letter, index) => {
    ctx.fillText(letter, width / 2, 210 + index * 210);
  });
});
const leftBlade = new THREE.Mesh(
  new THREE.PlaneGeometry(0.64, 2.2),
  new THREE.MeshBasicMaterial({ map: leftBladeTexture, toneMapped: false })
);
leftBlade.position.set(3.16, 6.2, 4.45);
leftBuilding.add(leftBlade);
addGlowSprite(leftBuilding, 3.2, 6.2, 4.6, 2.4, '#e3b66d', 0.16);

const rightBuilding = new THREE.Group();
rightBuilding.position.set(10.1, 0, -3.4);
scene.add(rightBuilding);
box(rightBuilding, 0, 4.8, 0, 5.6, 9.6, 8.4, buildingMaterial, true, true);
box(rightBuilding, 0, 9.65, 0, 5.9, 0.2, 8.7, buildingEdgeMaterial, false, true);
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 3; col++) {
    if ((row + col) % 3 === 0) continue;
    const material = new THREE.MeshBasicMaterial({
      color: row === 1 && col === 1 ? '#ffc17b' : '#26484d',
      transparent: true,
      opacity: row === 1 && col === 1 ? 0.5 : 0.22,
      toneMapped: false
    });
    const windowMesh = new THREE.Mesh(planeGeometry, material);
    windowMesh.position.set(-1.58 + col * 1.58, 2.05 + row * 1.55, 4.212);
    windowMesh.scale.set(0.74, 0.92, 1);
    rightBuilding.add(windowMesh);
  }
}

const store = new THREE.Group();
store.position.set(-1.1, 0, 0);
scene.add(store);
const storeWidth = 9.8;
const storeDepth = 4.2;
const frontZ = 0.38;
const backZ = frontZ - storeDepth;

box(store, -storeWidth / 2, 2.08, backZ + storeDepth / 2, 0.18, 4.16, storeDepth, wallSideMaterial, true, true);
box(store, storeWidth / 2, 2.08, backZ + storeDepth / 2, 0.18, 4.16, storeDepth, wallSideMaterial, true, true);
box(store, 0, 2.08, backZ, storeWidth, 4.16, 0.18, wallSideMaterial, true, true);
box(store, 0, 4.16, backZ + storeDepth / 2, storeWidth + 0.62, 0.22, storeDepth + 0.62, darkTealMaterial, true, true);
box(store, 0, 4.0, backZ + storeDepth / 2, storeWidth + 0.18, 0.16, storeDepth + 0.18, tealMaterial, false, true);
box(store, 0, 0.1, backZ + storeDepth / 2, storeWidth, 0.2, storeDepth, interiorFloorMaterial, false, true);
box(store, 0, 3.39, backZ + storeDepth / 2, storeWidth - 0.18, 0.12, storeDepth - 0.18, interiorCeilingMaterial, false, true);
box(store, 0, 3.64, frontZ, storeWidth + 0.08, 0.54, 0.2, wallMaterial, true, true);
box(store, 0, 0.16, frontZ, storeWidth + 0.08, 0.26, 0.2, wallMaterial, true, true);

for (let i = 0; i < 10; i++) {
  box(store, -4.6 + i * 1.02, 2.08, backZ - 0.002, 0.035, 3.95, 0.02, trimMaterial, false, false);
}

box(store, 0, 3.76, frontZ + 0.13, storeWidth + 0.34, 0.72, 0.2, tealMaterial, true, true);
box(store, 0, 4.13, frontZ + 0.18, storeWidth + 0.48, 0.1, 0.36, trimMaterial, false, true);
const signMaterial = new THREE.MeshBasicMaterial({
  map: signTexture,
  toneMapped: false,
  color: '#ffffff'
});
const sign = new THREE.Mesh(new THREE.PlaneGeometry(storeWidth + 0.08, 0.62), signMaterial);
sign.position.set(0, 3.77, frontZ + 0.236);
store.add(sign);
const signLight = new THREE.PointLight('#8fe0d2', 6, 4.2, 2);
signLight.position.set(0, 3.75, 1.1);
store.add(signLight);

box(store, 0, 3.25, frontZ + 0.32, storeWidth + 0.32, 0.09, 0.68, darkTealMaterial, true, true);
box(store, 0, 3.19, frontZ + 0.67, storeWidth + 0.32, 0.05, 0.05, warmLightMaterial, false, false);
for (let i = 0; i < 13; i++) {
  const panel = new THREE.MeshStandardMaterial({
    color: i % 4 === 0 ? '#b4614e' : '#174d4e',
    roughness: 0.4,
    metalness: 0.12
  });
  box(store, -4.62 + i * 0.77, 3.18, frontZ + 0.56, 0.34, 0.026, 0.44, panel, false, false);
}

box(store, 0, 0.24, frontZ + 0.18, storeWidth + 0.1, 0.09, 0.48, trimMaterial, false, true);
box(store, 0, 3.37, frontZ + 0.16, storeWidth + 0.08, 0.08, 0.3, trimMaterial, false, true);
for (const x of [-4.9, -1.16, 1.16, 4.9]) {
  box(store, x, 1.79, frontZ + 0.18, 0.11, 3.12, 0.1, trimMaterial, false, true);
}
box(store, 0, 2.56, frontZ + 0.18, storeWidth + 0.02, 0.055, 0.08, trimMaterial, false, true);

for (const x of [-3.03, 3.03]) {
  const glass = box(store, x, 1.81, frontZ + 0.075, 3.65, 2.93, 0.06, glassMaterial, false, false);
  glass.renderOrder = 4;
  box(store, x, 1.81, frontZ + 0.19, 0.055, 2.93, 0.035, trimMaterial, false, false);
  box(store, x, 3.27, frontZ + 0.19, 3.65, 0.045, 0.035, trimMaterial, false, false);
  box(store, x, 0.34, frontZ + 0.19, 3.65, 0.055, 0.035, trimMaterial, false, false);
}

const glintMaterial = new THREE.MeshBasicMaterial({
  color: '#d8eee8',
  transparent: true,
  opacity: 0.13,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
for (const x of [-3.1, 3.1]) {
  const glint = verticalPlane(store, x + 0.78, 1.92, frontZ + 0.195, 0.56, 2.56, glintMaterial);
  glint.rotation.z = -0.07;
}

const decalMaterial = new THREE.MeshBasicMaterial({
  map: decalTexture,
  transparent: true,
  depthWrite: false,
  opacity: 0.86
});
verticalPlane(store, -3.85, 2.1, frontZ + 0.196, 1.04, 1.04, decalMaterial).renderOrder = 5;
verticalPlane(store, 3.62, 1.68, frontZ + 0.196, 0.88, 0.88, decalMaterial).renderOrder = 5;

const posterMaterial = new THREE.MeshBasicMaterial({ map: posterTexture, toneMapped: false });
const windowPoster = verticalPlane(store, 2.08, 1.78, frontZ + 0.198, 0.92, 1.29, posterMaterial);
windowPoster.renderOrder = 5;
box(store, 2.08, 1.78, frontZ + 0.16, 1.04, 1.41, 0.03, creamMaterial, false, false);

const doorLeft = new THREE.Group();
const doorRight = new THREE.Group();
doorLeft.position.set(-0.52, 0, 0);
doorRight.position.set(0.52, 0, 0);
store.add(doorLeft, doorRight);

function buildDoor(group, handleSide) {
  const glass = box(group, 0, 1.82, frontZ + 0.075, 0.9, 2.83, 0.06, glassMaterial, false, false);
  glass.renderOrder = 4;
  box(group, 0, 1.82, frontZ + 0.18, 0.052, 2.86, 0.045, trimMaterial, false, false);
  box(group, 0, 3.25, frontZ + 0.18, 0.9, 0.05, 0.045, trimMaterial, false, false);
  box(group, 0, 0.39, frontZ + 0.18, 0.9, 0.055, 0.045, trimMaterial, false, false);
  box(group, handleSide * 0.33, 1.54, frontZ + 0.225, 0.03, 0.62, 0.03, metalMaterial, false, false);
  verticalPlane(group, 0, 2.2, frontZ + 0.197, 0.72, 0.36, new THREE.MeshBasicMaterial({
    map: decalTexture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  })).renderOrder = 5;
}
buildDoor(doorLeft, 1);
buildDoor(doorRight, -1);

box(store, 0, 0.06, frontZ + 0.64, 2.3, 0.06, 1.0, darkMaterial, false, true);
const doormatTexture = makeTexture(560, 180, (ctx, width, height) => {
  ctx.fillStyle = '#1b2a2b';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(219, 198, 153, 0.55)';
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, width - 20, height - 20);
  ctx.fillStyle = '#d6c49b';
  ctx.font = '500 56px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.fillText('いらっしゃいませ', width / 2, 112);
});
const doormat = horizontalPlane(
  store,
  0,
  0.092,
  frontZ + 0.64,
  1.72,
  0.52,
  new THREE.MeshBasicMaterial({ map: doormatTexture, toneMapped: false })
);
doormat.rotation.z = 0;

for (let i = 0; i < 8; i++) {
  box(store, -4.2 + i * 1.05, 3.33, frontZ - 0.62, 0.68, 0.035, 0.22, warmLightMaterial, false, false);
}

const interiorLight = new THREE.PointLight('#ffc37a', 12, 9, 1.9);
interiorLight.position.set(-0.3, 2.9, -0.9);
interiorLight.castShadow = false;
store.add(interiorLight);
const backLight = new THREE.PointLight('#ffb45f', 6, 6, 2);
backLight.position.set(2.5, 2.3, -2.9);
store.add(backLight);
const frontSpill = new THREE.SpotLight('#ffc985', 16, 13, Math.PI * 0.28, 0.8, 1.6);
frontSpill.position.set(0, 3.0, 1.0);
frontSpill.target.position.set(0, 0, 6.4);
frontSpill.castShadow = false;
store.add(frontSpill, frontSpill.target);

const productPalette = ['#e3b46a', '#cb6a56', '#83aaa4', '#e8dab6', '#b47d8e', '#9eb978', '#6f9cb2'];
const productMaterials = productPalette.map(color => new THREE.MeshStandardMaterial({
  color,
  roughness: 0.5,
  metalness: 0.03
}));

const shelfBackMaterial = new THREE.MeshStandardMaterial({
  color: '#4a4c46',
  roughness: 0.78,
  metalness: 0.06
});
const shelfRailMaterial = new THREE.MeshStandardMaterial({
  color: '#d6cdb8',
  roughness: 0.55,
  metalness: 0.08
});
const productAccentMaterials = ['#f0d59b', '#d8e5d5', '#e7b0a1', '#aacbd0'].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.03 })
);

function shelfUnit(x, z, width, height, depth, levels, seed = 0) {
  const baseY = 0.22;
  const shelfGap = (height - 0.5) / levels;

  box(store, x, baseY, z, width, 0.16, depth, trimMaterial, true, true);
  box(store, x, baseY + height * 0.5, z - depth * 0.46, width - 0.06, height - 0.2, 0.045, shelfBackMaterial, false, true);
  box(store, x, baseY + height - 0.02, z, width + 0.06, 0.08, depth + 0.04, trimMaterial, true, true);

  for (const side of [-1, 1]) {
    box(
      store,
      x + side * (width * 0.5 - 0.035),
      baseY + height * 0.5,
      z,
      0.07,
      height - 0.12,
      depth,
      trimMaterial,
      true,
      true
    );
  }

  for (let level = 0; level < levels; level++) {
    const y = baseY + 0.2 + level * shelfGap;
    box(store, x, y, z + depth * 0.06, width - 0.08, 0.045, depth * 0.9, shelfRailMaterial, false, true);
    box(store, x, y + 0.055, z + depth * 0.49, width - 0.08, 0.045, 0.035, creamMaterial, false, false);

    const columns = Math.max(6, Math.floor((width - 0.12) / 0.19));
    const spacing = (width - 0.22) / columns;
    const productHeightMax = Math.min(0.29, shelfGap - 0.105);

    for (let row = 0; row < 2; row++) {
      for (let item = 0; item < columns; item++) {
        const itemWidth = spacing * (0.72 + ((item + row + seed) % 3) * 0.06);
        const itemHeight = productHeightMax * (0.74 + ((item * 3 + level + seed) % 4) * 0.08);
        const itemDepth = 0.105 + ((item + row) % 2) * 0.025;
        const itemX = x - (width - 0.24) * 0.5 + spacing * (item + 0.5);
        const itemZ = z + depth * (row === 0 ? 0.25 : -0.08);
        const materialIndex = (seed + level * 2 + item + row * 3) % productMaterials.length;
        const material = productMaterials[materialIndex];
        const accent = productAccentMaterials[(seed + level + item + row) % productAccentMaterials.length];

        box(
          store,
          itemX,
          y + 0.025 + itemHeight * 0.5,
          itemZ,
          itemWidth,
          itemHeight,
          itemDepth,
          material,
          false,
          false
        );

        box(
          store,
          itemX,
          y + 0.025 + itemHeight * 0.56,
          itemZ + itemDepth * 0.51,
          itemWidth * 0.82,
          Math.max(0.035, itemHeight * 0.19),
          0.008,
          accent,
          false,
          false
        );

        box(
          store,
          itemX,
          y + 0.025 + itemHeight * 0.83,
          itemZ + itemDepth * 0.51,
          itemWidth * 0.46,
          0.012,
          0.008,
          creamMaterial,
          false,
          false
        );
      }
    }
  }

  box(store, x, baseY + height - 0.16, z + depth * 0.51, width - 0.14, 0.16, 0.025, creamMaterial, false, false);
}

shelfUnit(-3.3, -2.55, 2.3, 1.72, 0.7, 4, 1);
shelfUnit(-0.62, -2.55, 2.1, 1.62, 0.7, 4, 4);
shelfUnit(-3.2, -1.3, 1.85, 1.48, 0.62, 3, 2);
shelfUnit(0.06, -1.3, 1.9, 1.48, 0.62, 3, 6);

const fridge = new THREE.Group();
fridge.position.set(2.74, 0.18, -3.2);
store.add(fridge);
roundedBox(fridge, 0, 1.05, 0, 1.35, 2.1, 0.82, creamMaterial, 0.06, true, true);
box(fridge, 0, 1.13, 0.425, 1.08, 1.82, 0.035, glassMaterial, false, false);
box(fridge, 0, 2.04, 0.46, 1.14, 0.15, 0.04, coolLightMaterial, false, false);
for (let row = 0; row < 4; row++) {
  const y = 0.43 + row * 0.42;
  box(fridge, 0, y, 0.43, 1.12, 0.04, 0.12, metalMaterial, false, false);
  for (let col = 0; col < 7; col++) {
    const bottle = cylinder(
      fridge,
      -0.45 + col * 0.15,
      y + 0.17,
      0.48,
      0.042,
      0.046,
      0.29,
      productMaterials[(row + col + 2) % productMaterials.length],
      8
    );
    bottle.castShadow = false;
  }
}
box(fridge, -0.64, 1.12, 0.47, 0.035, 1.7, 0.03, trimMaterial, false, false);
box(fridge, 0.64, 1.12, 0.47, 0.035, 1.7, 0.03, trimMaterial, false, false);

const counter = new THREE.Group();
counter.position.set(2.72, 0.18, -1.62);
store.add(counter);
roundedBox(counter, 0, 0.48, 0, 2.1, 0.94, 0.84, new THREE.MeshStandardMaterial({
  color: '#5e4839',
  roughness: 0.5,
  metalness: 0.08
}), 0.05, true, true);
box(counter, 0, 0.99, 0, 2.15, 0.11, 0.9, creamMaterial, true, true);
roundedBox(counter, -0.18, 1.15, -0.1, 0.52, 0.27, 0.34, darkMaterial, 0.035, false, true);
box(counter, -0.18, 1.34, -0.1, 0.36, 0.025, 0.22, coolLightMaterial, false, false);
roundedBox(counter, 0.65, 1.18, -0.12, 0.58, 0.36, 0.42, metalMaterial, 0.04, false, true);
box(counter, 0.65, 1.17, 0.11, 0.36, 0.22, 0.02, warmLightMaterial, false, false);
box(counter, -0.66, 1.06, 0.16, 0.24, 0.05, 0.18, creamMaterial, false, false);

const hotCase = new THREE.Group();
hotCase.position.set(2.35, 0.18, -0.58);
store.add(hotCase);
roundedBox(hotCase, 0, 0.72, 0, 1.22, 0.82, 0.68, creamMaterial, 0.05, true, true);
box(hotCase, 0, 1.1, 0.34, 1.06, 0.04, 0.02, warmLightMaterial, false, false);
box(hotCase, 0, 0.92, 0.355, 1.0, 0.34, 0.04, glassMaterial, false, false);
for (let i = 0; i < 5; i++) {
  const item = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), new THREE.MeshStandardMaterial({
    color: ['#d6a65c', '#e7d5a2', '#bd774b'][i % 3],
    roughness: 0.58
  }));
  item.position.set(-0.42 + i * 0.21, 1.04, 0.4);
  item.scale.y = 0.82;
  hotCase.add(item);
}

const menuBoard = new THREE.Group();
menuBoard.position.set(-0.05, 3.12, -1.02);
store.add(menuBoard);
box(menuBoard, 0, 0, 0, 1.56, 0.94, 0.07, darkTealMaterial, false, false);
const menuPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.8), new THREE.MeshBasicMaterial({
  map: menuTexture,
  toneMapped: false
}));
menuPlane.position.z = 0.042;
menuBoard.add(menuPlane);
for (const x of [-0.68, 0.68]) rod(menuBoard, [x, 0.45, 0], [x, 0.78, 0], 0.012, metalMaterial, 5);

const cat = new THREE.Group();
cat.position.set(3.9, 1.28, -1.85);
cat.rotation.y = -0.32;
store.add(cat);
const catBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), blackMaterial);
catBody.scale.set(0.72, 1.05, 0.72);
cat.add(catBody);
const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12), blackMaterial);
catHead.position.set(0, 0.22, 0.02);
cat.add(catHead);
for (const x of [-0.09, 0.09]) {
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 4), blackMaterial);
  ear.position.set(x, 0.34, 0.01);
  ear.rotation.y = Math.PI / 4;
  cat.add(ear);
}
const catEyeMaterial = new THREE.MeshBasicMaterial({ color: '#a6dfac', toneMapped: false });
for (const x of [-0.052, 0.052]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), catEyeMaterial);
  eye.position.set(x, 0.245, 0.133);
  cat.add(eye);
}
const catTail = rod(cat, [0.12, -0.05, -0.03], [0.34, 0.12, -0.1], 0.025, blackMaterial, 6);

const acUnit = new THREE.Group();
acUnit.position.set(-2.9, 4.35, -2.2);
store.add(acUnit);
roundedBox(acUnit, 0, 0.3, 0, 1.2, 0.62, 0.72, new THREE.MeshStandardMaterial({
  color: '#9fa59d',
  roughness: 0.52,
  metalness: 0.24
}), 0.04, true, true);
const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24), trimMaterial);
fan.rotation.x = Math.PI / 2;
fan.position.set(0, 0.3, 0.37);
acUnit.add(fan);
for (let i = 0; i < 4; i++) {
  box(acUnit, 0, 0.11 + i * 0.07, 0.39, 0.62, 0.018, 0.02, darkMaterial, false, false);
}
box(store, -4.88, 2.1, -1.2, 0.06, 3.4, 0.1, trimMaterial, false, false);
for (let i = 0; i < 4; i++) {
  box(store, -4.9, 0.8 + i * 0.72, -1.2, 0.08, 0.08, 0.12, metalMaterial, false, false);
}

box(store, 4.89, 1.0, -2.55, 0.06, 1.85, 0.78, darkTealMaterial, false, true);
box(store, 4.92, 1.08, -2.55, 0.03, 0.04, 0.04, metalMaterial, false, false);
box(store, 4.93, 2.22, -2.55, 0.07, 0.11, 0.22, warmLightMaterial, false, false);
addGlowSprite(store, 5.02, 2.22, -2.55, 1.2, '#ffc172', 0.2);

const vending = new THREE.Group();
vending.position.set(3.55, 0.18, 1.45);
vending.rotation.y = -0.08;
scene.add(vending);
roundedBox(vending, 0, 1.14, 0, 1.22, 2.28, 0.72, creamMaterial, 0.055, true, true);
box(vending, 0, 2.21, 0.03, 1.24, 0.12, 0.76, darkTealMaterial, false, true);
const vendingFace = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.9), new THREE.MeshBasicMaterial({
  map: vendingTexture,
  toneMapped: false
}));
vendingFace.position.set(0, 1.12, 0.366);
vending.add(vendingFace);
const vendingLight = new THREE.PointLight('#76d7c7', 4, 3.2, 2);
vendingLight.position.set(0, 1.35, 0.92);
vending.add(vendingLight);
addGlowSprite(vending, 0, 1.42, 0.5, 2.2, '#75d3c3', 0.14);
addContactShadow(scene, 3.55, 1.45, 2.1, 1.3, 0.48);

const umbrellaStand = new THREE.Group();
umbrellaStand.position.set(-4.55, 0.18, 1.12);
scene.add(umbrellaStand);
roundedBox(umbrellaStand, 0, 0.28, 0, 0.66, 0.56, 0.5, darkTealMaterial, 0.04, true, true);
for (let i = 0; i < 5; i++) {
  const colors = ['#c86753', '#6ea8a1', '#e1b664', '#b47f91', '#d4d4c1'];
  const umbrellaMaterial = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.52 });
  rod(umbrellaStand, [-0.23 + i * 0.115, 0.45, 0], [-0.3 + i * 0.12, 1.62, 0.04], 0.028, umbrellaMaterial, 7);
  cylinder(umbrellaStand, -0.3 + i * 0.12, 0.48, 0.04, 0.04, 0.04, 0.08, creamMaterial, 8);
}

const trash = new THREE.Group();
trash.position.set(5.0, 0.18, 1.85);
scene.add(trash);
roundedBox(trash, 0, 0.42, 0, 0.62, 0.84, 0.58, new THREE.MeshStandardMaterial({
  color: '#53665f',
  roughness: 0.56,
  metalness: 0.18
}), 0.04, true, true);
box(trash, 0, 0.87, 0, 0.68, 0.11, 0.64, creamMaterial, true, true);
box(trash, 0, 0.56, 0.3, 0.4, 0.19, 0.02, darkMaterial, false, false);
addContactShadow(scene, 5.0, 1.85, 1.2, 1.05, 0.4);

const bicycle = new THREE.Group();
bicycle.position.set(-5.95, 0.145, 2.08);
bicycle.rotation.y = -0.16;
scene.add(bicycle);
const tireMaterial = new THREE.MeshStandardMaterial({ color: '#0b1012', roughness: 0.62, metalness: 0.12 });
const rimMaterial = new THREE.MeshStandardMaterial({ color: '#aeb7b2', roughness: 0.24, metalness: 0.82 });
const bikeFrameMaterial = new THREE.MeshStandardMaterial({ color: '#a45b45', roughness: 0.38, metalness: 0.52 });
const bikeBasketMaterial = new THREE.MeshStandardMaterial({ color: '#aaa998', roughness: 0.52, metalness: 0.34 });
const wheelGeometry = new THREE.TorusGeometry(0.45, 0.032, 8, 32);
const rimGeometry = new THREE.TorusGeometry(0.365, 0.011, 6, 32);

for (const x of [-0.78, 0.78]) {
  const wheel = new THREE.Mesh(wheelGeometry, tireMaterial);
  wheel.position.set(x, 0.48, 0);
  wheel.castShadow = true;
  bicycle.add(wheel);

  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.set(x, 0.48, 0.004);
  bicycle.add(rim);

  for (let spoke = 0; spoke < 12; spoke++) {
    const angle = spoke * Math.PI / 6;
    line(
      bicycle,
      [
        [x, 0.48, 0.012],
        [x + Math.cos(angle) * 0.36, 0.48 + Math.sin(angle) * 0.36, 0.012]
      ],
      '#a7b0ad',
      0.58
    );
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 10), metalMaterial);
  hub.position.set(x, 0.48, 0);
  hub.rotation.x = Math.PI / 2;
  bicycle.add(hub);
}

const rearHub = [-0.78, 0.48, 0];
const crankHub = [0, 0.48, 0];
const seatTop = [-0.18, 1.12, 0];
const headTop = [0.48, 1.08, 0];
const frontHub = [0.78, 0.48, 0];

rod(bicycle, rearHub, seatTop, 0.025, bikeFrameMaterial, 8);
rod(bicycle, seatTop, crankHub, 0.028, bikeFrameMaterial, 8);
rod(bicycle, crankHub, rearHub, 0.024, bikeFrameMaterial, 8);
rod(bicycle, seatTop, headTop, 0.028, bikeFrameMaterial, 8);
rod(bicycle, headTop, crankHub, 0.026, bikeFrameMaterial, 8);
rod(bicycle, headTop, frontHub, 0.024, metalMaterial, 8);

const chainring = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.025, 24), metalMaterial);
chainring.position.set(0, 0.48, 0.045);
chainring.rotation.x = Math.PI / 2;
bicycle.add(chainring);
rod(bicycle, [0, 0.48, 0.07], [0.1, 0.31, 0.1], 0.012, metalMaterial, 6);
box(bicycle, 0.12, 0.29, 0.1, 0.16, 0.035, 0.1, blackMaterial, false, false);

rod(bicycle, seatTop, [-0.25, 1.27, 0], 0.018, metalMaterial, 7);
box(bicycle, -0.34, 1.31, 0, 0.35, 0.075, 0.2, blackMaterial, true, true);

rod(bicycle, headTop, [0.56, 1.3, 0], 0.018, metalMaterial, 7);
rod(bicycle, [0.56, 1.3, -0.23], [0.56, 1.3, 0.23], 0.016, metalMaterial, 7);
for (const z of [-0.21, 0.21]) {
  rod(bicycle, [0.56, 1.3, z], [0.56, 1.3, z + Math.sign(z) * 0.09], 0.025, blackMaterial, 7);
}

rod(bicycle, [0.58, 1.21, 0], [0.94, 1.07, 0], 0.012, metalMaterial, 5);
roundedBox(bicycle, 0.98, 1.04, 0, 0.32, 0.24, 0.3, bikeBasketMaterial, 0.025, true, true);
for (let i = 0; i < 4; i++) {
  box(bicycle, 0.98, 1.11 - i * 0.045, 0.154, 0.28, 0.012, 0.012, darkMaterial, false, false);
}

rod(bicycle, rearHub, [-0.92, 0.78, 0], 0.016, metalMaterial, 6);
box(bicycle, -0.96, 0.81, 0, 0.24, 0.035, 0.28, metalMaterial, false, false);
addContactShadow(scene, -5.95, 2.08, 2.35, 0.82, 0.38);

const aFrame = new THREE.Group();
aFrame.position.set(-3.1, 0.18, 2.66);
aFrame.rotation.y = 0.12;
scene.add(aFrame);
rod(aFrame, [-0.38, 0, 0], [-0.18, 1.18, 0], 0.018, metalMaterial, 6);
rod(aFrame, [0.38, 0, 0], [0.18, 1.18, 0], 0.018, metalMaterial, 6);
const aFramePoster = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.0), new THREE.MeshBasicMaterial({
  map: posterTexture,
  toneMapped: false
}));
aFramePoster.position.set(0, 0.66, 0.02);
aFramePoster.rotation.x = -0.1;
aFrame.add(aFramePoster);
addContactShadow(scene, -3.1, 2.66, 1.15, 0.62, 0.34);

const plant = new THREE.Group();
plant.position.set(-7.25, 0.18, 1.55);
scene.add(plant);
cylinder(plant, 0, 0.35, 0, 0.28, 0.35, 0.7, new THREE.MeshStandardMaterial({
  color: '#5c4a3c',
  roughness: 0.76
}), 12);
for (let i = 0; i < 7; i++) {
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), new THREE.MeshStandardMaterial({
    color: i % 2 ? '#31534b' : '#27463f',
    roughness: 0.72
  }));
  leaf.position.set(Math.sin(i * 1.7) * 0.22, 0.92 + (i % 3) * 0.22, Math.cos(i * 1.4) * 0.18);
  leaf.scale.set(0.7, 1.3, 0.55);
  plant.add(leaf);
}
addContactShadow(scene, -7.25, 1.55, 1.05, 0.82, 0.36);

const lamp = new THREE.Group();
lamp.position.set(-8.0, 0.18, 2.25);
scene.add(lamp);
cylinder(lamp, 0, 2.75, 0, 0.07, 0.12, 5.5, metalMaterial, 12);
rod(lamp, [0, 5.43, 0], [0.75, 5.66, 0], 0.055, metalMaterial, 8);
roundedBox(lamp, 0.88, 5.64, 0, 0.78, 0.16, 0.42, darkMaterial, 0.04, true, true);
box(lamp, 0.88, 5.54, 0, 0.64, 0.035, 0.31, warmLightMaterial, false, false);
const lampLight = new THREE.SpotLight('#ffc274', 52, 14, Math.PI * 0.3, 0.78, 1.55);
lampLight.position.set(0.88, 5.5, 0);
lampLight.target.position.set(-1.8, 0, 3.2);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(isCompact ? 1024 : 2048, isCompact ? 1024 : 2048);
lampLight.shadow.bias = -0.0003;
lamp.add(lampLight, lampLight.target);
addGlowSprite(lamp, 0.88, 5.5, 0.08, 2.8, '#ffc577', 0.25);
addContactShadow(scene, -8.0, 2.25, 0.9, 0.9, 0.42);

const trafficLight = new THREE.Group();
trafficLight.position.set(6.55, 0.18, 2.45);
scene.add(trafficLight);
cylinder(trafficLight, 0, 2.0, 0, 0.075, 0.105, 4.0, metalMaterial, 10);
roundedBox(trafficLight, 0, 3.88, 0, 0.5, 1.12, 0.38, darkMaterial, 0.045, true, true);
const trafficBulbs = ['#d86853', '#e6bd5f', '#6fbd8c'].map((color, index) => {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: index === 2 ? 2.4 : 0.12,
    roughness: 0.32
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), material);
  bulb.position.set(0, 4.2 - index * 0.34, 0.22);
  trafficLight.add(bulb);
  return { bulb, material, color };
});
const trafficGlow = addGlowSprite(trafficLight, 0, 3.52, 0.32, 1.4, '#73c694', 0.16);
addContactShadow(scene, 6.55, 2.45, 0.9, 0.9, 0.34);

const streetSign = new THREE.Group();
streetSign.position.set(6.05, 0.18, 0.95);
scene.add(streetSign);
cylinder(streetSign, 0, 1.58, 0, 0.055, 0.075, 3.16, metalMaterial, 9);
box(streetSign, 0, 2.92, 0, 1.66, 0.5, 0.08, tealMaterial, true, true);
const streetSignFace = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.42), new THREE.MeshBasicMaterial({
  map: streetSignTexture,
  toneMapped: false
}));
streetSignFace.position.set(0, 2.92, 0.047);
streetSign.add(streetSignFace);
addContactShadow(scene, 6.05, 0.95, 0.72, 0.72, 0.28);

const pole = new THREE.Group();
pole.position.set(8.15, 0.18, 1.35);
scene.add(pole);
cylinder(pole, 0, 4.5, 0, 0.1, 0.16, 9.0, new THREE.MeshStandardMaterial({
  color: '#4d5b58',
  roughness: 0.5,
  metalness: 0.35
}), 12);
box(pole, 0, 7.25, 0, 1.5, 0.09, 0.1, metalMaterial, true, true);
box(pole, 0, 6.78, 0, 1.15, 0.08, 0.09, metalMaterial, true, true);
for (let i = 0; i < 4; i++) {
  cylinder(pole, -0.55 + i * 0.36, 7.42, 0, 0.026, 0.045, 0.28, creamMaterial, 8);
}
cylinder(pole, 0.28, 5.3, 0, 0.22, 0.22, 0.72, new THREE.MeshStandardMaterial({
  color: '#53615e',
  roughness: 0.46,
  metalness: 0.34
}), 12);
cable(pole, [[8.15, 7.85, 1.35], [4.8, 7.45, 0.2], [1.2, 7.3, -1.6], [-2.8, 7.55, -2.4]], '#070d10', 0.018, 40);
cable(pole, [[8.55, 7.85, 1.35], [7.9, 7.4, 4.4], [7.2, 7.15, 7.6], [6.5, 7.1, 11.2]], '#080e11', 0.016, 34);
addContactShadow(scene, 8.15, 1.35, 1.2, 1.2, 0.4);

const alley = new THREE.Group();
alley.position.set(5.15, 0, -0.6);
scene.add(alley);
horizontalPlane(alley, 0, 0.16, 0.3, 2.7, 6.2, new THREE.MeshStandardMaterial({
  color: '#222b2c',
  roughness: 0.34,
  metalness: 0.16
}));
box(alley, 1.35, 1.4, -0.2, 0.12, 2.6, 5.7, buildingMaterial, true, true);
box(alley, -0.02, 1.35, -2.75, 2.8, 2.5, 0.14, buildingMaterial, true, true);
box(alley, 0.0, 1.08, 0.78, 0.86, 1.8, 0.05, darkTealMaterial, true, true);
box(alley, 0.26, 1.02, 0.82, 0.035, 0.06, 0.03, creamMaterial, false, false);
const alleyLamp = new THREE.PointLight('#ef8bb6', 8, 4.2, 2);
alleyLamp.position.set(0.3, 2.15, 0.3);
alley.add(alleyLamp);

const bladeSign = new THREE.Group();
bladeSign.position.set(4.48, 2.7, 0.75);
bladeSign.rotation.y = -0.08;
scene.add(bladeSign);
box(bladeSign, 0, 0, -0.06, 0.58, 2.5, 0.14, darkMaterial, true, true);
const bladeFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.32), new THREE.MeshBasicMaterial({
  map: bladeTexture,
  transparent: true,
  toneMapped: false
}));
bladeFace.position.z = 0.015;
bladeSign.add(bladeFace);
addGlowSprite(bladeSign, 0, 0, 0.3, 3.6, '#f18fb7', 0.16);
addContactShadow(scene, 4.48, 1.05, 1.05, 0.8, 0.24);

const vent = new THREE.Group();
vent.position.set(5.65, 0.18, 1.45);
scene.add(vent);
roundedBox(vent, 0, 0.18, 0, 0.54, 0.36, 0.44, trimMaterial, 0.03, true, true);
for (let i = 0; i < 4; i++) {
  box(vent, 0, 0.28 - i * 0.055, 0.225, 0.34, 0.012, 0.012, darkMaterial, false, false);
}
addContactShadow(scene, 5.65, 1.45, 0.95, 0.8, 0.28);

const steamSprites = [];
const steamMaterialBase = new THREE.SpriteMaterial({
  map: glowTexture,
  color: '#b7cfcd',
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
for (let i = 0; i < 18; i++) {
  const material = steamMaterialBase.clone();
  const sprite = new THREE.Sprite(material);
  const scale = 0.45 + Math.random() * 0.55;
  sprite.scale.set(scale, scale, 1);
  sprite.position.set(
    5.65 + (Math.random() - 0.5) * 0.32,
    0.35 + Math.random() * 0.2,
    1.45 + (Math.random() - 0.5) * 0.3
  );
  scene.add(sprite);
  steamSprites.push({
    sprite,
    baseX: 5.65,
    baseZ: 1.45,
    phase: Math.random(),
    speed: 0.08 + Math.random() * 0.08,
    drift: (Math.random() - 0.5) * 0.18
  });
}

const mistMaterial = new THREE.SpriteMaterial({
  map: glowTexture,
  color: '#739095',
  transparent: true,
  opacity: 0.05,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
for (let i = 0; i < 7; i++) {
  const mist = new THREE.Sprite(mistMaterial.clone());
  mist.position.set(-10 + i * 3.5, 0.35 + Math.random() * 0.45, 5 + Math.random() * 5);
  mist.scale.set(6 + Math.random() * 4, 1.8 + Math.random(), 1);
  scene.add(mist);
}

const rainCount = isCompact ? 420 : 720;
const rainPositions = new Float32Array(rainCount * 6);
const rainData = [];
for (let i = 0; i < rainCount; i++) {
  const x = (Math.random() - 0.5) * 38;
  const z = Math.random() * 26 - 3;
  const y = Math.random() * 18;
  const length = 0.18 + Math.random() * 0.42;
  rainData.push({
    x,
    y,
    z,
    length,
    speed: 8.5 + Math.random() * 7.5,
    drift: 0.55 + Math.random() * 0.5
  });
  const offset = i * 6;
  rainPositions[offset] = x;
  rainPositions[offset + 1] = y;
  rainPositions[offset + 2] = z;
  rainPositions[offset + 3] = x - 0.1;
  rainPositions[offset + 4] = y - length;
  rainPositions[offset + 5] = z;
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
const rainMaterial = new THREE.LineBasicMaterial({
  color: '#bfd5d8',
  transparent: true,
  opacity: 0.27,
  depthWrite: false
});
const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
rain.frustumCulled = false;
scene.add(rain);

const ambient = new THREE.HemisphereLight('#8fb9c9', '#05090b', 0.46);
scene.add(ambient);

const moon = new THREE.DirectionalLight('#9bc5df', 1.12);
moon.position.set(-12, 16, 9);
moon.castShadow = true;
moon.shadow.mapSize.set(isCompact ? 1024 : 2048, isCompact ? 1024 : 2048);
moon.shadow.camera.left = -18;
moon.shadow.camera.right = 18;
moon.shadow.camera.top = 18;
moon.shadow.camera.bottom = -18;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 50;
moon.shadow.bias = -0.00035;
moon.shadow.normalBias = 0.025;
scene.add(moon);

const fillLight = new THREE.DirectionalLight('#6f93a5', 0.22);
fillLight.position.set(7, 9, 12);
scene.add(fillLight);

const storeRect = new THREE.RectAreaLight('#ffc17a', 3.2, 7.4, 2.4);
storeRect.position.set(-1.1, 2.15, 1.0);
storeRect.lookAt(-1.1, 1.8, 8);
scene.add(storeRect);

const storeGlow = new THREE.PointLight('#ffb968', 8, 10, 2);
storeGlow.position.set(-1.1, 2.8, 1.8);
scene.add(storeGlow);

const neonLight = new THREE.PointLight('#f08eb6', 7, 5, 2);
neonLight.position.set(4.5, 2.8, 1.2);
scene.add(neonLight);

const trafficLightPoint = new THREE.PointLight('#6fbd8c', 5, 2.8, 2);
trafficLightPoint.position.set(6.55, 3.6, 2.8);
scene.add(trafficLightPoint);

function framingFor(aspect) {
  if (aspect < 0.72) {
    return {
          position: new THREE.Vector3(12.7, 7.1, 25.2),
          target: new THREE.Vector3(-1.0, 2.05, 0.1),
          fov: 58
    };
  }
  if (aspect < 1.18) {
    return {
          position: new THREE.Vector3(9.6, 4.1, 14.7),
          target: new THREE.Vector3(-0.65, 2.02, 0.4),
          fov: 45
    };
  }
  return {
        position: new THREE.Vector3(8.8, 3.3, 12.1),
        target: new THREE.Vector3(-0.72, 1.95, 0.3),
        fov: 39
  };
}

let currentFraming = framingFor(window.innerWidth / window.innerHeight);
let cameraTween = null;
let introComplete = reduceMotion;
const introStartTime = performance.now();
const introDuration = reduceMotion ? 0 : 2600;
let userMoved = false;
let driftEnabled = !reduceMotion;
let driftAngle = 0;
let firstRender = true;

function startCameraTween(toPosition, toTarget, duration = 900) {
  cameraTween = {
    fromPosition: camera.position.clone(),
    toPosition: toPosition.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    start: performance.now(),
    duration: reduceMotion ? 0 : duration
  };
  controls.enabled = false;
}

function resetView(animate = true) {
  introComplete = true;
  currentFraming = framingFor(window.innerWidth / window.innerHeight);
  camera.fov = currentFraming.fov;
  camera.updateProjectionMatrix();
  userMoved = false;
  driftEnabled = !reduceMotion;
  driftAngle = 0;
  driftToggle.setAttribute('aria-pressed', String(driftEnabled));
  driftToggle.setAttribute('aria-label', driftEnabled ? '关闭镜头巡游' : '开启镜头巡游');
  if (animate) {
    startCameraTween(currentFraming.position, currentFraming.target, 980);
  } else {
    camera.position.copy(currentFraming.position);
    controls.target.copy(currentFraming.target);
    controls.enabled = true;
    controls.update();
  }
}

camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
camera.position.copy(currentFraming.position);
controls.target.copy(currentFraming.target);
controls.update();

if (!reduceMotion) {
  const introStart = currentFraming.position.clone().multiplyScalar(1.25);
  introStart.y += 1.6;
  camera.position.copy(introStart);
  controls.enabled = false;
} else {
  controls.enabled = true;
}

function easeOutQuint(value) {
  return 1 - Math.pow(1 - value, 5);
}

function updateIntro(now) {
  if (introComplete) return;
  const progress = Math.min((now - introStartTime) / introDuration, 1);
  const eased = easeOutQuint(progress);
  const startPosition = currentFraming.position.clone().multiplyScalar(1.25);
  startPosition.y += 1.6;
  camera.position.lerpVectors(startPosition, currentFraming.position, eased);
  camera.lookAt(currentFraming.target);
  if (progress >= 1) {
    introComplete = true;
    controls.target.copy(currentFraming.target);
    controls.enabled = true;
    controls.update();
  }
}

function updateCameraTween(now) {
  if (!cameraTween) return;
  const progress = cameraTween.duration === 0 ? 1 : Math.min((now - cameraTween.start) / cameraTween.duration, 1);
  const eased = easeOutQuint(progress);
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  camera.lookAt(controls.target);
  if (progress >= 1) {
    cameraTween = null;
    controls.enabled = true;
    controls.update();
  }
}

function updateDrift() {
  if (!introComplete || !driftEnabled || userMoved || cameraTween) return;
  const targetAngle = Math.sin(clock.elapsedTime * 0.13) * 0.022;
  const delta = targetAngle - driftAngle;
  const offset = camera.position.clone().sub(controls.target);
  offset.applyAxisAngle(Y_AXIS, delta);
  camera.position.copy(controls.target).add(offset);
  driftAngle = targetAngle;
}

function dismissHint() {
  hint.classList.add('is-hidden');
}

controls.addEventListener('start', () => {
  userMoved = true;
  dismissHint();
});

renderer.domElement.addEventListener('pointerdown', dismissHint, { passive: true });

renderer.domElement.addEventListener('keydown', event => {
  const offset = camera.position.clone().sub(controls.target);
  tempSpherical.setFromVector3(offset);
  let handled = true;
  if (event.key === 'ArrowLeft') {
    tempSpherical.theta = Math.min(controls.maxAzimuthAngle, tempSpherical.theta + 0.045);
  } else if (event.key === 'ArrowRight') {
    tempSpherical.theta = Math.max(controls.minAzimuthAngle, tempSpherical.theta - 0.045);
  }
  else if (event.key === 'ArrowUp') tempSpherical.phi = Math.max(controls.minPolarAngle, tempSpherical.phi - 0.035);
  else if (event.key === 'ArrowDown') tempSpherical.phi = Math.min(controls.maxPolarAngle, tempSpherical.phi + 0.035);
  else if (event.key === '+' || event.key === '=') tempSpherical.radius = Math.max(controls.minDistance, tempSpherical.radius - 0.7);
  else if (event.key === '-') tempSpherical.radius = Math.min(controls.maxDistance, tempSpherical.radius + 0.7);
  else handled = false;
  if (!handled) return;
  event.preventDefault();
  userMoved = true;
  dismissHint();
  camera.position.copy(controls.target).add(tempVector.setFromSpherical(tempSpherical));
  controls.update();
});

resetViewButton.addEventListener('click', () => {
  resetView(true);
  dismissHint();
});

driftToggle.addEventListener('click', () => {
  driftEnabled = !driftEnabled;
  driftToggle.setAttribute('aria-pressed', String(driftEnabled));
  driftToggle.setAttribute('aria-label', driftEnabled ? '关闭镜头巡游' : '开启镜头巡游');
  if (driftEnabled) {
    userMoved = false;
    driftAngle = 0;
  }
});

let audioContext = null;
let rainGain = null;
let audioOn = false;

function initializeRainAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  audioContext = new AudioContextClass();

  const seconds = 4;
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * seconds, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.018 * white) / 1.018;
    data[i] = last * 3.4;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1350;
  lowpass.Q.value = 0.55;

  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 180;
  highpass.Q.value = 0.4;

  rainGain = audioContext.createGain();
  rainGain.gain.value = 0;
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(rainGain);
  rainGain.connect(audioContext.destination);
  source.start();

  return true;
}

async function toggleRainAudio() {
  if (!audioContext && !initializeRainAudio()) return;
  await audioContext.resume();
  audioOn = !audioOn;
  const now = audioContext.currentTime;
  rainGain.gain.cancelScheduledValues(now);
  rainGain.gain.setValueAtTime(rainGain.gain.value, now);
  rainGain.gain.linearRampToValueAtTime(audioOn ? 0.085 : 0, now + 0.9);
  soundToggle.setAttribute('aria-pressed', String(audioOn));
  soundToggle.setAttribute('aria-label', audioOn ? '关闭雨声' : '开启雨声');
  soundToggle.querySelector('.control__label').textContent = audioOn ? '静音' : '雨声';
}

soundToggle.addEventListener('click', toggleRainAudio);

function updateTime() {
  const now = new Date();
  statusTime.textContent = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
updateTime();
window.setInterval(updateTime, 30000);

function updateRain(delta, elapsed) {
  const speedScale = reduceMotion ? 0.45 : 1;
  for (let i = 0; i < rainData.length; i++) {
    const drop = rainData[i];
    drop.y -= drop.speed * delta * speedScale;
    drop.x -= drop.drift * delta * speedScale;
    if (drop.y < 0.04) {
      drop.y = 11 + Math.random() * 8;
      drop.x = (Math.random() - 0.5) * 38;
      drop.z = Math.random() * 26 - 3;
    }
    if (drop.x < -19) drop.x = 19;
    const offset = i * 6;
    rainPositions[offset] = drop.x;
    rainPositions[offset + 1] = drop.y;
    rainPositions[offset + 2] = drop.z;
    rainPositions[offset + 3] = drop.x - 0.1;
    rainPositions[offset + 4] = drop.y - drop.length;
    rainPositions[offset + 5] = drop.z;
  }
  rainGeometry.attributes.position.needsUpdate = true;
  rainMaterial.opacity = 0.23 + Math.sin(elapsed * 0.7) * 0.03;
}

function updateRipples(delta) {
  ripples.forEach(ripple => {
    ripple.phase = (ripple.phase + delta * ripple.speed) % 1;
    const wave = ripple.phase;
    ripple.mesh.scale.setScalar(0.7 + wave * ripple.strength);
    ripple.mesh.material.opacity = Math.max(0, (1 - wave) * 0.26);
  });
}

function updateSteam(delta, elapsed) {
  steamSprites.forEach((item, index) => {
    item.phase = (item.phase + delta * item.speed) % 1;
    const phase = item.phase;
    item.sprite.position.y = 0.34 + phase * 2.4;
    item.sprite.position.x = item.baseX + Math.sin(elapsed * 0.45 + index) * 0.12 + phase * item.drift;
    item.sprite.position.z = item.baseZ + Math.cos(elapsed * 0.32 + index * 1.7) * 0.08;
    const fade = Math.sin(phase * Math.PI);
    item.sprite.material.opacity = fade * 0.1;
    item.sprite.scale.setScalar(0.45 + phase * 0.8);
  });
}

function updateLights(elapsed) {
  const flicker = 0.985 + Math.sin(elapsed * 3.9) * 0.012 + (Math.sin(elapsed * 18.7) > 0.993 ? -0.06 : 0);
  storeGlow.intensity = 8 * flicker;
  interiorLight.intensity = 12 * (0.99 + Math.sin(elapsed * 1.8) * 0.008);
  sign.material.color.setScalar(0.96 + Math.sin(elapsed * 2.4) * 0.02);
  neonLight.intensity = 7 * (0.92 + Math.sin(elapsed * 2.7) * 0.05);
  bladeFace.material.opacity = 0.94 + Math.sin(elapsed * 1.7) * 0.04;
  lampLight.intensity = 52 * (0.97 + Math.sin(elapsed * 1.9) * 0.018);

  const signalIndex = Math.floor(elapsed / 4.8) % 3;
  trafficBulbs.forEach((item, index) => {
    item.material.emissiveIntensity = index === signalIndex ? 2.3 + Math.sin(elapsed * 2.2) * 0.12 : 0.1;
  });
  const signalColor = ['#d86853', '#e6bd5f', '#6fbd8c'][signalIndex];
  trafficGlow.material.color.set(signalColor);
  trafficLightPoint.color.set(signalColor);
}

const doorTiming = { duration: 2.4, period: 16.5, offset: 5.2 };
function updateDoors(elapsed) {
  const phase = (elapsed + doorTiming.offset) % doorTiming.period;
  const open = phase < doorTiming.duration;
  const amount = open ? Math.sin(Math.PI * phase / doorTiming.duration) : 0;
  doorLeft.position.x = -0.52 - amount * 0.74;
  doorRight.position.x = 0.52 + amount * 0.74;
}

function clampCameraAzimuth() {
  const offset = camera.position.clone().sub(controls.target);
  tempSpherical.setFromVector3(offset);
  const clamped = THREE.MathUtils.clamp(
    tempSpherical.theta,
    controls.minAzimuthAngle,
    controls.maxAzimuthAngle
  );
  if (clamped !== tempSpherical.theta) {
    tempSpherical.theta = clamped;
    camera.position.copy(controls.target).add(tempVector.setFromSpherical(tempSpherical));
  }
}

function updateCat(elapsed) {
  catTail.rotation.z = 0.2 + Math.sin(elapsed * 1.3) * 0.16;
  catTail.rotation.x = Math.sin(elapsed * 0.9) * 0.08;
  catHead.rotation.y = Math.sin(elapsed * 0.37) * 0.22;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const compact = width < 760;
  const renderScale = getRenderScale(width);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderScale);
  renderer.setSize(width, height);
  composer.setPixelRatio(renderScale);
  composer.setSize(width, height);
  cinematicPass.uniforms.uResolution.value.set(width * renderScale, height * renderScale);
  currentFraming = framingFor(aspect);
  camera.fov = currentFraming.fov;
  camera.updateProjectionMatrix();
  if (introComplete && !userMoved && !cameraTween) {
    controls.target.copy(currentFraming.target);
    camera.position.copy(currentFraming.position);
    controls.update();
  }
}
window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clock.stop();
  } else {
    clock.start();
  }
});

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  updateIntro(now);
  updateCameraTween(now);
  updateDrift();
  if (introComplete && !cameraTween) {
    controls.update();
    clampCameraAzimuth();
  }

  updateRain(delta, elapsed);
  updateRipples(delta);
  updateSteam(delta, elapsed);
  updateLights(elapsed);
  updateDoors(elapsed);
  updateCat(elapsed);
  cinematicPass.uniforms.uTime.value = elapsed;

  composer.render();

  if (firstRender) {
    firstRender = false;
    document.body.dataset.sceneReady = 'true';
    window.setTimeout(() => document.body.classList.add('is-ready'), reduceMotion ? 0 : 420);
  }
}

animate();
