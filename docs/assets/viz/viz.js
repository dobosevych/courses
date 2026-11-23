/* Viz kit — shared helpers for standalone visualizations.

   Load in <head> (before first paint) together with viz.css:

     <link rel="stylesheet" href="../../../assets/viz/viz.css">
     <script src="../../../assets/viz/viz.js"></script>

   What it does on its own
   - Theme: sets <html data-theme> to the Catppuccin flavour of the page that embeds
     the visualization and follows it when the reader switches palette. Opened on its
     own, it uses ?theme=…, then the last choice, then the system light/dark setting.
   - Size: when embedded in an <iframe>, keeps the frame as tall as the content.

   What it offers (window.Viz)
   - colors(), onTheme(fn)             theme colours for canvas drawing
   - autoCanvas(canvas, opts)          HiDPI canvas that redraws on resize / theme change
   - sample(name, size), imagePicker() built-in grayscale test images and upload
   - paintGray(), paintRGBA()          put pixel data on a canvas, enlarged with crisp pixels
   - convolve(), blur(), gaussian1d()  basic filtering
   - viridis(t), magma(t)              colour maps for heat maps
   - rng(seed), gauss(rand), clamp()   small utilities
*/
(function () {
  "use strict";

  var root = document.documentElement;
  var THEMES = ["latte", "frappe", "macchiato", "mocha"];

  // ---------------------------------------------------------------- embedding
  var embedded = false;
  var sameOrigin = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) {
    try { sameOrigin = !!window.parent.document.body; } catch (e) { sameOrigin = false; }
    root.classList.add("is-embedded");
  }

  // -------------------------------------------------------------------- theme
  function valid(t) { return THEMES.indexOf(t) >= 0 ? t : null; }

  function themeFromParent() {
    if (!sameOrigin) return null;
    try { return valid(window.parent.document.body.getAttribute("data-md-color-scheme")); }
    catch (e) { return null; }
  }

  function themeFromQuery() {
    var m = /[?&]theme=([a-z]+)/.exec(window.location.search);
    return m ? valid(m[1]) : null;
  }

  function themeFromStorage() {
    try {
      var own = valid(window.localStorage.getItem("viz-theme"));
      if (own) return own;
      // The site (MkDocs Material) stores its palette under "<site path>.__palette".
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (!/\.__palette$/.test(key)) continue;
        if (window.location.pathname.indexOf(key.replace(/\.__palette$/, "")) !== 0) continue;
        var value = JSON.parse(window.localStorage.getItem(key));
        var scheme = value && value.color && valid(value.color.scheme);
        if (scheme) return scheme;
      }
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function themeFromSystem() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "mocha" : "latte";
  }

  var themeListeners = [];
  var colorCache = null;

  function theme() { return root.getAttribute("data-theme") || "latte"; }

  function setTheme(t) {
    t = valid(t);
    if (!t || t === root.getAttribute("data-theme")) return;
    root.setAttribute("data-theme", t);
    colorCache = null;
    themeListeners.forEach(function (fn) {
      try { fn(colors()); } catch (e) { console.error(e); }
    });
  }

  root.setAttribute(
    "data-theme",
    themeFromParent() || themeFromQuery() || themeFromStorage() || themeFromSystem()
  );

  // Follow the embedding page when the reader switches palette.
  if (sameOrigin) {
    try {
      new MutationObserver(function () { setTheme(themeFromParent()); })
        .observe(window.parent.document.body, {
          attributes: true,
          attributeFilter: ["data-md-color-scheme"]
        });
    } catch (e) { /* not observable */ }
  }

  var COLOR_NAMES = [
    "base", "mantle", "crust", "surface0", "surface1", "surface2", "overlay0", "overlay1",
    "subtext0", "subtext1", "text", "lavender", "blue", "sapphire", "sky", "teal", "green",
    "yellow", "peach", "maroon", "red", "mauve", "pink",
    "bg", "panel", "line", "muted", "faint", "primary", "accent"
  ];

  /** Resolved theme colours, e.g. Viz.colors().accent → "#40a02b". */
  function colors() {
    if (colorCache) return colorCache;
    var style = window.getComputedStyle(root);
    var out = { dark: theme() !== "latte" };
    COLOR_NAMES.forEach(function (name) {
      out[name] = style.getPropertyValue("--" + name).trim();
    });
    colorCache = out;
    return out;
  }

  /** Call fn(colors) whenever the theme changes. */
  function onTheme(fn) { themeListeners.push(fn); }

  // ------------------------------------------------------------ frame height
  function fit() {
    if (!embedded) return;
    var h = Math.ceil(root.getBoundingClientRect().height);
    if (!(h > 0)) return;
    if (sameOrigin) {
      try {
        var frame = window.frameElement;
        if (frame) { frame.style.height = h + "px"; return; }
      } catch (e) { /* fall through */ }
    }
    try { window.parent.postMessage({ type: "viz:height", height: h }, "*"); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------- page chrome
  function addThemeButton() {
    if (embedded) return;
    var head = document.querySelector(".viz-head");
    if (!head) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small";
    function label() { btn.textContent = "Theme: " + theme(); }
    btn.addEventListener("click", function () {
      var next = THEMES[(THEMES.indexOf(theme()) + 1) % THEMES.length];
      setTheme(next);
      try { window.localStorage.setItem("viz-theme", next); } catch (e) { /* ignore */ }
      label();
    });
    label();
    head.appendChild(btn);
  }

  document.addEventListener("DOMContentLoaded", function () {
    addThemeButton();
    fit();
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(document.body);
  });
  window.addEventListener("load", fit);

  // ---------------------------------------------------------------- utilities
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** Seeded pseudo-random generator (mulberry32): rng(1)() → number in [0, 1). */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Standard normal sample from a uniform generator. */
  function gauss(rand) {
    var u = 1 - rand();
    var v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ------------------------------------------------------------------ canvas
  /**
   * Responsive HiDPI canvas. opts.aspect = height / width (default 0.6),
   * opts.draw(ctx, width, height, colors) draws in CSS pixels.
   * Returns { redraw(), width(), height() }.
   */
  function autoCanvas(canvas, opts) {
    opts = opts || {};
    var cssW = 0;
    var cssH = 0;

    function redraw() {
      var w = Math.round(canvas.clientWidth);
      if (!(w > 0)) return;
      var h = Math.round(opts.height || w * (opts.aspect || 0.6));
      var dpr = window.devicePixelRatio || 1;
      if (w !== cssW || h !== cssH || canvas.width !== Math.round(w * dpr)) {
        cssW = w;
        cssH = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + "px";
      }
      var ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (opts.draw) opts.draw(ctx, w, h, colors());
    }

    if ("ResizeObserver" in window) {
      new ResizeObserver(function () {
        if (Math.round(canvas.clientWidth) !== cssW) redraw();
      }).observe(canvas.parentElement || canvas);
    }
    onTheme(redraw);
    redraw();
    return {
      redraw: redraw,
      width: function () { return cssW; },
      height: function () { return cssH; }
    };
  }

  var scratch = new WeakMap();

  function scratchFor(canvas, w, h) {
    var s = scratch.get(canvas);
    if (!s || s.canvas.width !== w || s.canvas.height !== h) {
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var ctx = c.getContext("2d");
      s = { canvas: c, ctx: ctx, image: ctx.createImageData(w, h) };
      scratch.set(canvas, s);
    }
    return s;
  }

  function blit(canvas, s, w, h, scale) {
    scale = scale || 1;
    if (canvas.width !== w * scale || canvas.height !== h * scale) {
      canvas.width = w * scale;
      canvas.height = h * scale;
    }
    s.ctx.putImageData(s.image, 0, 0);
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(s.canvas, 0, 0, w * scale, h * scale);
    return ctx;
  }

  /**
   * Draw grayscale data (values 0–255, length w*h) on a canvas, enlarged opts.scale
   * times with crisp pixels. Returns the 2D context so overlays can be drawn on top
   * (in canvas pixels, i.e. image coordinates × scale).
   */
  function paintGray(canvas, data, w, h, opts) {
    var s = scratchFor(canvas, w, h);
    var px = s.image.data;
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      var v = data[i];
      px[j] = px[j + 1] = px[j + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      px[j + 3] = 255;
    }
    return blit(canvas, s, w, h, opts && opts.scale);
  }

  /** Same as paintGray for RGBA data (length w*h*4). */
  function paintRGBA(canvas, rgba, w, h, opts) {
    var s = scratchFor(canvas, w, h);
    s.image.data.set(rgba);
    return blit(canvas, s, w, h, opts && opts.scale);
  }

  // -------------------------------------------------------------- colour maps
  function ramp(stops) {
    return function (t) {
      t = clamp(t, 0, 1) * (stops.length - 1);
      var i = Math.min(Math.floor(t), stops.length - 2);
      var f = t - i;
      var a = stops[i];
      var b = stops[i + 1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    };
  }

  var viridis = ramp([
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]
  ]);

  var magma = ramp([
    [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122],
    [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]
  ]);

  // ------------------------------------------------------------ sample images
  function g(v) {
    v = Math.round(v);
    return "rgb(" + v + "," + v + "," + v + ")";
  }

  function poly(c, s, pts) {
    c.beginPath();
    pts.forEach(function (p, i) {
      if (i) c.lineTo(p[0] * s, p[1] * s); else c.moveTo(p[0] * s, p[1] * s);
    });
    c.closePath();
    c.fill();
  }

  function disc(c, s, x, y, r) {
    c.beginPath();
    c.arc(x * s, y * s, r * s, 0, 2 * Math.PI);
    c.fill();
  }

  function drawScene(c, s) {
    var sky = c.createLinearGradient(0, 0, 0, 0.64 * s);
    sky.addColorStop(0, g(72));
    sky.addColorStop(1, g(192));
    c.fillStyle = sky;
    c.fillRect(0, 0, s, s);
    c.fillStyle = g(246);
    disc(c, s, 0.78, 0.17, 0.075);
    c.fillStyle = g(214);
    disc(c, s, 0.24, 0.17, 0.05);
    disc(c, s, 0.31, 0.14, 0.06);
    disc(c, s, 0.39, 0.17, 0.045);
    c.fillStyle = g(142);
    poly(c, s, [[0, 0.62], [0.12, 0.44], [0.26, 0.56], [0.42, 0.34], [0.6, 0.58], [0.74, 0.45],
      [0.9, 0.6], [1, 0.5], [1, 0.7], [0, 0.7]]);
    c.fillStyle = g(96);
    poly(c, s, [[0, 0.66], [0.2, 0.57], [0.45, 0.65], [0.7, 0.56], [1, 0.64], [1, 0.74], [0, 0.74]]);
    var ground = c.createLinearGradient(0, 0.68 * s, 0, s);
    ground.addColorStop(0, g(124));
    ground.addColorStop(1, g(58));
    c.fillStyle = ground;
    c.fillRect(0, 0.69 * s, s, 0.31 * s);
    c.fillStyle = g(170);
    poly(c, s, [[0.45, 0.69], [0.5, 0.69], [0.76, 1], [0.46, 1]]);
    c.fillStyle = g(226);
    c.fillRect(0.12 * s, 0.5 * s, 0.26 * s, 0.22 * s);
    c.fillStyle = g(38);
    poly(c, s, [[0.09, 0.5], [0.25, 0.35], [0.41, 0.5]]);
    c.fillStyle = g(58);
    c.fillRect(0.22 * s, 0.6 * s, 0.06 * s, 0.12 * s);
    c.fillStyle = g(112);
    c.fillRect(0.15 * s, 0.55 * s, 0.05 * s, 0.05 * s);
    c.fillRect(0.31 * s, 0.55 * s, 0.05 * s, 0.05 * s);
    c.fillStyle = g(48);
    c.fillRect(0.795 * s, 0.52 * s, 0.03 * s, 0.21 * s);
    c.fillStyle = g(78);
    disc(c, s, 0.81, 0.45, 0.1);
    c.fillStyle = g(104);
    disc(c, s, 0.77, 0.42, 0.05);
    c.strokeStyle = g(236);
    c.lineWidth = Math.max(1, 0.009 * s);
    c.beginPath();
    for (var i = 0; i < 5; i++) {
      var x = (0.56 + i * 0.04) * s;
      c.moveTo(x, 0.7 * s);
      c.lineTo(x, 0.77 * s);
    }
    c.moveTo(0.55 * s, 0.725 * s);
    c.lineTo(0.73 * s, 0.725 * s);
    c.stroke();
  }

  function drawShapes(c, s) {
    c.fillStyle = g(56);
    c.fillRect(0, 0, s, s);
    c.fillStyle = g(222);
    c.fillRect(0.1 * s, 0.1 * s, 0.3 * s, 0.24 * s);
    c.fillStyle = g(168);
    disc(c, s, 0.72, 0.26, 0.17);
    c.fillStyle = g(120);
    poly(c, s, [[0.12, 0.9], [0.3, 0.5], [0.48, 0.9]]);
    c.strokeStyle = g(240);
    c.lineWidth = Math.max(1, 0.03 * s);
    c.beginPath();
    c.arc(0.74 * s, 0.72 * s, 0.14 * s, 0, 2 * Math.PI);
    c.stroke();
    c.lineWidth = Math.max(1, 0.012 * s);
    c.beginPath();
    c.moveTo(0.46 * s, 0.42 * s);
    c.lineTo(0.94 * s, 0.5 * s);
    c.stroke();
    var blob = c.createRadialGradient(0.5 * s, 0.2 * s, 0, 0.5 * s, 0.2 * s, 0.09 * s);
    blob.addColorStop(0, "rgba(255,255,255,0.9)");
    blob.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = blob;
    c.fillRect(0.4 * s, 0.1 * s, 0.2 * s, 0.2 * s);
  }

  function drawText(c, s) {
    c.fillStyle = g(232);
    c.fillRect(0, 0, s, s);
    c.fillStyle = g(32);
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.font = "800 " + Math.round(0.34 * s) + "px Arial, Helvetica, sans-serif";
    c.fillText("CV", 0.5 * s, 0.27 * s);
    c.font = "700 " + Math.round(0.15 * s) + "px Arial, Helvetica, sans-serif";
    c.fillText("VISION", 0.5 * s, 0.6 * s);
    c.font = "600 " + Math.round(0.11 * s) + "px Arial, Helvetica, sans-serif";
    c.fillText("image 0123", 0.5 * s, 0.83 * s);
  }

  function drawCoins(c, s) {
    c.fillStyle = g(44);
    c.fillRect(0, 0, s, s);
    [[0.2, 0.2, 0.11, 208], [0.52, 0.17, 0.085, 164], [0.8, 0.24, 0.12, 228],
      [0.16, 0.52, 0.08, 148], [0.42, 0.47, 0.12, 196], [0.72, 0.56, 0.09, 176],
      [0.25, 0.8, 0.12, 222], [0.56, 0.8, 0.09, 156], [0.83, 0.82, 0.1, 204]
    ].forEach(function (k) {
      c.fillStyle = g(k[3]);
      disc(c, s, k[0], k[1], k[2]);
      c.fillStyle = g(k[3] - 34);
      disc(c, s, k[0], k[1], k[2] * 0.62);
      c.fillStyle = g(k[3] - 14);
      disc(c, s, k[0], k[1], k[2] * 0.34);
    });
  }

  function drawChecker(c, s) {
    var n = 8;
    var cell = s / n;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        c.fillStyle = g((x + y) % 2 ? 214 : 42);
        c.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  var SAMPLES = {
    scene: { label: "Scene", draw: drawScene, grain: 5 },
    shapes: { label: "Shapes", draw: drawShapes, grain: 2 },
    text: { label: "Text", draw: drawText, grain: 2 },
    coins: { label: "Coins", draw: drawCoins, grain: 4 },
    checker: { label: "Checkerboard", draw: drawChecker, grain: 0 }
  };

  function toGray(ctx, w, h) {
    var px = ctx.getImageData(0, 0, w, h).data;
    var out = new Float32Array(w * h);
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      out[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    }
    return out;
  }

  /**
   * Built-in grayscale test image: sample("scene", 128) → { data, w, h, name }.
   * Names: scene, shapes, text, coins, checker. Deterministic for a given size.
   */
  function sample(name, size) {
    var def = SAMPLES[name] || SAMPLES.scene;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    def.draw(ctx, size);
    var data = toGray(ctx, size, size);
    if (def.grain) {
      var rand = rng(7);
      for (var i = 0; i < data.length; i++) {
        data[i] = clamp(data[i] + gauss(rand) * def.grain, 0, 255);
      }
    }
    return { data: data, w: size, h: size, name: name };
  }

  /** Read an image file, centre-crop to a square, resize, convert to grayscale. */
  function loadImageFile(file, size) {
    return window.createImageBitmap(file).then(function (bmp) {
      var side = Math.min(bmp.width, bmp.height);
      var c = document.createElement("canvas");
      c.width = c.height = size;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      return { data: toGray(ctx, size, size), w: size, h: size, name: "upload" };
    });
  }

  /**
   * Image selector: built-in samples plus "Upload". Appends its controls to `container`.
   * opts: { samples: ["scene", …], size: 128, value: "scene", onChange(image) }.
   * Returns { image() } with the current image.
   */
  function imagePicker(container, opts) {
    opts = opts || {};
    var size = opts.size || 128;
    var names = opts.samples || Object.keys(SAMPLES);
    var current = sample(opts.value || names[0], size);

    var label = document.createElement("label");
    label.className = "ctl";
    var caption = document.createElement("span");
    caption.textContent = opts.label || "Image";
    var select = document.createElement("select");
    names.forEach(function (name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = SAMPLES[name].label;
      select.appendChild(o);
    });
    select.value = current.name;
    label.appendChild(caption);
    label.appendChild(select);

    var upload = document.createElement("label");
    upload.className = "btn";
    upload.textContent = "Upload…";
    var file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.hidden = true;
    upload.appendChild(file);

    function emit() { if (opts.onChange) opts.onChange(current); }

    select.addEventListener("change", function () {
      if (select.value === "upload") return;
      current = sample(select.value, size);
      emit();
    });

    file.addEventListener("change", function () {
      if (!file.files || !file.files[0]) return;
      loadImageFile(file.files[0], size).then(function (img) {
        current = img;
        var o = select.querySelector('option[value="upload"]');
        if (!o) {
          o = document.createElement("option");
          o.value = "upload";
          o.textContent = "Your image";
          select.appendChild(o);
        }
        select.value = "upload";
        emit();
      }).catch(function (e) { console.error(e); });
      file.value = "";
    });

    container.appendChild(label);
    container.appendChild(upload);
    return { image: function () { return current; } };
  }

  // ---------------------------------------------------------------- filtering
  /** 2D correlation with a kw×kh kernel; borders are replicated. Returns Float32Array. */
  function convolve(src, w, h, kernel, kw, kh) {
    var out = new Float32Array(w * h);
    var rx = (kw - 1) >> 1;
    var ry = (kh - 1) >> 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var acc = 0;
        for (var j = 0; j < kh; j++) {
          var yy = y + j - ry;
          yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
          for (var i = 0; i < kw; i++) {
            var xx = x + i - rx;
            xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
            acc += kernel[j * kw + i] * src[yy * w + xx];
          }
        }
        out[y * w + x] = acc;
      }
    }
    return out;
  }

  /** Normalised 1D Gaussian with radius ceil(3σ). */
  function gaussian1d(sigma) {
    var r = Math.max(1, Math.ceil(3 * sigma));
    var k = new Float32Array(2 * r + 1);
    var sum = 0;
    for (var i = -r; i <= r; i++) {
      k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
      sum += k[i + r];
    }
    for (var j = 0; j < k.length; j++) k[j] /= sum;
    return k;
  }

  /** Gaussian blur (separable). sigma <= 0 returns a copy. */
  function blur(src, w, h, sigma) {
    if (!(sigma > 0)) return new Float32Array(src);
    var k = gaussian1d(sigma);
    return convolve(convolve(src, w, h, k, k.length, 1), w, h, k, 1, k.length);
  }

  window.Viz = {
    embedded: embedded,
    themes: THEMES,
    theme: theme,
    setTheme: setTheme,
    colors: colors,
    onTheme: onTheme,
    fit: fit,
    clamp: clamp,
    rng: rng,
    gauss: gauss,
    autoCanvas: autoCanvas,
    paintGray: paintGray,
    paintRGBA: paintRGBA,
    viridis: viridis,
    magma: magma,
    samples: SAMPLES,
    sample: sample,
    loadImageFile: loadImageFile,
    imagePicker: imagePicker,
    convolve: convolve,
    gaussian1d: gaussian1d,
    blur: blur
  };
})();
