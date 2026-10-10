import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Soft matte bead double helix for the landing page. Loaded lazily so Three.js only ships there.
 * Pauses when off-screen or in a background tab; renders one still frame for reduced-motion users. */
export default function DnaHelix({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // no WebGL: the page still works, just without the helix
    }
    const small = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(21, 1, 0.1, 400);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-5, 12, 9);
    const fill = new THREE.DirectionalLight(0xe2e8f0, 0.5);
    fill.position.set(8, -4, 6);
    scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.9));

    // Proportions measured from the reference: bead diameter ~ 1/10 of the page width, helix radius
    // ~ 2.7 bead radii, one crossing-to-crossing "lens" ~ 6 bead diameters long, tightly packed beads.
    const BEAD = 0.9, RADIUS = 2.45, LENS = 11, STEP = 1.55;
    const DX = STEP / Math.sqrt(1 + (RADIUS * Math.PI / LENS) ** 2); // spacing along the axis
    const X = LENS * 1.7; // strands run well past both screen edges
    const perStrand = Math.floor((2 * X) / DX);
    const count = perStrand * 2;
    const geo = new THREE.SphereGeometry(BEAD, small ? 24 : 40, small ? 16 : 28);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.7, sheen: 0.3, sheenRoughness: 0.9, envMapIntensity: 0.55 });
    const beads = new THREE.InstancedMesh(geo, mat, count);
    // All white except one teal bead, placed right of centre so it stays in view
    const tealIndex = Math.round((X + LENS * 0.3) / DX);
    for (let i = 0; i < count; i++) beads.setColorAt(i, new THREE.Color(i === tealIndex ? 0x5eead4 : 0xf3f5f7));
    const helix = new THREE.Group();
    helix.add(beads);
    helix.rotation.z = 0.24; // rises gently to the right
    scene.add(helix);

    const m = new THREE.Matrix4();
    const place = (phase: number) => {
      for (let s = 0; s < 2; s++) {
        for (let k = 0; k < perStrand; k++) {
          const x = -X + k * DX;
          const a = (x * Math.PI) / LENS + phase + s * Math.PI;
          m.makeTranslation(x, RADIUS * Math.cos(a), RADIUS * Math.sin(a));
          beads.setMatrixAt(s * perStrand + k, m);
        }
      }
      beads.instanceMatrix.needsUpdate = true;
    };

    // Fit the camera so about 0.5 + 1 + 0.5 lenses span the width (fewer on narrow screens),
    // with the helix running through the vertical middle of the hero.
    let baseY = 0;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const span = w < 768 ? LENS * 1.15 : LENS * 1.8;
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.z = span / (2 * tan * camera.aspect);
      const viewH = 2 * camera.position.z * tan;
      baseY = -viewH * (w < 768 ? -0.02 : 0.04);
      helix.position.set(w < 768 ? 0 : LENS * 0.05, baseY, 0);
      scene.fog = new THREE.Fog(0xf8fafc, camera.position.z - RADIUS, camera.position.z + RADIUS * 4);
      camera.updateProjectionMatrix();
    };
    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    };

    let visible = true, raf = 0, last = performance.now(), phase = 0.6, shown = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phase += dt * 0.3;
      place(phase);
      helix.rotation.x += (pointer.y * 0.1 - helix.rotation.x) * 0.04;
      helix.rotation.y += (pointer.x * 0.12 - helix.rotation.y) * 0.04;
      helix.position.y += (baseY + Math.sin(now / 2400) * 0.2 - helix.position.y) * 0.05;
      renderer.render(scene, camera);
      if (!shown) { shown = true; setReady(true); }
    };

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    if (reduced) {
      place(phase);
      renderer.render(scene, camera);
      setReady(true);
    } else {
      window.addEventListener("pointermove", onPointer, { passive: true });
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      geo.dispose(); mat.dispose(); pmrem.dispose(); scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={host} aria-hidden
      className={`pointer-events-none transition-opacity duration-1000 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${ready ? "opacity-100" : "opacity-0"} ${className}`} />
  );
}
