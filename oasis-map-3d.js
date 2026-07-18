/* <oasis-map-3d> — NFS-style stylized 3D overview map (Oasis Garage).
   Attributes: stops='[{n,t,x,y,k,ty}]' (k: wrapped|live|next|later; ty: area type),
   sel (index|-1), prog (0-100), leg (0-3), motion ("1"|"0").
   Area types: industrial, highway, harbor, city, mountain, farmland, parking, desert.
   Pin clicks call window.__oasisMapBridge.onPick(index).
   Requires the pinned three.js import map in the host page <head>. */
(function () {
  if (customElements.get('oasis-map-3d')) return;
  const RED = 0xe02020;

  class OasisMap3D extends HTMLElement {
    static get observedAttributes() { return ['stops', 'sel', 'prog', 'leg', 'motion']; }
    connectedCallback() {
      if (this._booted) return; this._booted = true;
      this.style.display = 'block';
      this._boot().catch(e => {
        console.error('oasis-map-3d failed', e);
        this.innerHTML = '<div style="padding:48px;text-align:center;font-family:monospace;font-size:12px;color:#8f8f8f">3D MAP FAILED TO LOAD</div>';
      });
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._renderer) this._renderer.dispose();
    }
    attributeChangedCallback() { if (this._ready) this._applyState(); }

    _attrs() {
      let stops = [];
      try { stops = JSON.parse(this.getAttribute('stops') || '[]'); } catch (e) {}
      return {
        stops,
        sel: +(this.getAttribute('sel') ?? -1),
        prog: +(this.getAttribute('prog') || 0),
        leg: Math.max(0, Math.min(3, +(this.getAttribute('leg') || 0))),
        motion: this.getAttribute('motion') !== '0'
      };
    }
    _w(s) { return new this.T.Vector3((s.x - 500) / 55, 0, (s.y - 280) / 42); }
    _rng(seed) { let s = seed + 1.7; return () => { s = Math.sin(s * 127.1) * 43758.5; return s - Math.floor(s); }; }

    async _boot() {
      const THREE = this.T = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const w = this.clientWidth || 1200, h = this.clientHeight || 560;

      const renderer = this._renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.touchAction = 'pan-y';
      this.appendChild(renderer.domElement);

      const scene = this._scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101012);
      scene.fog = new THREE.Fog(0x101012, 22, 44);

      const camera = this._camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(4, 8.5, 13.5);

      const controls = this._controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0.2);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 5; controls.maxDistance = 26;
      controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.32;

      scene.add(new THREE.AmbientLight(0x707080, 1.5));
      const key = new THREE.DirectionalLight(0xdde4ff, 1.6); key.position.set(6, 12, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(RED, 0.5); rim.position.set(-8, 4, -8); scene.add(rim);
      const glow = new THREE.PointLight(RED, 10, 22); glow.position.set(0, 5, 0); scene.add(glow);

      const MS = THREE.MeshStandardMaterial;
      this._mat = {
        base: new MS({ color: 0x141416, roughness: 0.95 }),
        carbon: new MS({ color: 0x202024, roughness: 0.9 }),
        smoke: new MS({ color: 0x2e2e33, roughness: 0.85 }),
        concrete: new MS({ color: 0x3a3a40, roughness: 0.9 }),
        grey: new MS({ color: 0x55555c, roughness: 0.8 }),
        red: new MS({ color: RED, emissive: RED, emissiveIntensity: 0.7, roughness: 0.4 }),
        redDim: new MS({ color: 0x7a1414, roughness: 0.6 }),
        glass: new MS({ color: 0x0e1420, roughness: 0.2, metalness: 0.6 }),
        water: new MS({ color: 0x0c1420, roughness: 0.2, metalness: 0.4 }),
        green: new MS({ color: 0x2e4a2a, roughness: 0.95 }),
        greenD: new MS({ color: 0x22371f, roughness: 0.95 }),
        wood: new MS({ color: 0x4a3526, roughness: 0.9 }),
        sand: new MS({ color: 0x4a4132, roughness: 0.95 }),
        hay: new MS({ color: 0x6b5a2e, roughness: 0.95 }),
        window: new MS({ color: 0x101014, emissive: 0xffc873, emissiveIntensity: 0.9 }),
        white: new MS({ color: 0xf5f5f5, emissive: 0xf5f5f5, emissiveIntensity: 0.6 })
      };

      const base = new THREE.Mesh(new THREE.BoxGeometry(30, 0.3, 20), this._mat.base);
      base.position.y = -0.16; scene.add(base);
      const grid = new THREE.GridHelper(20, 20, 0x232328, 0x1b1b20);
      grid.scale.x = 30 / 20; grid.position.y = 0.004; scene.add(grid);

      this._route = new THREE.Group(); scene.add(this._route);
      this._pinsG = new THREE.Group(); scene.add(this._pinsG);
      this._islandsG = new THREE.Group(); scene.add(this._islandsG);
      this._pickables = [];

      const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
      const hit = e => {
        const r = renderer.domElement.getBoundingClientRect();
        v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(v2, camera);
        const ints = ray.intersectObjects(this._pickables, true);
        for (const it of ints) { let o = it.object; while (o) { if (o.userData.idx !== undefined) return o.userData.idx; o = o.parent; } }
        return -1;
      };
      let down = null;
      renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
      renderer.domElement.addEventListener('pointerup', e => {
        if (!down) return;
        const dx = e.clientX - down[0], dy = e.clientY - down[1]; down = null;
        if (dx * dx + dy * dy > 30) return;
        const i = hit(e);
        if (i >= 0 && window.__oasisMapBridge) window.__oasisMapBridge.onPick(i);
      });
      renderer.domElement.addEventListener('pointermove', e => {
        renderer.domElement.style.cursor = hit(e) >= 0 ? 'pointer' : 'grab';
      });

      this._ro = new ResizeObserver(() => {
        const W = this.clientWidth, H = this.clientHeight;
        if (!W || !H) return;
        renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
      });
      this._ro.observe(this);

      this._loopU = 0; this._driveU = 0;
      this._ready = true;
      this._applyState();

      const clock = new THREE.Clock();
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        const dt = Math.min(clock.getDelta(), 0.05), t = clock.getElapsedTime();
        controls.update();
        for (const p of (this._pulses || [])) {
          const f = (t % 2) / 2;
          p.scale.setScalar(1 + f * 1.8);
          p.material.opacity = 0.8 * (1 - f);
        }
        for (const hd of (this._bobs || [])) hd.position.y = hd.userData.baseY + Math.sin(t * 2.4) * 0.06;
        this._driveCar(dt);
        renderer.render(scene, camera);
      };
      loop();
    }

    // ── car ─────────────────────────────────────────────
    _buildCar() {
      const THREE = this.T, m = this._mat, g = new THREE.Group();
      const add = (geo, mm, x, y, z) => { const b = new THREE.Mesh(geo, mm); b.position.set(x, y, z); g.add(b); return b; };
      add(new THREE.BoxGeometry(0.26, 0.09, 0.56), m.red, 0, 0.1, 0);            // body
      add(new THREE.BoxGeometry(0.22, 0.08, 0.26), m.glass, 0, 0.185, -0.05);    // cabin
      add(new THREE.BoxGeometry(0.24, 0.05, 0.03), m.carbon, 0, 0.19, -0.28);    // spoiler
      add(new THREE.BoxGeometry(0.04, 0.02, 0.02), m.white, 0.08, 0.11, 0.283);  // headlights
      add(new THREE.BoxGeometry(0.04, 0.02, 0.02), m.white, -0.08, 0.11, 0.283);
      add(new THREE.BoxGeometry(0.2, 0.025, 0.015), m.red, 0, 0.12, -0.283);     // tail bar
      this._wheels = [];
      const wg = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14);
      [[0.13, 0.19], [-0.13, 0.19], [0.13, -0.17], [-0.13, -0.17]].forEach(([x, z]) => {
        const wl = new THREE.Mesh(wg, m.carbon);
        wl.rotation.z = Math.PI / 2; wl.position.set(x, 0.055, z); g.add(wl); this._wheels.push(wl);
      });
      const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex('#e02020'), transparent: true, blending: this.T.AdditiveBlending, depthWrite: false }));
      gs.scale.set(1.3, 1.3, 1); gs.position.y = 0.05; g.add(gs);
      g.scale.setScalar(1.25);
      return g;
    }
    _carAt(u) {
      const s = this._samples; if (!s || !this._car) return;
      const n = s.length - 1;
      const i = Math.max(0, Math.min(n, Math.round(u * n)));
      const p = s[i], q = s[Math.min(n, i + 3)];
      this._car.position.set(p.x, 0.055, p.z);
      if (p.distanceToSquared(q) > 1e-6) this._car.lookAt(q.x, 0.055, q.z);
    }
    _driveCar(dt) {
      const a = this._attrsCache; if (!a || !this._car) return;
      let u, spin = 6;
      if (!a.motion) { u = this._uProg; spin = 0; }
      else if (a.sel >= 0) {
        const target = this._uStops[a.sel];
        this._driveU = Math.min(this._driveU + dt * 0.03, target);
        u = this._driveU; if (u >= target) spin = 0;
      } else { this._loopU = (this._loopU + dt * 0.075) % 1; u = this._loopU; }
      this._carAt(u);
      for (const wl of this._wheels || []) wl.rotation.x += dt * spin;
    }

    // ── textures ────────────────────────────────────────
    _glowTex(color) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, color); gr.addColorStop(0.4, color + '55'); gr.addColorStop(1, '#00000000');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new this.T.CanvasTexture(c);
    }
    _islandTex(c1, c2) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 8, 128, 128, 128);
      gr.addColorStop(0, c1 + 'e6'); gr.addColorStop(0.55, c2 + '99'); gr.addColorStop(0.85, c2 + '33'); gr.addColorStop(1, c2 + '00');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      return new this.T.CanvasTexture(c);
    }
    _roadTex() {
      if (this._rt) return this._rt;
      const c = document.createElement('canvas'); c.width = 128; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 160; i++) { g.fillStyle = Math.random() > .5 ? '#17171b' : '#202026'; g.fillRect(Math.random() * 128, Math.random() * 256, 3, 3); }
      g.fillStyle = '#9a9aa2'; g.fillRect(5, 0, 4, 256); g.fillRect(119, 0, 4, 256);
      g.fillStyle = '#e02020'; for (let y = 0; y < 256; y += 64) g.fillRect(58, y, 12, 34);
      const tx = new this.T.CanvasTexture(c);
      tx.wrapS = tx.wrapT = this.T.RepeatWrapping; tx.anisotropy = 4;
      this._rt = tx; return tx;
    }
    _label(s, active) {
      const THREE = this.T;
      const c = document.createElement('canvas'); c.width = 512; c.height = 160;
      const g = c.getContext('2d');
      g.textAlign = 'center';
      g.font = 'italic 800 52px "Barlow Condensed", sans-serif';
      g.fillStyle = active ? '#E02020' : '#F5F5F5';
      g.fillText(s.n, 256, 66);
      g.font = '500 30px "JetBrains Mono", monospace';
      g.fillStyle = '#9a9a9a';
      g.fillText(s.t, 256, 112);
      const tx = new THREE.CanvasTexture(c); tx.anisotropy = 4;
      return new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false });
    }

    // ── road ribbon ─────────────────────────────────────
    _strip(samples, width, y) {
      const T = this.T, n = samples.length;
      const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
      let dist = 0;
      for (let i = 0; i < n; i++) {
        const p = samples[i], pn = samples[Math.min(i + 1, n - 1)], pp = samples[Math.max(i - 1, 0)];
        let tx = pn.x - pp.x, tz = pn.z - pp.z;
        const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        const nx = -tz, nz = tx, hw = width / 2;
        if (i > 0) dist += p.distanceTo(samples[i - 1]);
        pos.set([p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw], i * 6);
        uv.set([0, dist / 1.5, 1, dist / 1.5], i * 4);
        if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }

    // ── detail helpers (canvas-textured, per reference board) ──
    _texCanvas(draw, w, h) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const tx = new this.T.CanvasTexture(c); tx.anisotropy = 4;
      return tx;
    }
    _warmGlow() { return this._wg || (this._wg = this._glowTex('#ffd9a0')); }
    _facadeMat(seed, litRatio) {
      const rnd = this._rng(seed);
      const tx = this._texCanvas((g, w, h) => {
        g.fillStyle = '#17171d'; g.fillRect(0, 0, w, h);
        const cols = 6, rows = 12, ww = w / cols, wh = h / rows;
        for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
          const lit = rnd() < (litRatio ?? 0.45);
          g.fillStyle = lit ? 'rgba(255,200,115,' + (0.35 + rnd() * 0.6).toFixed(2) + ')' : '#0d0d12';
          g.fillRect(cc * ww + 2, r * wh + 2, ww - 4, wh - 4);
        }
      }, 128, 256);
      return new this.T.MeshStandardMaterial({ map: tx, emissive: 0xffc873, emissiveMap: tx, emissiveIntensity: 0.55, roughness: 0.85 });
    }
    _garageMat() {
      const tx = this._texCanvas((g, w, h) => {
        g.fillStyle = '#2e2e33'; g.fillRect(0, 0, w, h);
        const levels = 6, bh = h / levels;
        for (let l = 0; l < levels; l++) {
          const y = h - (l + 1) * bh;
          const grad = g.createLinearGradient(0, y + bh * 0.32, 0, y + bh * 0.88);
          grad.addColorStop(0, '#ffe6b8'); grad.addColorStop(1, '#b57e3c');
          g.fillStyle = grad; g.fillRect(2, y + bh * 0.32, w - 4, bh * 0.56);
          g.fillStyle = '#24242a';
          for (let x = 6; x < w; x += 20) g.fillRect(x, y + bh * 0.28, 4, bh * 0.64);
          g.fillStyle = '#3d3d44'; g.fillRect(0, y, w, bh * 0.28);
        }
      }, 256, 128);
      return new this.T.MeshStandardMaterial({ map: tx, emissive: 0xffdba6, emissiveMap: tx, emissiveIntensity: 0.7, roughness: 0.85 });
    }
    _roofMat() {
      const tx = this._texCanvas((g, w, h) => {
        g.fillStyle = '#55555c'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#8a8a90'; g.lineWidth = 2;
        for (let x = 10; x < w; x += 16) {
          g.beginPath(); g.moveTo(x, 6); g.lineTo(x, h * 0.32); g.stroke();
          g.beginPath(); g.moveTo(x, h * 0.68); g.lineTo(x, h - 6); g.stroke();
        }
        g.fillStyle = '#63636a'; g.fillRect(0, h * 0.42, w, h * 0.16);
      }, 256, 128);
      return new this.T.MeshStandardMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.22, roughness: 0.9 });
    }
    _streetPlate(seed) {
      const rnd = this._rng(seed || 1);
      const tx = this._texCanvas((g, w, h) => {
        g.fillStyle = '#121216'; g.fillRect(0, 0, w, h);
        // city blocks with road gaps
        for (let bx = 0; bx < 4; bx++) for (let bz = 0; bz < 4; bz++) {
          g.fillStyle = rnd() > 0.5 ? '#191920' : '#1c1c23';
          g.fillRect(10 + bx * 62, 10 + bz * 62, 48, 48);
        }
        // lane dashes on the ring road
        g.strokeStyle = '#44444e'; g.lineWidth = 2; g.setLineDash([10, 9]);
        g.strokeRect(w * 0.245, h * 0.245, w * 0.51, h * 0.51);
        g.setLineDash([]);
        // crosswalk
        g.fillStyle = '#9a9aa2';
        for (let i = 0; i < 6; i++) g.fillRect(w * 0.33 + i * 9, h * 0.755, 5, 16);
        // radial fade so the plate diminishes outward
        g.globalCompositeOperation = 'destination-in';
        const gr = g.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.65, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, 256, 256);
      const mesh = new this.T.Mesh(new this.T.PlaneGeometry(5.2, 5.2),
        new this.T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.028;
      return mesh;
    }
    _streetlight(g, x, z, y0) {
      const T = this.T, y = y0 || 0;
      const pole = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, 0.42, 6), this._mat.grey);
      pole.position.set(x, y + 0.21, z); g.add(pole);
      const head = new T.Mesh(new T.BoxGeometry(0.06, 0.02, 0.03),
        new T.MeshStandardMaterial({ color: 0xfff2d5, emissive: 0xffd9a0, emissiveIntensity: 1.3 }));
      head.position.set(x, y + 0.43, z); g.add(head);
      const s = new T.Sprite(new T.SpriteMaterial({ map: this._warmGlow(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
      s.scale.set(0.5, 0.5, 1); s.position.set(x, y + 0.44, z); g.add(s);
    }
    _tree(g, x, z, s) {
      const T = this.T, k = s || 1;
      const tr = new T.Mesh(new T.CylinderGeometry(0.02 * k, 0.026 * k, 0.15 * k, 6), this._mat.wood);
      tr.position.set(x, 0.075 * k, z); g.add(tr);
      const cn = new T.Mesh(new T.SphereGeometry(0.14 * k, 10, 8), this._mat.greenD);
      cn.scale.y = 0.85; cn.position.set(x, 0.22 * k, z); g.add(cn);
    }
    _parkedCar(g, x, z, mm, ry) {
      const b = new this.T.Mesh(new this.T.BoxGeometry(0.15, 0.07, 0.3), mm);
      b.position.set(x, 0.055, z); b.rotation.y = ry || 0; g.add(b);
    }

    // ── location islands ────────────────────────────────
    _island(i, stop, pos) {
      const THREE = this.T, m = this._mat, rnd = this._rng(i * 7 + (stop.ty || '').length);
      const TYPES = {
        industrial: ['#3a3a42', '#26262c'], highway: ['#3c3c44', '#242429'],
        harbor: ['#1e2c3c', '#141c26'], city: ['#343440', '#20202a'],
        mountain: ['#33393a', '#1e2424'], farmland: ['#31462c', '#1e2b1b'],
        parking: ['#38383e', '#232328'], desert: ['#4a4234', '#2b2620']
      };
      const [c1, c2] = TYPES[stop.ty] || TYPES.industrial;
      const g = new THREE.Group(); g.position.copy(pos);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.7, 48),
        new THREE.MeshBasicMaterial({ map: this._islandTex(c1, c2), transparent: true, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; g.add(disc);

      const box = (mm, x, y, z, sx, sy, sz, ry) => {
        const fade = Math.max(0.35, 1 - Math.hypot(x, z) / 3.4);
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx * fade, sy * fade, sz * fade), mm);
        b.position.set(x, y * fade, z); if (ry) b.rotation.y = ry; g.add(b); return b;
      };
      const cyl = (mm, x, y, z, r1, r2, hgt, seg) => {
        const fade = Math.max(0.35, 1 - Math.hypot(x, z) / 3.4);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(r1 * fade, r2 * fade, hgt * fade, seg || 12), mm);
        b.position.set(x, y * fade, z); g.add(b); return b;
      };
      const cone = (mm, x, y, z, r, hgt, seg, ry) => {
        const fade = Math.max(0.35, 1 - Math.hypot(x, z) / 3.4);
        const b = new THREE.Mesh(new THREE.ConeGeometry(r * fade, hgt * fade, seg || 5), mm);
        b.position.set(x, y * fade, z); if (ry) b.rotation.y = ry; g.add(b); return b;
      };
      const R = () => (rnd() - 0.5);

      switch (stop.ty) {
        case 'highway': {
          box(m.concrete, 0, 0.85, -1.0, 3.2, 0.12, 0.7, -0.3);
          box(m.smoke, -1.3, 0.42, -0.6, 0.2, 0.85, 0.2);
          box(m.smoke, 1.3, 0.42, -1.4, 0.2, 0.85, 0.2);
          box(m.grey, 0, 0.96, -1.32, 3.0, 0.06, 0.05, -0.3);
          box(m.smoke, 0.9, 0.6, 0.9, 0.08, 1.2, 0.08);
          box(m.red, 0.9, 1.25, 0.9, 0.9, 0.35, 0.06);
          box(m.grey, -0.9, 0.1, 0.7, 0.8, 0.2, 0.3, 0.4);
          break;
        }
        case 'harbor': {
          const w = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), m.water);
          w.rotation.x = -Math.PI / 2; w.position.set(0.7, 0.035, 1.3); g.add(w);
          box(m.concrete, -0.9, 0.06, -0.2, 2.2, 0.12, 1.6, 0.15);
          box(m.redDim, -1.2, 0.28, -0.5, 0.8, 0.3, 0.35);
          box(m.smoke, -1.2, 0.58, -0.45, 0.75, 0.28, 0.33);
          box(m.grey, -0.4, 0.28, -0.9, 0.8, 0.3, 0.35, 0.2);
          box(m.smoke, 0.3, 1.0, -0.3, 0.12, 2.0, 0.12);
          box(m.grey, 0.75, 1.95, -0.3, 1.3, 0.1, 0.1);
          cyl(m.grey, -1.7, 0.08, 0.6, 0.05, 0.05, 0.16, 8);
          cyl(m.grey, -0.6, 0.08, 0.9, 0.05, 0.05, 0.16, 8);
          break;
        }
        case 'city': {
          g.add(this._streetPlate(i + 2));
          const tw = (x, z, hgt, wdt, ry) => {
            const fade = Math.max(0.4, 1 - Math.hypot(x, z) / 3.4);
            const f = this._facadeMat(i * 13 + x * 7 + z * 3, 0.5);
            const b = new THREE.Mesh(new THREE.BoxGeometry(wdt * fade, hgt * fade, wdt * fade), [f, f, m.carbon, m.carbon, f, f]);
            b.position.set(x, hgt * fade / 2 + 0.02, z); b.rotation.y = ry || 0; g.add(b); return b;
          };
          tw(-0.85, 0.6, 1.8, 0.6); tw(0.1, 0.95, 2.6, 0.62, 0.1); tw(0.95, 0.45, 1.4, 0.55, -0.08);
          tw(-0.25, 1.65, 1.05, 0.5); tw(1.15, 1.4, 0.85, 0.45, 0.2); tw(-1.5, -0.35, 1.1, 0.5, 0.3); tw(0.5, -1.1, 0.8, 0.45);
          box(m.red, 0.1, 2.68, 0.95, 0.58, 0.1, 0.58);
          box(m.red, -0.85, 1.35, 0.94, 0.5, 0.18, 0.03);
          this._tree(g, -1.65, 0.95); this._tree(g, 1.75, 0.5); this._tree(g, 0.4, 1.95); this._tree(g, -0.6, -0.95);
          this._streetlight(g, -1.2, 1.5); this._streetlight(g, 1.5, 1.15); this._streetlight(g, 0.9, -0.75);
          this._parkedCar(g, -1.35, 1.3, m.grey, 0.3); this._parkedCar(g, 1.25, -0.5, m.redDim, -0.4);
          break;
        }
        case 'mountain': {
          cone(m.smoke, 0.9, 1.0, 0.9, 1.4, 2.0, 5, 0.4);
          cone(m.carbon, -0.5, 0.65, 1.4, 0.9, 1.3, 5);
          cone(m.grey, 1.6, 0.4, -0.4, 0.55, 0.8, 5, 0.9);
          const tree = (x, z) => { cyl(m.wood, x, 0.08, z, 0.025, 0.03, 0.16, 6); cone(m.greenD, x, 0.32, z, 0.14, 0.4, 7); };
          tree(-1.2, 0.2); tree(-1.6, 0.9); tree(0.2, 1.9); tree(-0.3, -0.9); tree(1.9, 0.8);
          box(m.grey, -0.8, 0.08, -0.5, 0.25, 0.16, 0.2, 0.7);
          break;
        }
        case 'farmland': {
          for (let r = 0; r < 4; r++) box(r % 2 ? m.green : m.greenD, -0.3 + r * 0.45, 0.03, 1.0, 0.34, 0.06, 2.2, 0.1);
          box(m.redDim, -1.3, 0.3, -0.6, 0.9, 0.6, 0.7);
          box(m.wood, -1.3, 0.72, -0.6, 0.95, 0.24, 0.75, 0); // roof cap
          cyl(m.grey, -0.5, 0.45, -1.1, 0.22, 0.22, 0.9, 14);
          cone(m.smoke, -0.5, 1.02, -1.1, 0.24, 0.25, 14);
          const bale = (x, z) => { const b = cyl(m.hay, x, 0.09, z, 0.12, 0.12, 0.2, 10); b.rotation.z = Math.PI / 2; };
          bale(0.9, -0.7); bale(1.3, -0.4); bale(1.7, 0.9);
          for (let f = 0; f < 6; f++) cyl(m.wood, -2.0 + f * 0.32, 0.08, 0.9 + R() * 0.1, 0.015, 0.015, 0.18, 5);
          break;
        }
        case 'parking': { // per reference: cast-in-place garage, lit open bays, roof deck
          g.add(this._streetPlate(i + 5));
          const gg = new THREE.Group(); gg.position.set(-0.1, 0, 0.25); gg.rotation.y = 0.14; g.add(gg);
          const L = 2.2, W = 1.4, H = 0.92;
          const gm = this._garageMat(), rf = this._roofMat();
          const bldg = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), [gm, gm, rf, m.carbon, gm, gm]);
          bldg.position.y = H / 2 + 0.02; gg.add(bldg);
          const pp = (x, z, sx, sz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), m.concrete); b.position.set(x, H + 0.045, z); gg.add(b); };
          pp(0, -W / 2 + 0.02, L, 0.05); pp(0, W / 2 - 0.02, L, 0.05); pp(-L / 2 + 0.02, 0, 0.05, W); pp(L / 2 - 0.02, 0, 0.05, W);
          const stairF = this._facadeMat(i * 3 + 1, 0.75);
          const stair = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.26), [stairF, stairF, m.smoke, m.carbon, stairF, stairF]);
          stair.position.set(L / 2 - 0.22, H + 0.2, -W / 2 + 0.22); gg.add(stair);
          const core = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), m.smoke);
          core.position.set(-L / 2 + 0.3, H + 0.11, W / 2 - 0.25); gg.add(core);
          for (const [lx, lz] of [[-0.7, -0.35], [0.2, 0.35], [0.8, -0.3], [-0.2, -0.1]]) this._streetlight(gg, lx, lz, H);
          const ent = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.02),
            new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: 0xffd9a0, emissiveIntensity: 1.1 }));
          ent.position.set(0.45, 0.1, W / 2 + 0.012); gg.add(ent);
          const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.34), m.concrete);
          ramp.position.set(L / 2 + 0.24, 0.12, -0.2); ramp.rotation.z = -0.33; gg.add(ramp);
          const nb = (x, z, hgt, wdt) => {
            const f = this._facadeMat(i * 31 + x * 5 + z, 0.4);
            const b = new THREE.Mesh(new THREE.BoxGeometry(wdt, hgt, wdt), [f, f, m.carbon, m.carbon, f, f]);
            b.position.set(x, hgt / 2 + 0.02, z); g.add(b);
          };
          nb(-1.85, -0.5, 1.0, 0.5); nb(1.75, -0.7, 1.3, 0.55); nb(1.65, 1.3, 0.7, 0.45); nb(-1.75, 1.2, 0.85, 0.5);
          this._tree(g, -1.15, 1.45); this._tree(g, 0.2, 1.6); this._tree(g, 1.15, 1.5); this._tree(g, -1.3, -1.15);
          this._streetlight(g, -0.6, 1.75); this._streetlight(g, 1.5, 0.4); this._streetlight(g, -1.6, 0.3);
          this._parkedCar(g, -0.85, 1.6, m.grey, 0.1); this._parkedCar(g, -0.45, 1.62, m.redDim, 0.1); this._parkedCar(g, 0.65, 1.58, m.smoke, -0.1);
          break;
        }
        case 'desert': {
          const mound = (x, z, r) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), m.sand); s.scale.y = 0.3; s.position.set(x, 0.03, z); g.add(s); };
          mound(0.8, 1.0, 0.8); mound(-1.0, -0.6, 0.6); mound(1.6, -0.5, 0.45);
          const cactus = (x, z) => {
            cyl(m.greenD, x, 0.3, z, 0.05, 0.06, 0.6, 8);
            cyl(m.greenD, x + 0.12, 0.38, z, 0.035, 0.035, 0.25, 8).rotation.z = -0.9;
            cyl(m.greenD, x - 0.11, 0.32, z, 0.035, 0.035, 0.2, 8).rotation.z = 0.9;
          };
          cactus(-0.9, 0.8); cactus(1.1, 0.3); cactus(-1.6, -0.2);
          box(m.grey, 0.3, 0.08, -0.9, 0.3, 0.16, 0.25, 0.5);
          break;
        }
        default: { // industrial / garage
          box(m.carbon, -0.9, 0.26, 0.7, 1.5, 0.52, 0.95);
          box(m.smoke, -0.9, 0.56, 0.7, 1.55, 0.1, 1.0);
          box(m.red, -0.9, 0.4, 1.19, 1.2, 0.12, 0.03);
          box(m.smoke, 0.7, 0.33, 0.95, 1.1, 0.66, 0.8);
          const crate = (x, z, y) => box(m.grey, x, y || 0.09, z, 0.18, 0.18, 0.18, rnd());
          crate(0.2, -0.7); crate(0.42, -0.7); crate(0.31, -0.7, 0.27);
          cyl(m.redDim, -0.2, 0.12, -0.9, 0.07, 0.07, 0.24, 10);
          cyl(m.grey, 0.0, 0.12, -0.95, 0.07, 0.07, 0.24, 10);
        }
      }
      this._islandsG.add(g);
      return g;
    }

    // ── scene build / state ─────────────────────────────
    _buildStops(stops) {
      const THREE = this.T;
      this._pinsG.clear(); this._islandsG.clear(); this._route.clear();
      this._pickables = []; this._pins = []; this._pulses = []; this._bobs = []; this._islands = [];
      this._progStrip = null; this._car = null;

      const pts = stops.map(s => this._w(s).setY(0.05));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.55);
      const samples = this._samples = curve.getPoints(400);
      this._uStops = stops.map((s, i) => {
        const p = pts[i]; let best = 0, bd = 1e9;
        for (let k = 0; k <= 400; k++) { const d = samples[k].distanceToSquared(p); if (d < bd) { bd = d; best = k; } }
        return best / 400;
      });
      this._uStops[0] = 0; this._uStops[stops.length - 1] = 1;

      stops.forEach((s, i) => {
        const isl = this._island(i, s, this._w(s));
        let md = 1e9;
        for (let j = 0; j < stops.length; j++) if (j !== i) md = Math.min(md, pts[i].distanceTo(pts[j]));
        isl.userData.baseS = Math.max(0.55, Math.min(1, md / 5.8));
        isl.scale.setScalar(isl.userData.baseS);
        this._islands.push(isl);
      });

      const road = new THREE.Mesh(this._strip(samples, 0.5, 0.05),
        new THREE.MeshBasicMaterial({ map: this._roadTex(), side: THREE.DoubleSide }));
      this._route.add(road);

      this._car = this._buildCar(); this._route.add(this._car);

      stops.forEach((s, i) => {
        const pos = this._w(s);
        const grp = new THREE.Group(); grp.position.copy(pos); grp.userData.idx = i;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 8), this._mat.grey);
        post.position.y = 0.85; grp.add(post);
        const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.26),
          new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4 }));
        head.position.y = 1.7; head.userData.baseY = 1.7; grp.add(head);
        const selRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }));
        selRing.rotation.x = Math.PI / 2; selRing.position.y = 0.06; selRing.visible = false; grp.add(selRing);
        const pulse = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 40),
          new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.065; pulse.visible = false; grp.add(pulse);
        const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex('#e02020'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0 }));
        gs.scale.set(2.2, 2.2, 1); gs.position.y = 0.1; grp.add(gs);
        const sprite = new THREE.Sprite(this._label(s, false));
        sprite.scale.set(2.9, 0.9, 1); sprite.position.y = 2.4; grp.add(sprite);
        this._pinsG.add(grp);
        this._pickables.push(grp);
        this._pins.push({ grp, head, selRing, pulse, sprite, glow: gs, lastKey: '' });
      });
    }

    _applyState() {
      const a = this._attrsCache = this._attrs();
      if (!a.stops.length) return;
      const json = JSON.stringify(a.stops.map(s => [s.n, s.t, s.x, s.y, s.ty]));
      if (json !== this._lastJson) { this._lastJson = json; this._buildStops(a.stops); this._lastProg = -1; }

      if (a.sel !== this._selPrev) { this._selPrev = a.sel; this._driveU = 0; }

      const COL = { live: [RED, 1], next: [RED, 0.35], wrapped: [0x3a3a3a, 0], later: [0x585858, 0] };
      a.stops.forEach((s, i) => {
        const p = this._pins[i]; if (!p) return;
        const [col, em] = COL[s.k] || COL.later;
        p.head.material.color.set(col);
        p.head.material.emissive.set(em > 0 ? RED : 0x000000);
        p.head.material.emissiveIntensity = em;
        const isSel = a.sel === i;
        p.selRing.visible = isSel;
        p.pulse.visible = s.k === 'live';
        p.glow.material.opacity = isSel ? 0.75 : (s.k === 'live' ? 0.5 : 0);
        p.head.scale.setScalar(isSel ? 1.3 : 1);
        if (this._islands[i]) {
          const bs = this._islands[i].userData.baseS || 1;
          this._islands[i].scale.setScalar(bs * (isSel ? 1.12 : 1));
          this._islands[i].position.y = isSel ? 0.05 : 0;
        }
        const key = s.k + '|' + isSel;
        if (key !== p.lastKey) {
          p.lastKey = key;
          const old = p.sprite.material;
          p.sprite.material = this._label(s, isSel || s.k === 'live');
          if (old.map) old.map.dispose(); old.dispose();
        }
      });
      this._pulses = this._pins.filter((p, i) => a.stops[i].k === 'live').map(p => p.pulse);
      this._bobs = this._pins.filter((p, i) => a.stops[i].k === 'live' || a.sel === i).map(p => p.head);

      const li = a.leg, f = Math.max(0, Math.min(1, (a.prog - li * 25) / 25));
      this._uProg = a.prog >= 100 ? 1 : this._uStops[li] + (this._uStops[li + 1] - this._uStops[li]) * f;
      if (a.prog !== this._lastProg) {
        this._lastProg = a.prog;
        if (this._progStrip) { this._route.remove(this._progStrip); this._progStrip.geometry.dispose(); }
        const n = Math.round(this._uProg * 400);
        if (n > 2) {
          this._progStrip = new this.T.Mesh(this._strip(this._samples.slice(0, n + 1), 0.56, 0.062),
            new this.T.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.28, depthWrite: false, side: this.T.DoubleSide }));
          this._route.add(this._progStrip);
        } else this._progStrip = null;
      }
    }
  }
  customElements.define('oasis-map-3d', OasisMap3D);
})();
