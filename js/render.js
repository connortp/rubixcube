// three.js view of the cube plus all pointer/touch input.
import * as THREE from "../vendor/three.module.min.js";
import { cross, isFixedCentre, isMoveAllowed } from "./cube.js";

const COLORS = {
  none: new THREE.Color("#f6f1e7"),
  word: new THREE.Color("#f2c94c"),
  target: new THREE.Color("#5cc977"),
  body: "#16161d",
};
const TWIST_MS = 170;
const DRAG_THRESHOLD = 12; // px before a drag counts as a twist or spin

const letterTextures = new Map();
function letterTexture(letter, fixed) {
  const key = letter + (fixed ? "*" : "");
  if (letterTextures.has(key)) return letterTextures.get(key);
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(4, 4, size - 8, size - 8, 22);
  g.fill();
  g.fillStyle = "#1b1b22";
  g.font = "800 78px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, size / 2, size / 2 + 2);
  if (fixed) {
    // Fixed centres get a ring so players know they're the anchor for that face.
    g.strokeStyle = "rgba(27,27,34,0.35)";
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(14, 14, size - 28, size - 28, 16);
    g.stroke();
  } else {
    // A little bar under each letter shows which way is up (so N vs Z is obvious).
    g.fillRect(size / 2 - 16, size - 24, 32, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  letterTextures.set(key, tex);
  return tex;
}

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class CubeView {
  constructor(container, { onTwist, onBlocked, onSpin } = {}) {
    this.container = container;
    this.onTwist = onTwist;
    this.onBlocked = onBlocked;
    this.onSpin = onSpin;
    this.locked = false;
    this.animating = false;
    this.dirty = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "cube-canvas";
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);

    this.cubeGroup = new THREE.Group();
    this.scene.add(this.cubeGroup);
    this.pivot = new THREE.Group();
    this.cubeGroup.add(this.pivot);

    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.gesture = null;

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      if (this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // Build meshes for a new cube size. Call update() afterwards to place letters.
  setCube(cube) {
    this.n = cube.n;
    for (const m of [...this.cubeGroup.children]) if (m !== this.pivot) this.cubeGroup.remove(m);
    const n = cube.n;
    const bodyGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.55, metalness: 0.1 });
    this.cubies = [];
    for (let x = -(n - 1); x <= n - 1; x += 2)
      for (let y = -(n - 1); y <= n - 1; y += 2)
        for (let z = -(n - 1); z <= n - 1; z += 2) {
          const outer = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) === n - 1;
          if (!outer) continue;
          const mesh = new THREE.Mesh(bodyGeo, bodyMat);
          mesh.userData.home = [x, y, z];
          this.cubeGroup.add(mesh);
          this.cubies.push(mesh);
        }
    const stickerGeo = new THREE.PlaneGeometry(0.88, 0.88);
    this.stickers = cube.stickers.map((s) => {
      const mesh = new THREE.Mesh(
        stickerGeo,
        new THREE.MeshBasicMaterial({ map: letterTexture(s.letter, isFixedCentre(n, s)), transparent: true, alphaTest: 0.5 }),
      );
      mesh.userData.id = s.id;
      this.cubeGroup.add(mesh);
      return mesh;
    });
    this.resetView(false);
    this.resize();
  }

  // Put every mesh where the model says it is, coloured by row status.
  update(cube, stickerStatus) {
    this.model = cube;
    for (const mesh of this.cubies) {
      mesh.position.copy(v3(mesh.userData.home).multiplyScalar(0.5));
      mesh.quaternion.identity();
      this.cubeGroup.add(mesh);
    }
    const basis = new THREE.Matrix4();
    for (const s of cube.stickers) {
      const mesh = this.stickers[s.id];
      const normal = v3(s.normal);
      const up = v3(s.up);
      const right = new THREE.Vector3().crossVectors(up, normal);
      basis.makeBasis(right, up, normal);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.copy(v3(s.pos).multiplyScalar(0.5).addScaledVector(normal, 0.488));
      mesh.material.color.copy(COLORS[stickerStatus?.get(s.id) ?? "none"]);
      this.cubeGroup.add(mesh);
    }
    this.pivot.rotation.set(0, 0, 0);
    this.dirty = true;
  }

  // Visually turn one layer; resolves when the animation finishes. The caller then
  // applies the move to the model and calls update().
  animateMove(cube, move, ms = TWIST_MS) {
    const { axis, layer, dir } = move;
    this.pivot.rotation.set(0, 0, 0);
    for (const mesh of this.cubies) if (mesh.userData.home[axis] === layer) this.pivot.attach(mesh);
    for (const s of cube.stickers)
      if (s.pos[axis] === layer && !isFixedCentre(cube.n, s)) this.pivot.attach(this.stickers[s.id]);
    this.animating = true;
    const start = performance.now();
    const target = (dir * Math.PI) / 2;
    return new Promise((resolve) => {
      const step = (now) => {
        const t = ms ? Math.min(1, (now - start) / ms) : 1;
        const eased = 1 - Math.pow(1 - t, 3);
        this.pivot.rotation.set(0, 0, 0);
        this.pivot.rotation["xyz"[axis]] = target * eased;
        this.dirty = true;
        if (t < 1) requestAnimationFrame(step);
        else {
          this.animating = false;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  // A little wiggle when someone tries to turn a centre slice.
  shake() {
    const q0 = this.cubeGroup.quaternion.clone();
    const start = performance.now();
    const step = (now) => {
      const t = (now - start) / 320;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t * Math.PI * 4) * 0.05 * (1 - t));
      this.cubeGroup.quaternion.copy(q).multiply(q0);
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
      else {
        this.cubeGroup.quaternion.copy(q0);
        this.dirty = true;
      }
    };
    requestAnimationFrame(step);
  }

  resetView(animate = true) {
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.52, -0.62, 0, "XYZ"));
    if (!animate) {
      this.cubeGroup.quaternion.copy(target);
      this.dirty = true;
      return;
    }
    const from = this.cubeGroup.quaternion.clone();
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 350);
      this.cubeGroup.quaternion.slerpQuaternions(from, target, 1 - Math.pow(1 - t, 3));
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setLocked(locked) {
    this.locked = locked;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the cube's bounding sphere in whichever of width/height is tighter.
    const radius = ((this.n || 3) * Math.sqrt(3)) / 2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius * 1.02) / Math.sin(Math.min(vfov, hfov) / 2);
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---- input -------------------------------------------------------------

  bindInput() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => this.pointerDown(e));
    el.addEventListener("pointermove", (e) => this.pointerMove(e));
    el.addEventListener("pointerup", (e) => this.pointerUp(e));
    el.addEventListener("pointercancel", (e) => this.pointerUp(e));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  pickSticker(e) {
    if (!this.stickers) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.stickers, ...this.cubies], false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.id;
    return id === undefined ? { body: true } : { id };
  }

  pointerDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size > 1) {
      // Second finger down: always spin the whole cube.
      this.gesture = { mode: "spin", x: e.clientX, y: e.clientY };
      return;
    }
    const hit = e.button === 2 ? null : this.pickSticker(e);
    this.gesture = {
      mode: hit?.id !== undefined ? "pending-twist" : hit?.body ? "none" : "pending-spin",
      sticker: hit?.id,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
  }

  pointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;
    if (this.pointers.size > 1) {
      // Two fingers: spin using their midpoint.
      const pts = [...this.pointers.values()];
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      if (g.mode !== "spin" || g.mid === undefined) Object.assign(g, { mode: "spin", mid: true, x: mx, y: my });
      this.spinBy(mx - g.x, my - g.y);
      g.x = mx;
      g.y = my;
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const far = Math.hypot(dx, dy) > DRAG_THRESHOLD;
    if ((g.mode === "pending-spin" || g.mode === "none") && far) g.mode = "spin";
    if (g.mode === "pending-twist" && far) {
      g.mode = "done";
      this.tryTwist(g.sticker, dx, dy);
    }
    if (g.mode === "spin") {
      this.spinBy(e.clientX - g.x, e.clientY - g.y);
    }
    g.x = e.clientX;
    g.y = e.clientY;
  }

  pointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = null;
  }

  spinBy(dx, dy) {
    const speed = 0.0085;
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * speed);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * speed);
    this.cubeGroup.quaternion.premultiply(qy).premultiply(qx);
    this.dirty = true;
    this.onSpin?.();
  }

  // Work out which layer the player meant by dragging sticker `id` by (dx, dy) px.
  tryTwist(id, dx, dy) {
    if (this.locked || this.animating || !this.model) return;
    const s = this.model.stickers[id];
    const n = this.model.n;
    const centre = v3(s.pos).multiplyScalar(0.5).addScaledVector(v3(s.normal), 0.5);
    const rect = this.canvas.getBoundingClientRect();
    const toScreen = (local) => {
      const p = this.cubeGroup.localToWorld(local.clone()).project(this.camera);
      return new THREE.Vector2(((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height);
    };
    const origin = toScreen(centre);
    const drag = new THREE.Vector2(dx, dy).normalize();
    let best = null;
    for (let axis = 0; axis < 3; axis++) {
      if (s.normal[axis] !== 0) continue;
      for (const sign of [1, -1]) {
        const t = [0, 0, 0];
        t[axis] = sign;
        const screen = toScreen(centre.clone().add(v3(t).multiplyScalar(0.5))).sub(origin);
        if (screen.lengthSq() < 1e-6) continue;
        const score = screen.normalize().dot(drag);
        if (!best || score > best.score) best = { score, t };
      }
    }
    if (!best) return;
    // Dragging the sticker along tangent t means turning around n × t.
    const a = cross(s.normal, best.t);
    const axis = a.findIndex((v) => v !== 0);
    const move = { axis, layer: s.pos[axis], dir: Math.sign(a[axis]) };
    if (!isMoveAllowed(n, move)) {
      this.shake();
      this.onBlocked?.(move);
      return;
    }
    this.onTwist?.(move);
  }
}
