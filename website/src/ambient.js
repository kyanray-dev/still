import * as THREE from 'three';

/** A continuous, softly lit paper landscape behind the still page. */
export function mountAmbientScene(host) {
  const noop = () => {};
  let renderer;
  let geometry;
  let material;
  let resizeObserver;
  let disposed = false;
  let contextLost = false;
  let manuallyPaused = false;
  let frame = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let removeListeners = noop;

  const markFallback = () => {
    host.classList.remove('scene-ready');
    host.dataset.sceneState = 'fallback';
  };

  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      depth: false,
      stencil: false,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'ambient-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none';

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 30);
    camera.position.set(0, 0, 12);
    const uniforms = {
      uTime: { value: 0 },
      uBounds: { value: new THREE.Vector2(9, 7) },
      uMobile: { value: 0 },
      uOpacity: { value: 0.34 },
      uShadow: { value: new THREE.Color('#879385') },
      uLight: { value: new THREE.Color('#ffffff') },
    };
    geometry = new THREE.PlaneGeometry(2, 2, 160, 112);
    material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uBounds;
        varying vec3 vViewPosition;
        varying vec2 vScreen;

        void main() {
          vec2 p = position.xy * uBounds;
          float t = uTime;
          // Intersecting long swells make curved folds, without a repeating grid.
          float diagonal = p.x * 0.49 + p.y * 0.39;
          float crosswise = p.x * -0.23 + p.y * 0.41;
          float height = sin(diagonal - t * 0.24
            + sin(crosswise + t * 0.11) * 0.86) * 0.91;
          height += sin(p.x * 0.23 - p.y * 0.36 + t * 0.18) * 0.55;
          height += sin(p.x * 0.79 + p.y * 0.24 - t * 0.29) * 0.17;
          height += cos(p.y * 0.17 + p.x * 0.12 + t * 0.08) * 0.27;
          p.x += sin(p.y * 0.24 + t * 0.13) * 0.14;
          p.y += sin(p.x * 0.18 - t * 0.10) * 0.09;
          vec4 viewPosition = modelViewMatrix * vec4(p, height, 1.0);
          vec4 clipPosition = projectionMatrix * viewPosition;
          vViewPosition = viewPosition.xyz;
          vScreen = clipPosition.xy / clipPosition.w * 0.5 + 0.5;
          gl_Position = clipPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uMobile;
        uniform float uOpacity;
        uniform vec3 uShadow;
        uniform vec3 uLight;
        varying vec3 vViewPosition;
        varying vec2 vScreen;

        void main() {
          // Real displaced geometry supplies the lighting normals; no image texture.
          vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
          vec3 key = normalize(vec3(
            -0.54 + sin(uTime * 0.07) * 0.14,
            0.63 + cos(uTime * 0.09) * 0.12,
            0.48
          ));
          float diffuse = max(dot(normal, key), 0.0);
          float softFill = max(dot(normal, normalize(vec3(0.7, -0.3, 0.6))), 0.0);
          vec3 halfVector = normalize(key + vec3(0.0, 0.0, 1.0));
          float sheen = pow(max(dot(normal, halfVector), 0.0), 18.0);
          float light = smoothstep(0.10, 0.94, diffuse * 0.88 + softFill * 0.12);
          vec3 color = mix(uShadow, uLight, light);
          color = mix(color, uLight, sheen * 0.12);

          // Leave the reading column nearly untouched. Let the air move around it.
          float desktopMask = 0.06 + smoothstep(0.18, 0.84, vScreen.x) * 0.94;
          desktopMask *= 0.48 + (1.0 - vScreen.y) * 0.52;
          float mobileMask = 0.035 + (1.0 - smoothstep(0.08, 0.77, vScreen.y)) * 0.965;
          float mask = mix(desktopMask, mobileMask, uMobile);
          gl_FragColor = vec4(color, uOpacity * mask);
          #include <colorspace_fragment>
        }
      `,
    });
    const surface = new THREE.Mesh(geometry, material);
    // Deformation happens on the GPU, beyond the flat geometry's original bounds.
    surface.frustumCulled = false;
    scene.add(surface);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;

    function showFallback(event) {
      event?.preventDefault?.();
      contextLost = true;
      window.cancelAnimationFrame(frame);
      frame = 0;
      renderer.domElement.style.visibility = 'hidden';
      markFallback();
    }

    function draw() {
      if (disposed || contextLost) return;
      try {
        uniforms.uTime.value = elapsed;
        renderer.render(scene, camera);
      } catch {
        showFallback();
      }
    }

    function active() {
      return !disposed && !contextLost && !manuallyPaused && !reducedMotion && !document.hidden;
    }

    function tick(now) {
      frame = 0;
      if (!active()) return;
      if (now - lastFrame >= 1000 / 24) {
        elapsed += Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;
        draw();
      }
      if (active()) frame = window.requestAnimationFrame(tick);
    }

    function syncMotion() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = performance.now();
      if (active()) frame = window.requestAnimationFrame(tick);
      else if (!document.hidden) draw();
    }

    function onMotionChange() {
      reducedMotion = motionQuery.matches;
      syncMotion();
    }

    function resize() {
      if (disposed || contextLost) return;
      const width = Math.max(1, host.clientWidth || window.innerWidth);
      const height = Math.max(1, host.clientHeight || window.innerHeight);
      const mobile = width <= 700;
      const halfWidth = 6 * width / height;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.updateProjectionMatrix();
      uniforms.uBounds.value.set(halfWidth * 1.18, 7.08);
      uniforms.uMobile.value = mobile ? 1 : 0;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.25));
      renderer.setSize(width, height, false);
      draw();
    }

    renderer.debug.onShaderError = showFallback;
    renderer.domElement.addEventListener('webglcontextlost', showFallback);
    document.addEventListener('visibilitychange', syncMotion);
    motionQuery.addEventListener('change', onMotionChange);
    removeListeners = () => {
      renderer.domElement.removeEventListener('webglcontextlost', showFallback);
      document.removeEventListener('visibilitychange', syncMotion);
      motionQuery.removeEventListener('change', onMotionChange);
    };
    host.append(renderer.domElement);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    if (!contextLost) {
      host.classList.add('scene-ready');
      host.dataset.sceneState = 'ready';
      syncMotion();
    }

    return {
      setTheme(dark) {
        if (disposed) return;
        uniforms.uShadow.value.set(dark ? '#050b08' : '#879385');
        uniforms.uLight.value.set(dark ? '#7d897e' : '#ffffff');
        uniforms.uOpacity.value = dark ? 0.28 : 0.34;
        draw();
      },
      setPaused(value) {
        if (disposed) return;
        manuallyPaused = Boolean(value);
        syncMotion();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        window.cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        removeListeners();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        host.classList.remove('scene-ready');
      },
    };
  } catch {
    window.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    removeListeners();
    geometry?.dispose();
    material?.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
    markFallback();
    return { setTheme: noop, setPaused: noop, dispose: noop };
  }
}
