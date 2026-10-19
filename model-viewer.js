import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Interactive, price-free view of the supplied concept geometry.
 * GLB coordinates: metres, Y up. Only public quote codes are exposed by events.
 * All rendering is event driven; there is no idle animation loop.
 */
export async function createModelViewer(container, { onSelect, onStatus } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('A viewer container is required.');

  let disposed = false;
  let scheduledFrame = 0;
  let selectedCode = null;
  let isolated = false;
  let currentView = 'iso';
  let ready = false;
  let model = null;
  let renderer;
  let resizeObserver;
  let pointerStart = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let hasInitialFrame = false;
  const entries = [];
  const pickable = [];
  const codeEntries = new Map();
  const zoneBounds = new Map();
  const allBounds = new THREE.Box3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f7fb');

  const status = (state, details = {}) => {
    if (disposed && state !== 'error') return;
    container.dataset.state = state;
    container.dataset.selection = selectedCode || '';
    container.dataset.isolated = String(isolated);
    if (typeof onStatus === 'function') {
      onStatus({ state, isolated, selectedCode, view: currentView, ...details });
    }
  };

  const notifyReady = () => status('ready', {
    message: '3D 모델 준비 완료',
    meshCount: entries.filter(entry => !entry.environment).length,
    mappedCodes: [...codeEntries.keys()].sort(),
    selectionMapped: selectedCode ? codeEntries.has(selectedCode) : false,
  });

  status('loading', { message: '3D 개념형상을 불러오고 있습니다.', progress: 0 });
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    status('error', { message: '이 브라우저에서는 3D 화면을 사용할 수 없습니다. 품목 이미지를 확인해 주세요.' });
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.setClearColor(scene.background);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  renderer.domElement.setAttribute('aria-label', '정밀조립 Zone 3D 개념형상. 드래그로 회전하고 스크롤로 확대합니다. 장비를 클릭하면 품목을 선택합니다.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
  camera.position.set(25, 30, 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI / 2 - 0.015;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.65;
  controls.panSpeed = 0.7;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

  scene.add(new THREE.HemisphereLight('#ffffff', '#b4c3d5', 2.45));
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.7);
  keyLight.position.set(12, 24, 14);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#e7efff', 1.0);
  fillLight.position.set(-12, 12, -10);
  scene.add(fillLight);

  const edgeMaterials = {
    full: new THREE.LineBasicMaterial({ color: '#32455b', transparent: true, opacity: 0.6, depthWrite: false }),
    selected: new THREE.LineBasicMaterial({ color: '#16354c', transparent: true, opacity: 0.95, depthWrite: false }),
    muted: new THREE.LineBasicMaterial({ color: '#71849b', transparent: true, opacity: 0.45, depthWrite: false }),
    environment: new THREE.LineBasicMaterial({ color: '#9bacbd', transparent: true, opacity: 0.28, depthWrite: false }),
  };

  function render() {
    scheduledFrame = 0;
    if (disposed || !renderer || !lastWidth || !lastHeight) return;
    renderer.render(scene, camera);
  }

  function requestRender() {
    if (!disposed && !scheduledFrame) scheduledFrame = requestAnimationFrame(render);
  }

  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    if (width <= 0 || height <= 0) return;
    const changed = width !== lastWidth || height !== lastHeight;
    lastWidth = width;
    lastHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (ready && !hasInitialFrame) {
      hasInitialFrame = true;
      fitBounds(allBounds, 'iso');
    } else if (changed && ready) {
      // Keep the selected item visible when changing between narrow and wide layouts.
      const boundsToFit = isolated ? selectionBounds() : currentBounds();
      fitBounds(boundsToFit, null);
    }
    requestRender();
  }

  function directionFor(view) {
    return view === 'top'
      ? new THREE.Vector3(0, 1, 0.001).normalize()
      : new THREE.Vector3(1.05, 1.12, 1.15).normalize();
  }

  function currentBounds() {
    return zoneBounds.get(currentView) || allBounds;
  }

  function selectionBounds() {
    const bounds = new THREE.Box3();
    for (const entry of codeEntries.get(selectedCode) || []) bounds.union(entry.bounds);
    return bounds;
  }

  function fitBounds(bounds, view = 'iso') {
    if (disposed || bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = view
      ? directionFor(view)
      : camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.9) direction.copy(directionFor('iso'));
    camera.position.copy(center).add(direction);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const halfVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const halfHorizontal = halfVertical * Math.max(camera.aspect, 0.1);
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          const depth = corner.dot(direction);
          distance = Math.max(distance,
            Math.abs(corner.dot(right)) / halfHorizontal + depth,
            Math.abs(corner.dot(up)) / halfVertical + depth);
        }
      }
    }
    distance = Math.max(distance * 1.04, 0.35);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.target.copy(center);
    camera.near = Math.max(0.002, distance / 2000);
    camera.far = Math.max(200, distance * 30);
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(0.08, Math.min(distance * 0.03, 0.4));
    controls.maxDistance = Math.max(90, distance * 5);
    controls.update();
    requestRender();
  }

  function appearance() {
    const hasMapping = selectedCode && codeEntries.has(selectedCode);
    for (const entry of entries) {
      const selected = hasMapping && entry.codes.includes(selectedCode);
      const muted = hasMapping && !selected && !entry.environment;
      entry.mesh.visible = !isolated || selected || entry.environment;
      entry.material.color.copy(entry.environment ? entry.baseColor : muted ? entry.mutedColor : entry.baseColor);
      entry.material.roughness = selected ? 0.65 : 0.82;
      entry.edges.material = entry.environment
        ? edgeMaterials.environment
        : selected ? edgeMaterials.selected : muted ? edgeMaterials.muted : edgeMaterials.full;
    }
    requestRender();
  }

  function select(code) {
    selectedCode = typeof code === 'string' && code ? code : null;
    if (!codeEntries.has(selectedCode)) isolated = false;
    appearance();
    if (isolated) fitBounds(selectionBounds(), 'iso');
    if (ready) notifyReady();
  }

  function setIsolated(value) {
    const wasIsolated = isolated;
    isolated = Boolean(value && selectedCode && codeEntries.has(selectedCode));
    appearance();
    if (ready) {
      if (isolated || wasIsolated !== isolated) {
        fitBounds(isolated ? selectionBounds() : currentBounds(), isolated ? 'iso' : currentView);
      }
      notifyReady();
    }
  }

  function setView(view) {
    if (!['iso', 'top', 'SCREW', 'PRESS', 'SORT'].includes(view)) return;
    currentView = view;
    isolated = false;
    appearance();
    if (ready) {
      fitBounds(currentBounds(), currentView === 'top' ? 'top' : 'iso');
      notifyReady();
    }
  }

  function focusSelection() {
    if (!ready || !codeEntries.has(selectedCode)) return false;
    fitBounds(selectionBounds(), 'iso');
    return true;
  }

  function zoom(factor) {
    if (disposed || !Number.isFinite(factor) || factor <= 0) return;
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() / factor, controls.minDistance, controls.maxDistance);
    offset.setLength(distance);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    requestRender();
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const nearest = raycaster.intersectObjects(pickable.filter(mesh => mesh.visible), false)[0]?.object;
    return nearest?.userData.publicQuoteCodes?.length ? nearest : null;
  }

  function onPointerDown(event) {
    if (event.isPrimary && event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false };
    else pointerStart = null;
  }

  function onPointerUp(event) {
    const started = pointerStart;
    pointerStart = null;
    if (!started || started.id !== event.pointerId || started.dragged || !ready) return;
    if ((event.clientX - started.x) ** 2 + (event.clientY - started.y) ** 2 > 36) return;
    const mesh = pick(event);
    if (mesh && typeof onSelect === 'function') onSelect([...mesh.userData.publicQuoteCodes]);
  }

  function onPointerMove(event) {
    if (pointerStart?.id === event.pointerId &&
        (event.clientX - pointerStart.x) ** 2 + (event.clientY - pointerStart.y) ** 2 > 36) {
      pointerStart.dragged = true;
    }
    if (event.buttons || !ready || event.pointerType === 'touch') return;
    renderer.domElement.style.cursor = pick(event) ? 'pointer' : 'grab';
  }

  function onPointerCancel() { pointerStart = null; }

  function onKeyDown(event) {
    if (event.key === '+' || event.key === '=') { zoom(1.25); event.preventDefault(); }
    if (event.key === '-' || event.key === '_') { zoom(0.8); event.preventDefault(); }
    if (event.key.toLowerCase() === 'r') { setView('iso'); event.preventDefault(); }
  }

  function onContextLost(event) {
    event.preventDefault();
    status('error', { message: '3D 화면 연결이 중단되었습니다. 품목 이미지를 확인하거나 새로고침해 주세요.' });
  }

  async function loadPublicModel() {
    const loader = new GLTFLoader();
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const response = await fetch('./assets/assembly.glb.gz');
        if (!response.ok) throw new Error('Compressed model unavailable.');
        const total = Number(response.headers.get('Content-Length'));
        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          status('loading', {
            message: '3D 개념형상을 불러오고 있습니다.',
            progress: total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : undefined,
          });
        }
        const bytes = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        // Some hosts decode gzip through their HTTP headers; support both responses.
        const binary = bytes[0] === 0x1f && bytes[1] === 0x8b
          ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
          : bytes.buffer;
        status('loading', { message: '3D 형상을 구성하고 있습니다.', progress: 100 });
        return await loader.parseAsync(binary, './assets/');
      } catch {
        // Older browsers and hosts without the compressed asset can use the same GLB.
      }
    }
    return loader.loadAsync('./assets/assembly.glb', progress => {
      status('loading', {
        message: '3D 개념형상을 불러오고 있습니다.',
        progress: progress.total ? Math.round(progress.loaded / progress.total * 100) : undefined,
      });
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    controls.removeEventListener('change', requestRender);
    controls.dispose();
    const canvas = renderer.domElement;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    const geometries = new Set();
    const materials = new Set(Object.values(edgeMaterials));
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    renderer.dispose();
    canvas.remove();
    delete container.dataset.selection;
    delete container.dataset.isolated;
    container.dataset.state = 'disposed';
  }

  controls.addEventListener('change', requestRender);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  renderer.domElement.addEventListener('keydown', onKeyDown);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
  } else window.addEventListener('resize', resize);
  resize();

  try {
    const gltf = await loadPublicModel();
    model = gltf.scene;
    model.updateMatrixWorld(true);
    const originalMaterials = new Set();
    const meshes = [];
    model.traverse(object => { if (object.isMesh) meshes.push(object); });
    for (const mesh of meshes) {
      let metadata = mesh.userData;
      for (let parent = mesh.parent; !Array.isArray(metadata.quoteCodes) && parent; parent = parent.parent) {
        if (Array.isArray(parent.userData.quoteCodes) || parent.userData.role) metadata = parent.userData;
      }
      const codes = [...new Set((metadata.quoteCodes || []).filter(code => typeof code === 'string' && /^[A-Z]\d{2}$/.test(code)))];
      const environment = metadata.role === 'environment';
      const zone = metadata.zone || 'COMMON';
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      sourceMaterials.forEach(material => originalMaterials.add(material));
      const baseColor = environment
        ? new THREE.Color('#e5ebf2')
        : sourceMaterials[0]?.color?.clone() || new THREE.Color('#4789d8');
      const material = new THREE.MeshStandardMaterial({
        color: baseColor, roughness: 0.82, metalness: 0.04,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      mesh.material = material;
      mesh.userData.publicQuoteCodes = codes;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeMaterials.full);
      edges.renderOrder = 1;
      mesh.add(edges);
      const bounds = new THREE.Box3().setFromObject(mesh);
      const entry = { mesh, material, edges, codes, zone, environment, baseColor, mutedColor: new THREE.Color('#c6d1df'), bounds };
      entries.push(entry);
      if (!environment) {
        // Unmapped context surfaces still occlude equipment behind them when picking.
        pickable.push(mesh);
        allBounds.union(bounds);
        if (!zoneBounds.has(zone)) zoneBounds.set(zone, new THREE.Box3());
        zoneBounds.get(zone).union(bounds);
      }
      if (codes.length && !environment) {
        for (const code of codes) {
          if (!codeEntries.has(code)) codeEntries.set(code, []);
          codeEntries.get(code).push(entry);
        }
      }
    }
    originalMaterials.forEach(material => material?.dispose());
    if (allBounds.isEmpty()) throw new Error('No equipment geometry in public model.');
    scene.add(model);
    ready = true;
    appearance();
    if (lastWidth && lastHeight) {
      hasInitialFrame = true;
      fitBounds(allBounds, 'iso');
    }
    notifyReady();
  } catch (error) {
    dispose();
    status('error', { message: '3D 개념형상을 불러오지 못했습니다. 품목 이미지를 확인해 주세요.' });
    throw error;
  }

  return { select, setIsolated, setView, focusSelection, resize, zoom, dispose };
}
