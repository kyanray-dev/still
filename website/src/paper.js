import * as THREE from 'three';

/** A small, self-contained paper sculpture. The surrounding page supplies the fallback. */
export function mountPaperScene(host) {
  const noop = () => {};
  const fallback = () => {
    host.classList.remove('scene-ready');
    host.dataset.sceneState = 'fallback';
    return { setTheme: noop, setPaused: noop, dispose: noop };
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    return fallback();
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.className = 'paper-canvas';
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-3, 3, 2.65, -2.65, 0.1, 30);
  camera.position.set(0, 0, 9);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.HemisphereLight(0xffffff, 0xc8cbc5, 1.35);
  const key = new THREE.DirectionalLight(0xfffdf3, 2.65);
  key.position.set(-3.8, 4.5, 5);
  const fill = new THREE.DirectionalLight(0xe9f0ed, 0.4);
  fill.position.set(4, -1, 3);
  scene.add(ambient, key, fill);

  const width = 2.72;
  const height = 3.48;
  const columns = 44;
  const rows = 48;
  const paperGeometry = new THREE.PlaneGeometry(width, height, columns, rows);
  const positions = paperGeometry.attributes.position;
  const rest = new Float32Array(positions.array);

  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = 1024;
  pageCanvas.height = 1310;
  const pageContext = pageCanvas.getContext('2d');
  if (!pageContext) {
    paperGeometry.dispose();
    renderer.dispose();
    return fallback();
  }
  const pageTexture = new THREE.CanvasTexture(pageCanvas);
  pageTexture.colorSpace = THREE.SRGBColorSpace;
  pageTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: pageTexture,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);

  // A hairline ribbon makes the sheet readable without giving it a block-like edge.
  const perimeter = [];
  for (let x = 0; x <= columns; x += 1) perimeter.push(x);
  for (let y = 1; y <= rows; y += 1) perimeter.push(y * (columns + 1) + columns);
  for (let x = columns - 1; x >= 0; x -= 1) perimeter.push(rows * (columns + 1) + x);
  for (let y = rows - 1; y > 0; y -= 1) perimeter.push(y * (columns + 1));
  perimeter.push(perimeter[0]);
  const edgePositions = new Float32Array(perimeter.length * 6);
  const edgeIndices = [];
  for (let i = 0; i < perimeter.length - 1; i += 1) {
    const index = i * 2;
    edgeIndices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
  }
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeGeometry.setIndex(edgeIndices);
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xd9ddd6, side: THREE.DoubleSide });
  const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);

  const sculpture = new THREE.Group();
  sculpture.add(paper, edge);
  scene.add(sculpture);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const shadowContext = shadowCanvas.getContext('2d');
  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(40, 54, 43, 0.22)');
    gradient.addColorStop(0.26, 'rgba(40, 54, 43, 0.15)');
    gradient.addColorStop(0.58, 'rgba(40, 54, 43, 0.045)');
    gradient.addColorStop(1, 'rgba(40, 54, 43, 0)');
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 256, 256);
  }
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  const shadowGeometry = new THREE.PlaneGeometry(4.7, 1.05);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.set(0.15, -1.97, -0.7);
  shadow.rotation.z = -0.12;
  scene.add(shadow);

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  let dark = false;
  let disposed = false;
  let contextLost = false;
  let manuallyPaused = false;
  let inView = true;
  let frame = 0;
  let previousFrame = 0;
  let elapsed = 0;
  let targetX = 0;
  let targetY = 0;
  let pointerX = 0;
  let pointerY = 0;

  function paintPage() {
    pageContext.fillStyle = dark ? '#555653' : '#fffef9';
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.fillStyle = dark ? 'rgba(221,222,215,0.34)' : 'rgba(90,105,91,0.35)';
    pageContext.font = '42px Georgia, "Times New Roman", serif';
    pageContext.fillText('Still.', 134, 210);
    pageContext.fillStyle = dark ? 'rgba(221,222,215,0.19)' : 'rgba(90,105,91,0.19)';
    pageContext.font = '19px Georgia, "Times New Roman", serif';
    pageContext.fillText('A little space for your thoughts.', 136, 269);
    pageContext.fillText('Nothing more. Nothing in the way.', 136, 307);
    pageTexture.needsUpdate = true;
  }

  function updatePaper() {
    const breath = reducedMotion ? 0 : Math.sin(elapsed * (Math.PI * 2 / 10.8));
    for (let i = 0; i < positions.count; i += 1) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const upper = Math.pow(Math.max(0, (y / height) + 0.5), 4);
      const right = Math.pow(Math.max(0, (x / width) + 0.5), 3);
      const bow = 0.155 * x * x + 0.045 * x * y + 0.018 * y * y;
      const curl = upper * right * (0.5 + breath * 0.15);
      // Let the lifted corner turn inward slightly, like a loose sheet under its own weight.
      positions.setX(i, x - curl * 0.16);
      positions.setY(i, y - curl * 0.2);
      positions.setZ(i, bow + curl + breath * 0.072 * Math.cos(y * 0.75 + x * 0.4));
    }
    positions.needsUpdate = true;
    paperGeometry.computeVertexNormals();
    for (let i = 0; i < perimeter.length; i += 1) {
      const vertex = perimeter[i];
      const offset = i * 6;
      edgePositions[offset] = edgePositions[offset + 3] = positions.getX(vertex);
      edgePositions[offset + 1] = edgePositions[offset + 4] = positions.getY(vertex);
      edgePositions[offset + 2] = positions.getZ(vertex) + 0.001;
      edgePositions[offset + 5] = positions.getZ(vertex) - 0.004;
    }
    edgeGeometry.attributes.position.needsUpdate = true;
    if (reducedMotion) {
      pointerX = 0;
      pointerY = 0;
    } else {
      pointerX += (targetX - pointerX) * 0.045;
      pointerY += (targetY - pointerY) * 0.045;
    }
    sculpture.rotation.set(-0.18 + breath * 0.035 + pointerY * 0.04, -0.34 + Math.sin(elapsed * 0.39) * (reducedMotion ? 0 : 0.065) + pointerX * 0.06, -0.18 + breath * 0.026);
    sculpture.position.set(0.02 + breath * 0.045, 0.07 + breath * 0.16, 0);
    key.position.x = -3.8 + (reducedMotion ? 0 : Math.sin(elapsed * 0.27) * 1.25);
    key.position.y = 4.5 + breath * 0.35;
    shadow.scale.setScalar(1 - breath * 0.055);
    shadow.position.x = 0.15 + breath * 0.07;
    shadowMaterial.opacity = (dark ? 0.2 : 0.8) - breath * 0.065;
  }

  function showFallback() {
    contextLost = true;
    window.cancelAnimationFrame(frame);
    frame = 0;
    renderer.domElement.style.visibility = 'hidden';
    host.classList.remove('scene-ready');
    host.dataset.sceneState = 'fallback';
  }

  function draw() {
    if (disposed || contextLost) return;
    try {
      updatePaper();
      renderer.render(scene, camera);
    } catch {
      showFallback();
    }
  }

  function active() {
    return !disposed && !contextLost && !manuallyPaused && inView && !document.hidden && !reducedMotion;
  }

  function tick(now) {
    frame = 0;
    if (!active()) return;
    if (now - previousFrame >= 1000 / 30) {
      elapsed += Math.min((now - previousFrame) / 1000, 0.05);
      previousFrame = now;
      draw();
    }
    if (active()) frame = window.requestAnimationFrame(tick);
  }

  function syncPlayback() {
    window.cancelAnimationFrame(frame);
    frame = 0;
    previousFrame = performance.now();
    if (active()) frame = window.requestAnimationFrame(tick);
  }

  function resize() {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    const sceneWidth = Math.max(1, bounds.width);
    const sceneHeight = Math.max(1, bounds.height);
    const aspect = sceneWidth / sceneHeight;
    // Preserve the entire sheet in a narrow mobile viewport.
    const frustumHeight = aspect < 0.9 ? 5.45 : 5.15;
    camera.top = frustumHeight / 2;
    camera.bottom = -frustumHeight / 2;
    camera.left = -frustumHeight * aspect / 2;
    camera.right = frustumHeight * aspect / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(sceneWidth, sceneHeight, false);
    draw();
  }

  function pointerMove(event) {
    if (reducedMotion || !inView) return;
    const bounds = host.getBoundingClientRect();
    targetX = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
    targetY = THREE.MathUtils.clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1);
  }

  function pointerLeave() {
    targetX = 0;
    targetY = 0;
  }

  function motionChange(event) {
    reducedMotion = event.matches;
    draw();
    syncPlayback();
  }

  function contextLostHandler(event) {
    event.preventDefault();
    showFallback();
  }

  function contextRestoredHandler() {
    contextLost = false;
    resize();
    if (!contextLost) {
      renderer.domElement.style.visibility = 'visible';
      host.classList.add('scene-ready');
      host.dataset.sceneState = 'ready';
      syncPlayback();
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver((entries) => {
    inView = entries[0]?.isIntersecting ?? false;
    syncPlayback();
  }, { rootMargin: '40px' });

  host.appendChild(renderer.domElement);
  host.addEventListener('pointermove', pointerMove, { passive: true });
  host.addEventListener('pointerleave', pointerLeave, { passive: true });
  document.addEventListener('visibilitychange', syncPlayback);
  motionQuery.addEventListener('change', motionChange);
  renderer.domElement.addEventListener('webglcontextlost', contextLostHandler);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestoredHandler);
  paintPage();
  resize();
  if (!contextLost) {
    host.classList.add('scene-ready');
    host.dataset.sceneState = 'ready';
  }
  resizeObserver.observe(host);
  intersectionObserver.observe(host);
  syncPlayback();

  return {
    setTheme(isDark) {
      dark = Boolean(isDark);
      ambient.intensity = dark ? 1.15 : 1.35;
      ambient.groundColor.set(dark ? 0x929390 : 0xc8cbc5);
      key.intensity = dark ? 2.15 : 2.65;
      key.color.set(dark ? 0xf6f5f1 : 0xfffdf3);
      fill.color.set(dark ? 0xededee : 0xe9f0ed);
      edgeMaterial.color.set(dark ? 0x70716c : 0xd9ddd6);
      paintPage();
      draw();
    },
    setPaused(value) {
      manuallyPaused = Boolean(value);
      syncPlayback();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      host.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('pointerleave', pointerLeave);
      document.removeEventListener('visibilitychange', syncPlayback);
      motionQuery.removeEventListener('change', motionChange);
      renderer.domElement.removeEventListener('webglcontextlost', contextLostHandler);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestoredHandler);
      paperGeometry.dispose();
      edgeGeometry.dispose();
      shadowGeometry.dispose();
      paperMaterial.dispose();
      edgeMaterial.dispose();
      shadowMaterial.dispose();
      pageTexture.dispose();
      shadowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      host.classList.remove('scene-ready');
      host.dataset.sceneState = 'fallback';
    },
  };
}
