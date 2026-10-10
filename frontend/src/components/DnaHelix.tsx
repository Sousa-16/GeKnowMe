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
    scene.fog = new THREE.Fog(0xf8fafc, 21, 36);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(21, 1, 0.1, 100);
    camera.position.set(0, 0, 24);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-5, 12, 9);
    const fill = new THREE.DirectionalLight(0xe2e8f0, 0.5);
    fill.position.set(8, -4, 6);
    scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.9));

    // Two strands of touching beads along a gently curving helix
    const BEAD = 0.62, RADIUS = 2.2, RISE = 3.2, STEP = 1.12;
    const T0 = -22, T1 = 22;
    const perStrand = Math.floor((T1 - T0) / STEP);
    const count = perStrand * 2;
    const geo = new THREE.SphereGeometry(BEAD, small ? 24 : 40, small ? 16 : 28);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.7, sheen: 0.3, sheenRoughness: 0.9, envMapIntensity: 0.55 });
    const beads = new THREE.InstancedMesh(geo, mat, count);
    const white = new THREE.Color(0xf3f5f7), teal = new THREE.Color(0x99f6e4), tealDeep = new THREE.Color(0x2dd4bf);
    for (let i = 0; i < count; i++) {
      const accent = i % 17 === 5 ? teal : i % 29 === 13 ? tealDeep : white;
      beads.setColorAt(i, accent);
    }
    const helix = new THREE.Group();
    helix.add(beads);
    helix.rotation.z = small ? 1.05 : 0.5;
    helix.position.set(small ? 0.9 : 3.4, small ? -3.4 : -0.4, 0);
    scene.add(helix);

    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const place = (phase: number) => {
      for (let s = 0; s < 2; s++) {
        for (let k = 0; k < perStrand; k++) {
          const t = T0 + k * STEP;
          const a = t / RISE + phase + s * Math.PI;
          const bend = 0.02 * t * t; // gentle sweep, like a loose strand
          p.set(t * 0.62, RADIUS * Math.cos(a) - bend * 0.25, RADIUS * Math.sin(a));
          m.makeTranslation(p.x, p.y, p.z);
          beads.setMatrixAt(s * perStrand + k, m);
        }
      }
      beads.instanceMatrix.needsUpdate = true;
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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
      phase += dt * 0.12;
      place(phase);
      helix.rotation.x += (pointer.y * 0.12 - helix.rotation.x) * 0.04;
      helix.rotation.y += (pointer.x * 0.18 - helix.rotation.y) * 0.04;
      helix.position.y += ((small ? -3.4 : -0.4) + Math.sin(now / 2400) * 0.15 - helix.position.y) * 0.05;
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
