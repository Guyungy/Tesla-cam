import * as THREE from '../test-results/scene-vendor/node_modules/three/build/three.module.js';
import { RoundedBoxGeometry } from '../test-results/scene-vendor/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  estimateDistance,
  distanceText,
  distanceRangeText,
} from './estimate_object_distance.js';
const cameraInfo = JSON.parse(
  document.getElementById('camera-info-data').textContent,
);

const frames = JSON.parse(document.getElementById('frames-data').textContent);
const detections = JSON.parse(
  document.getElementById('detections-data').textContent,
).moments;
const roadFrames = JSON.parse(document.getElementById('road-data').textContent);
const laneFrames = JSON.parse(document.getElementById('lane-data').textContent);
const laneControls = { lines: true, boundaries: false };
const labels = {
  car: '小汽车',
  bus: '公交/客车',
  truck: '货车',
  person: '行人',
  motorbike: '摩托车',
  bicycle: '自行车',
};
const cameraLabels = {
  front: '前摄',
  back: '后摄',
  left: '左后视',
  right: '右后视',
  left_pillar: '左柱摄',
  right_pillar: '右柱摄',
};
const cameraAngles = {
  front: 0,
  back: 180,
  left: -120,
  right: 120,
  left_pillar: -65,
  right_pillar: 65,
};
const cameraFov = {
  front: 70,
  back: 110,
  left: 105,
  right: 105,
  left_pillar: 100,
  right_pillar: 100,
};
// Approximate icon mounting origins only; not calibration and not part of the range calculation.
const cameraOrigins = {
  front: [0, -1.9],
  back: [0, 2],
  left: [-0.95, 0.5],
  right: [0.95, 0.5],
  left_pillar: [-0.95, -0.6],
  right_pillar: [0.95, -0.6],
};
const colors = {
  car: 0x6fc8ff,
  bus: 0xffbf70,
  truck: 0xf2a55b,
  person: 0xff7e89,
  motorbike: 0xc9a6ff,
  bicycle: 0x9ee4b5,
};
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08121c);
scene.fog = new THREE.Fog(0x08121c, 48, 96);
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 150);
scene.add(new THREE.HemisphereLight(0xdceaff, 0x203444, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(-16, 30, 18);
scene.add(sun);
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(110, 110),
  new THREE.MeshStandardMaterial({ color: 0x142431, roughness: 1 }),
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -0.03;
scene.add(plane);
// Segmentation masks are image coordinates. Without calibrated camera poses and
// a ground homography they cannot be placed on the shared 3D ground plane.
const laneGroup = new THREE.Group();
scene.add(laneGroup);
const markingMaterial = new THREE.MeshBasicMaterial({
  color: 0xe9fcff,
  depthTest: true,
});
const boundaryMaterial = new THREE.MeshBasicMaterial({
  color: 0xf0ac52,
  transparent: true,
  opacity: 0.65,
});
function visiblePaths(view) {
  return (laneFrames[view]?.[index] || []).filter((path) =>
    path.kind === 'marking' ? laneControls.lines : laneControls.boundaries,
  );
}
function updateLanes() {
  while (laneGroup.children.length) {
    const child = laneGroup.children[0];
    child.geometry.dispose();
    laneGroup.remove(child);
  }
  let count = 0;
  for (const view of Object.keys(laneFrames)) {
    if (view !== selectedCamera) continue;
    const angle = -THREE.MathUtils.degToRad(cameraAngles[view]);
    for (const path of visiblePaths(view)) {
      if (path.points.length < 2) continue;
      const points = path.points.map(([x, y]) =>
        new THREE.Vector3(
          (x - 0.5) * 24,
          0.05,
          -18 + (y - 0.5) * 32,
        ).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle),
      );
      const curve = new THREE.CurvePath();
      for (let i = 1; i < points.length; i++)
        curve.add(new THREE.LineCurve3(points[i - 1], points[i]));
      const geometry = new THREE.TubeGeometry(
        curve,
        Math.max(8, points.length * 3),
        path.kind === 'marking' ? 0.08 : 0.045,
        5,
        false,
      );
      laneGroup.add(
        new THREE.Mesh(
          geometry,
          path.kind === 'marking' ? markingMaterial : boundaryMaterial,
        ),
      );
      count++;
    }
  }
  document.getElementById('lane-count').textContent =
    `${cameraLabels[selectedCamera]}标线 · ${count} 段 · 六路已检测`;
}
function laneSvg(view) {
  return visiblePaths(view)
    .map((path) => {
      const points = path.points
        .map(([x, y]) => `${x * 1000},${y * 1000}`)
        .join(' ');
      const color = path.kind === 'marking' ? '#6eeaff' : '#ffb755';
      return `<polyline points="${points}" fill="none" stroke="#071b24" stroke-width="7" stroke-linejoin="round"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`;
    })
    .join('');
}
const grid = new THREE.GridHelper(110, 44, 0x264759, 0x23404e);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.14;
scene.add(grid);
const ringMaterial = new THREE.LineBasicMaterial({
  color: 0x416475,
  transparent: true,
  opacity: 0.46,
});
for (const radius of [10, 20, 30]) {
  const curve = [];
  for (let a = 0; a <= 64; a++) {
    const theta = (2 * Math.PI * a) / 64;
    curve.push(
      new THREE.Vector3(
        Math.cos(theta) * radius,
        0.025,
        Math.sin(theta) * radius,
      ),
    );
  }
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve),
      ringMaterial,
    ),
  );
}
const bodyGeo = new RoundedBoxGeometry(1.92, 0.61, 4.22, 4, 0.15);
const cabinGeo = new RoundedBoxGeometry(1.58, 0.62, 2.2, 4, 0.17);
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.2, 18);
const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.205, 18);
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x162e3c,
  metalness: 0.42,
  roughness: 0.19,
});
const wheelMat = new THREE.MeshStandardMaterial({
  color: 0x11171b,
  roughness: 0.86,
});
const hubMat = new THREE.MeshStandardMaterial({
  color: 0x9fb3ba,
  metalness: 0.76,
  roughness: 0.35,
});
function car(color, scale = 1, bus = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.45,
    roughness: 0.34,
  });
  const body = new THREE.Mesh(
    bus ? new RoundedBoxGeometry(2.48, 0.91, 6.85, 4, 0.15) : bodyGeo,
    paint,
  );
  body.position.y = bus ? 0.79 : 0.65;
  group.add(body);
  const cab = new THREE.Mesh(
    bus ? new RoundedBoxGeometry(2.25, 1.05, 4.68, 4, 0.16) : cabinGeo,
    bus ? paint : glassMat,
  );
  cab.position.set(0, bus ? 1.67 : 1.24, bus ? 0.06 : -0.18);
  group.add(cab);
  if (!bus) {
    for (const z of [-1.2, 0.86]) {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(1.63, 0.055, 0.07),
        paint,
      );
      roof.position.set(0, 1.53, z);
      group.add(roof);
    }
  }
  for (const x of bus ? [-1.23, 1.23] : [-0.98, 0.98])
    for (const z of bus ? [-2.35, 2.35] : [-1.4, 1.4]) {
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 0.36, z);
      group.add(tire);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x + (x > 0 ? 0.035 : -0.035), 0.36, z);
      group.add(hub);
    }
  for (const x of bus ? [-0.86, 0.86] : [-0.64, 0.64]) {
    const headlight = new THREE.Mesh(
      new RoundedBoxGeometry(0.48, 0.11, 0.07, 2, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xdff5ef }),
    );
    headlight.position.set(x, bus ? 0.75 : 0.72, bus ? -3.45 : -2.13);
    group.add(headlight);
    const tail = new THREE.Mesh(
      new RoundedBoxGeometry(0.45, 0.1, 0.07, 2, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xd85250 }),
    );
    tail.position.set(x, bus ? 0.75 : 0.72, bus ? 3.45 : 2.13);
    group.add(tail);
  }
  group.scale.setScalar(scale);
  return group;
}
function person() {
  const g = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial({
      color: colors.person,
      roughness: 0.65,
    });
  let trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.27, 0.95, 10),
    mat,
  );
  trunk.position.y = 1.02;
  g.add(trunk);
  let head = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd9bb }),
  );
  head.position.y = 1.68;
  g.add(head);
  for (const x of [-0.13, 0.13]) {
    let leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.65, 8),
      mat,
    );
    leg.position.set(x, 0.34, 0);
    g.add(leg);
  }
  return g;
}
function bike(kind) {
  const g = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial({
      color: colors[kind],
      metalness: 0.2,
    });
  let body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 1.7), mat);
  body.position.y = 0.8;
  g.add(body);
  for (const z of [-0.65, 0.65]) {
    let wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.31, 0.07, 7, 18),
      wheelMat,
    );
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.35, z);
    g.add(wheel);
  }
  if (kind === 'motorbike') {
    let rider = person();
    rider.scale.setScalar(0.72);
    rider.position.y = 0.45;
    g.add(rider);
  }
  return g;
}
const ego = car(0xe6f4ff, 1.15);
ego.position.set(0, 0, 0);
scene.add(ego);
const tracked = new THREE.Group();
scene.add(tracked);
let azimuth = 0.28,
  elevation = 0.9,
  zoom = 42,
  drag = false,
  startX = 0,
  startY = 0,
  selectedCamera = 'front',
  index = 20,
  selectedTarget = null;
function placeCamera() {
  camera.position.set(
    Math.sin(azimuth) * zoom * Math.cos(elevation),
    zoom * Math.sin(elevation),
    Math.cos(azimuth) * zoom * Math.cos(elevation),
  );
  camera.lookAt(0, 0, -3);
}
placeCamera();
function estimateItem(item, view) {
  if (item.score < 0.6) return { valid: false, reason: '检测置信度不足' };
  const info = cameraInfo[view];
  return estimateDistance(
    item,
    { fov: cameraFov[view], aspect: info.width / info.height },
    detections[index][view],
  );
}
function entriesAt(moment) {
  const entries = [];
  for (const [view, items] of Object.entries(moment))
    for (const [itemIndex, item] of items.entries()) {
      if (item.score < 0.6) continue;
      const estimate = estimateItem(item, view);
      entries.push({
        ...item,
        view,
        itemIndex,
        estimate,
        angle:
          THREE.MathUtils.degToRad(cameraAngles[view]) +
          (estimate.bearing || 0),
        distance: estimate.distance,
      });
    }
  return entries.sort((a, b) => b.score - a.score);
}
function distanceSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(6,20,30,.88)';
  context.fillRect(0, 0, 256, 72);
  context.font = 'bold 30px sans-serif';
  context.fillStyle = '#b2ffdf';
  context.textAlign = 'center';
  context.fillText(text, 128, 47);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.scale.set(4, 1.125, 1);
  return sprite;
}
function clearTracked() {
  const geometries = new Set(),
    materials = new Set();
  tracked.traverse((child) => {
    if (
      child.geometry &&
      ![bodyGeo, cabinGeo, wheelGeo, hubGeo].includes(child.geometry)
    )
      geometries.add(child.geometry);
    if (
      child.material &&
      ![glassMat, wheelMat, hubMat].includes(child.material)
    )
      materials.add(child.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    material.map?.dispose();
    material.dispose();
  }
  tracked.clear();
}
function updateWorld() {
  clearTracked();
  const entries = entriesAt(detections[index]);
  const visibleEntries = entries.filter((item) => item.view === selectedCamera);
  for (const item of visibleEntries) {
    if (!item.estimate.valid) continue;
    const model =
      item.kind === 'person'
        ? person()
        : item.kind === 'bus'
          ? car(colors.bus, 1, true)
          : item.kind === 'truck'
            ? car(colors.truck, 1, true)
            : item.kind === 'car'
              ? car(colors.car)
              : bike(item.kind);
    const [originX, originZ] = cameraOrigins[item.view];
    model.position.set(
      originX + Math.sin(item.angle) * item.distance,
      0,
      originZ - Math.cos(item.angle) * item.distance,
    );
    model.rotation.y = item.kind === 'person' ? 0 : item.angle;
    model.userData = {
      view: item.view,
      itemIndex: item.itemIndex,
      kind: item.kind,
      score: item.score,
    };
    if (
      selectedTarget?.view === item.view &&
      selectedTarget.itemIndex === item.itemIndex
    ) {
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(2.1, 2.2, 40),
        new THREE.MeshBasicMaterial({
          color: 0xed6763,
          side: THREE.DoubleSide,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.07;
      model.add(halo);
    }
    if (item.view === selectedCamera) {
      const label = distanceSprite(distanceText(item.estimate));
      label.position.y =
        item.kind === 'bus' || item.kind === 'truck' ? 3.5 : 2.8;
      model.add(label);
    }
    tracked.add(model);
  }
  const count = {};
  for (const entry of visibleEntries)
    count[entry.kind] = (count[entry.kind] || 0) + 1;
  document.getElementById('counts').textContent =
    Object.entries(labels)
      .filter(([key]) => count[key])
      .map(([key, name]) => `${name} ${count[key]}`)
      .join(' · ') || '暂无识别目标';
  document.getElementById('total').textContent =
    `${cameraLabels[selectedCamera]}：估距 ${visibleEntries.filter((e) => e.estimate.valid).length} / 检出 ${visibleEntries.length}`;
  document.getElementById('object-list').innerHTML =
    entries
      .map(
        (entry) =>
          `<button type="button" class="${selectedTarget?.view === entry.view && selectedTarget.itemIndex === entry.itemIndex ? 'active' : ''}" data-camera="${entry.view}" data-index="${entry.itemIndex}" title="${distanceRangeText(entry.estimate)} · ${entry.estimate.reason}"><span class="object-dot" style="background:#${colors[entry.kind].toString(16).padStart(6, '0')}"></span><span>${labels[entry.kind]} · ${cameraLabels[entry.view]}</span><small>${distanceText(entry.estimate)}</small></button>`,
      )
      .join('') || '<span class="empty">当前画面未检出目标</span>';
  document
    .querySelectorAll('#object-list button')
    .forEach((button) =>
      button.addEventListener('click', () =>
        selectTarget(button.dataset.camera, Number(button.dataset.index)),
      ),
    );
}
function updateFeed() {
  document.getElementById('feed-lanes').innerHTML = laneSvg(selectedCamera);
  document.getElementById('feed').src = frames[selectedCamera][index];
  document.getElementById('feed-name').textContent =
    cameraLabels[selectedCamera];
  document.getElementById('distance-camera').textContent =
    cameraLabels[selectedCamera];
  document.getElementById('distance-fov').value = cameraFov[selectedCamera];
  document
    .querySelectorAll('[data-view]')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.view === selectedCamera),
    );
  const layer = document.getElementById('boxes');
  layer.innerHTML = '';
  const focus = document.getElementById('focus-readout');
  const focusedItem =
    selectedTarget?.view === selectedCamera
      ? detections[index][selectedCamera][selectedTarget.itemIndex]
      : null;
  const focusedEstimate = focusedItem
    ? estimateItem(focusedItem, selectedCamera)
    : null;
  focus.textContent = focusedItem
    ? `${labels[focusedItem.kind]} · ${cameraLabels[selectedCamera]} · ${Math.round(focusedItem.score * 100)}% · ${distanceText(focusedEstimate)}${focusedEstimate.valid ? '（假设范围 ' + distanceRangeText(focusedEstimate) + '）' : ' · ' + focusedEstimate.reason}`
    : '点击车辆图标或目标列表，查看它来自哪个镜头';
  for (const [itemIndex, item] of detections[index][selectedCamera].entries()) {
    const estimate = estimateItem(item, selectedCamera);
    const [x1, y1, x2, y2] = item.box;
    const box = document.createElement('div');
    box.className = 'detection';
    const color = '#' + colors[item.kind].toString(16).padStart(6, '0');
    box.style.cssText = `left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%;border-color:${color}`;
    if (
      selectedTarget?.view === selectedCamera &&
      selectedTarget.itemIndex === itemIndex
    ) {
      box.classList.add('selected');
      box.style.borderColor = '#ed6763';
    }
    box.innerHTML = `<span style="background:${color}">${labels[item.kind]} ${Math.round(item.score * 100)}%<br>${distanceText(estimate)}${estimate.valid ? ' · ' + distanceRangeText(estimate) : ''}</span>`;
    layer.appendChild(box);
  }
}
function selectCamera(view) {
  selectedCamera = view;
  selectedTarget = null;
  updateWorld();
  updateLanes();
  updateFeed();
  updateSixViews();
}
function selectTarget(view, itemIndex) {
  selectedCamera = view;
  selectedTarget = { view, itemIndex };
  updateWorld();
  updateLanes();
  updateFeed();
  updateSixViews();
}
function showFrame(value) {
  const next = Math.max(0, Math.min(detections.length - 1, value));
  if (next !== index) selectedTarget = null;
  index = next;
  document.getElementById('seek').value = index;
  document.getElementById('time').textContent =
    `${String(index).padStart(2, '0')} / ${detections.length - 1} 秒`;
  updateWorld();
  updateLanes();
  updateFeed();
  updateSixViews();
}
let timer = null;
const play = document.getElementById('play');
function stop() {
  clearInterval(timer);
  timer = null;
  play.textContent = '▶ 播放';
}
play.addEventListener('click', () => {
  if (timer) {
    stop();
    return;
  }
  play.textContent = '❚❚ 暂停';
  timer = setInterval(() => showFrame((index + 1) % detections.length), 1000);
});
document
  .getElementById('seek')
  .addEventListener('input', (e) => showFrame(+e.target.value));
document
  .querySelectorAll('[data-view]')
  .forEach((b) =>
    b.addEventListener('click', () => selectCamera(b.dataset.view)),
  );
function resize() {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (
    canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
    canvas.height !== Math.round(h * renderer.getPixelRatio())
  ) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
function animate() {
  requestAnimationFrame(animate);
  resize();
  renderer.render(scene, camera);
}
animate();
canvas.addEventListener('pointerdown', (e) => {
  drag = true;
  startX = e.clientX;
  startY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  azimuth += (e.clientX - startX) * 0.006;
  elevation = THREE.MathUtils.clamp(
    elevation + (e.clientY - startY) * 0.004,
    0.2,
    1.4,
  );
  startX = e.clientX;
  startY = e.clientY;
  placeCamera();
});
canvas.addEventListener('pointerup', () => (drag = false));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.001), 22, 65);
    placeCamera();
  },
  { passive: false },
);
canvas.addEventListener('dblclick', () => {
  azimuth = 0.28;
  elevation = 0.9;
  zoom = 42;
  placeCamera();
});
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -(((e.clientY - rect.top) / rect.height) * 2 - 1),
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(tracked.children, true)[0];
  let target = hit?.object;
  while (target && !target.userData.view) target = target.parent;
  if (target?.userData.view)
    selectTarget(target.userData.view, target.userData.itemIndex);
});
const sixOrder = [
  'left_pillar',
  'front',
  'right_pillar',
  'left',
  'back',
  'right',
];
const sixGrid = document.getElementById('six-road-grid');
for (const view of sixOrder) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'mini-view';
  tile.dataset.camera = view;
  tile.innerHTML =
    '<img alt="' +
    cameraLabels[view] +
    '"><div class="road-overlay"></div><svg class="lane-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg><div class="mini-boxes"></div><span class="mini-label"></span>';
  tile.addEventListener('click', () => selectCamera(view));
  sixGrid.appendChild(tile);
}
function updateSixViews() {
  for (const tile of sixGrid.children) {
    const view = tile.dataset.camera;
    tile.classList.toggle('active', view === selectedCamera);
    tile.querySelector('img').src = frames[view][index];
    const road = roadFrames[view]?.[index];
    tile.querySelector('.road-overlay').style.maskImage = road
      ? `url("${road}")`
      : 'none';
    tile.querySelector('.road-overlay').hidden = !road;
    tile.querySelector('.lane-overlay').innerHTML = laneSvg(view);
    const items = detections[index][view] || [];
    tile.querySelector('.mini-label').textContent =
      `${cameraLabels[view]} · ${items.length} 个目标`;
    tile.querySelector('.mini-boxes').innerHTML = items
      .map((item) => {
        const [x1, y1, x2, y2] = item.box;
        return `<span class="mini-box" style="left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%"></span>`;
      })
      .join('');
  }
}
for (const [id, key] of [
  ['show-lanes', 'lines'],
  ['show-boundaries', 'boundaries'],
]) {
  document.getElementById(id).addEventListener('change', (event) => {
    laneControls[key] = event.target.checked;
    updateLanes();
    updateFeed();
    updateSixViews();
  });
}
document.getElementById('distance-fov').addEventListener('change', (event) => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value) || value < 30 || value > 145) {
    event.target.value = cameraFov[selectedCamera];
    return;
  }
  cameraFov[selectedCamera] = value;
  updateWorld();
  updateFeed();
});
showFrame(index);
