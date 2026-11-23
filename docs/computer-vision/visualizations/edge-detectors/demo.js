/* Edge detectors: how each operator turns an image into an edge map. */
(function () {
  "use strict";

  var N = 128;      // image side in pixels
  var SCALE = 2;    // on-screen enlargement of the six main panes
  var EPS = 0.01;   // responses smaller than this count as zero (float round-off)
  var $ = function (id) { return document.getElementById(id); };

  var OPS = [
    {
      id: "roberts", label: "Roberts cross", type: "grad", size: 2, diagonal: true,
      kx: [1, 0, 0, -1], ky: [0, 1, -1, 0],
      sym: ["G₁", "G₂"], titles: ["G₁ · diagonal ↘", "G₂ · diagonal ↙"],
      note: "Two 2×2 differences along the diagonals. The smallest possible support: edges are " +
        "located sharply, but nothing is averaged, so noise passes straight through."
    },
    {
      id: "prewitt", label: "Prewitt", type: "grad", size: 3,
      kx: [-1, 0, 1, -1, 0, 1, -1, 0, 1], ky: [-1, -1, -1, 0, 0, 0, 1, 1, 1],
      sym: ["Gx", "Gy"], titles: ["Gx · horizontal change", "Gy · vertical change"],
      note: "A central difference (−1 0 1) in one direction, averaged over three rows or " +
        "columns with equal weights."
    },
    {
      id: "sobel", label: "Sobel", type: "grad", size: 3,
      kx: [-1, 0, 1, -2, 0, 2, -1, 0, 1], ky: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      sym: ["Gx", "Gy"], titles: ["Gx · horizontal change", "Gy · vertical change"],
      note: "The same central difference, averaged with weights 1-2-1 — a small Gaussian — so " +
        "the centre row counts twice and noise is suppressed a little better than in Prewitt."
    },
    {
      id: "scharr", label: "Scharr", type: "grad", size: 3,
      kx: [-3, 0, 3, -10, 0, 10, -3, 0, 3], ky: [-3, -10, -3, 0, 0, 0, 3, 10, 3],
      sym: ["Gx", "Gy"], titles: ["Gx · horizontal change", "Gy · vertical change"],
      note: "Weights 3-10-3, tuned so that the estimated gradient direction is almost " +
        "independent of how the edge is rotated."
    },
    {
      id: "lap4", label: "Laplacian (4-neighbour)", short: "Laplacian 4", type: "lap", size: 3,
      k: [0, 1, 0, 1, -4, 1, 0, 1, 0], sym: ["∇²f"],
      note: "A second derivative: f″ along x plus f″ along y in a single kernel. It has no " +
        "direction; an edge is where the response changes sign (a zero-crossing)."
    },
    {
      id: "lap8", label: "Laplacian (8-neighbour)", short: "Laplacian 8", type: "lap", size: 3,
      k: [1, 1, 1, 1, -8, 1, 1, 1, 1], sym: ["∇²f"],
      note: "The Laplacian with the diagonals included: closer to rotation-invariant, and even " +
        "more sensitive to noise."
    },
    {
      id: "log", label: "Laplacian of Gaussian", short: "LoG", type: "lap", sym: ["LoG"],
      note: "Gaussian smoothing and the Laplacian merged into one kernel (the “Mexican hat”). " +
        "σ sets the scale: a small σ keeps fine detail and noise, a large σ keeps only coarse edges."
    }
  ];

  var state = {
    src: null,       // clean sample image
    noise: 0,        // standard deviation of the added noise, in gray levels
    blur: 0,         // σ of the optional Gaussian blur applied before the operator
    op: "sobel",
    sigma: 1.4,      // scale of the LoG kernel
    thr: 20,         // edge threshold, % of the strongest response
    cx: N >> 1,      // inspected pixel
    cy: N >> 1,
    input: null,     // what the operator sees: image + noise, blurred
    results: {}      // per operator id
  };

  var unit = null;   // unit-variance noise, generated once so sliders do not reshuffle it
  var plots = {};

  function opById(id) {
    for (var i = 0; i < OPS.length; i++) if (OPS[i].id === id) return OPS[i];
    return OPS[0];
  }

  // ------------------------------------------------------------- processing
  /** Laplacian of Gaussian, zero-sum, scaled so that the positive weights add up to 1. */
  function logKernel(sigma) {
    var r = Math.ceil(3 * sigma);
    var size = 2 * r + 1;
    var k = new Float32Array(size * size);
    var s2 = sigma * sigma;
    var sum = 0;
    var i;
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        var q = x * x + y * y;
        var v = ((q - 2 * s2) / (s2 * s2)) * Math.exp(-q / (2 * s2));
        k[(y + r) * size + (x + r)] = v;
        sum += v;
      }
    }
    var mean = sum / k.length;
    var pos = 0;
    for (i = 0; i < k.length; i++) {
      k[i] -= mean;
      if (k[i] > 0) pos += k[i];
    }
    for (i = 0; i < k.length; i++) k[i] /= pos;
    return { size: size, k: k };
  }

  /** Kernels of an operator: { size, list: [{ sym, k }] }. */
  function kernels(op) {
    if (op.id === "log") {
      var g = logKernel(state.sigma);
      return { size: g.size, list: [{ sym: op.sym[0], k: g.k }] };
    }
    if (op.type === "grad") {
      return { size: op.size, list: [{ sym: op.sym[0], k: op.kx }, { sym: op.sym[1], k: op.ky }] };
    }
    return { size: op.size, list: [{ sym: op.sym[0], k: op.k }] };
  }

  function sgn(v) { return v > EPS ? 1 : v < -EPS ? -1 : 0; }

  function analyse(img, op) {
    var n = N * N;
    var K = kernels(op);
    var thr = state.thr / 100;
    var edges = new Uint8Array(n);
    var count = 0;
    var i;

    if (op.type === "grad") {
      var a = Viz.convolve(img, N, N, K.list[0].k, K.size, K.size);
      var b = Viz.convolve(img, N, N, K.list[1].k, K.size, K.size);
      var mag = new Float32Array(n);
      var ang = new Float32Array(n);
      var max = 0;
      var maxAbs = 0;
      for (i = 0; i < n; i++) {
        var m = Math.sqrt(a[i] * a[i] + b[i] * b[i]);
        mag[i] = m;
        if (m > max) max = m;
        if (Math.abs(a[i]) > maxAbs) maxAbs = Math.abs(a[i]);
        if (Math.abs(b[i]) > maxAbs) maxAbs = Math.abs(b[i]);
        // Roberts measures along the diagonals; rotate back to the image axes for the direction.
        ang[i] = op.diagonal ? Math.atan2(-a[i] - b[i], b[i] - a[i]) : Math.atan2(b[i], a[i]);
      }
      var cut = thr * max;
      if (max > EPS) {
        for (i = 0; i < n; i++) if (mag[i] >= cut) { edges[i] = 1; count++; }
      }
      return {
        type: "grad", K: K, a: a, b: b, mag: mag, ang: ang, max: max, maxAbs: maxAbs,
        cut: cut, edges: edges, count: count
      };
    }

    var resp = Viz.convolve(img, N, N, K.list[0].k, K.size, K.size);
    var strength = new Float32Array(n);   // size of the jump across a zero-crossing
    var zc = new Uint8Array(n);
    var absMax = 0;
    var maxS = 0;
    var zcCount = 0;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        i = y * N + x;
        var v = resp[i];
        var sv = sgn(v);
        var s = 0;
        if (Math.abs(v) > absMax) absMax = Math.abs(v);
        if (sv !== 0) {
          if (x + 1 < N && sv * sgn(resp[i + 1]) < 0) s = Math.max(s, Math.abs(v - resp[i + 1]));
          if (y + 1 < N && sv * sgn(resp[i + N]) < 0) s = Math.max(s, Math.abs(v - resp[i + N]));
        } else {
          // Exactly zero between a positive and a negative neighbour: the crossing is here.
          if (x > 0 && x + 1 < N && sgn(resp[i - 1]) * sgn(resp[i + 1]) < 0) {
            s = Math.max(s, Math.abs(resp[i - 1] - resp[i + 1]));
          }
          if (y > 0 && y + 1 < N && sgn(resp[i - N]) * sgn(resp[i + N]) < 0) {
            s = Math.max(s, Math.abs(resp[i - N] - resp[i + N]));
          }
        }
        strength[i] = s;
        if (s > 0) { zc[i] = 1; zcCount++; }
        if (s > maxS) maxS = s;
      }
    }
    var cutS = thr * maxS;
    for (i = 0; i < n; i++) if (strength[i] > 0 && strength[i] >= cutS) { edges[i] = 1; count++; }
    return {
      type: "lap", K: K, resp: resp, absMax: absMax, strength: strength, maxS: maxS,
      cut: cutS, zc: zc, zcCount: zcCount, edges: edges, count: count
    };
  }

  function compute() {
    var n = N * N;
    var i;
    if (!unit) {
      unit = new Float32Array(n);
      var rand = Viz.rng(11);
      for (i = 0; i < n; i++) unit[i] = Viz.gauss(rand);
    }
    var noisy = new Float32Array(n);
    for (i = 0; i < n; i++) {
      noisy[i] = Math.round(Viz.clamp(state.src.data[i] + state.noise * unit[i], 0, 255));
    }
    state.input = Viz.blur(noisy, N, N, state.blur);
    OPS.forEach(function (op) { state.results[op.id] = analyse(state.input, op); });
  }

  /** Start on an edge near the centre so the worked example is not all zeros. */
  function placeCursor() {
    var r = state.results.sobel;
    var best = -1;
    var bestD = Infinity;
    for (var y = 2; y < N - 2; y++) {
      for (var x = 2; x < N - 2; x++) {
        var i = y * N + x;
        if (r.mag[i] < 0.5 * r.max) continue;
        var d = (x - N / 2) * (x - N / 2) + (y - N / 2) * (y - N / 2);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) {
      state.cx = best % N;
      state.cy = (best / N) | 0;
    }
  }

  // ---------------------------------------------------------------- colours
  function diverge(t, dark) {
    var zero = dark ? [17, 17, 27] : [250, 250, 252];
    var end = t >= 0 ? (dark ? [255, 112, 82] : [200, 30, 45]) : (dark ? [86, 168, 255] : [30, 90, 200]);
    var a = Math.min(1, Math.abs(t));
    return [
      Math.round(zero[0] + (end[0] - zero[0]) * a),
      Math.round(zero[1] + (end[1] - zero[1]) * a),
      Math.round(zero[2] + (end[2] - zero[2]) * a)
    ];
  }

  function hsv(h, s, v) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    var rgb;
    switch (((i % 6) + 6) % 6) {
      case 0: rgb = [v, t, p]; break;
      case 1: rgb = [q, v, p]; break;
      case 2: rgb = [p, v, t]; break;
      case 3: rgb = [p, q, v]; break;
      case 4: rgb = [t, p, v]; break;
      default: rgb = [v, p, q];
    }
    return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
  }

  /** Hue used for a gradient pointing at angle θ (canvas coordinates, y down). */
  function hueOf(theta) { return (theta + Math.PI) / (2 * Math.PI); }

  function signedRGBA(data, maxAbs, dark) {
    var out = new Uint8ClampedArray(N * N * 4);
    for (var i = 0, j = 0; i < N * N; i++, j += 4) {
      var c = diverge(maxAbs > EPS ? data[i] / maxAbs : 0, dark);
      out[j] = c[0];
      out[j + 1] = c[1];
      out[j + 2] = c[2];
      out[j + 3] = 255;
    }
    return out;
  }

  function signRGBA(data, dark) {
    var out = new Uint8ClampedArray(N * N * 4);
    for (var i = 0, j = 0; i < N * N; i++, j += 4) {
      var c = diverge(sgn(data[i]) * 0.8, dark);
      out[j] = c[0];
      out[j + 1] = c[1];
      out[j + 2] = c[2];
      out[j + 3] = 255;
    }
    return out;
  }

  function directionRGBA(r) {
    var out = new Uint8ClampedArray(N * N * 4);
    for (var i = 0, j = 0; i < N * N; i++, j += 4) {
      var c = [22, 22, 30];
      if (r.max > EPS && r.mag[i] >= r.cut) {
        c = hsv(hueOf(r.ang[i]), 0.85, 0.6 + 0.4 * Math.min(1, r.mag[i] / r.max));
      }
      out[j] = c[0];
      out[j + 1] = c[1];
      out[j + 2] = c[2];
      out[j + 3] = 255;
    }
    return out;
  }

  function scaledGray(data, max, abs) {
    var out = new Float32Array(N * N);
    if (max > EPS) {
      for (var i = 0; i < N * N; i++) out[i] = 255 * (abs ? Math.abs(data[i]) : data[i]) / max;
    }
    return out;
  }

  function maskGray(mask) {
    var out = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) out[i] = mask[i] ? 255 : 0;
    return out;
  }

  // --------------------------------------------------------------- drawing
  function fmt(v) {
    var r = Math.round(v);
    var s = Math.abs(v - r) < 0.05 ? String(r === 0 ? 0 : r) : v.toFixed(1);
    return s.replace("-", "−");
  }

  function fmtK(v) {
    var r = Math.round(v);
    var s = Math.abs(v - r) < 1e-6 ? String(r === 0 ? 0 : r) : v.toFixed(2);
    return s.replace("-", "−");
  }

  /** Top-left corner and side of the kernel footprint at the inspected pixel. */
  function footprint(size) {
    var r = size === 2 ? 0 : (size - 1) >> 1;
    return { x: state.cx - r, y: state.cy - r, n: size };
  }

  /** Cross-hair through the inspected pixel and a wash over the kernel footprint. */
  function mark(ctx, size, col, row) {
    var s = SCALE;
    var f = footprint(size);
    var x0 = f.x * s;
    var y0 = f.y * s;
    var side = f.n * s;
    var mx = state.cx * s + s / 2;
    var my = state.cy * s + s / 2;
    var end = N * s;
    ctx.fillStyle = col.peach;
    // The row line is stronger on the input: that row is the one plotted below.
    ctx.globalAlpha = row ? 0.7 : 0.4;
    ctx.fillRect(0, my - 0.5, x0, 1);
    ctx.fillRect(x0 + side, my - 0.5, end - x0 - side, 1);
    ctx.globalAlpha = 0.4;
    ctx.fillRect(mx - 0.5, 0, 1, y0);
    ctx.fillRect(mx - 0.5, y0 + side, 1, end - y0 - side);
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0, y0, side, side);
    ctx.globalAlpha = 1;
  }

  /** Small colour wheel in the corner of the direction pane. */
  function wheel(ctx) {
    var R = 21;
    var cx = N * SCALE - R - 6;
    var cy = N * SCALE - R - 6;
    ctx.fillStyle = "rgba(10, 10, 16, 0.75)";
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, 2 * Math.PI);
    ctx.fill();
    var steps = 48;
    for (var k = 0; k < steps; k++) {
      var a0 = -Math.PI + (k / steps) * 2 * Math.PI;
      var a1 = a0 + (2 * Math.PI) / steps + 0.02;
      var c = hsv(hueOf((a0 + a1) / 2), 0.85, 1);
      ctx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(10, 10, 16, 0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42, 0, 2 * Math.PI);
    ctx.fill();
  }

  function setCaption(k, title, info) {
    $("t" + k).textContent = title;
    $("s" + k).textContent = info || "";
  }

  function paintPanes() {
    var op = opById(state.op);
    var r = state.results[op.id];
    var col = Viz.colors();
    var size = r.K.size;
    var o = { scale: SCALE };

    mark(Viz.paintGray($("c0"), state.input, N, N, o), size, col, true);
    var info = [];
    if (state.noise > 0) info.push("noise " + state.noise);
    if (state.blur > 0) info.push("blur σ " + state.blur.toFixed(1));
    setCaption(0, "Input", info.join(" · "));

    if (r.type === "grad") {
      mark(Viz.paintRGBA($("c1"), signedRGBA(r.a, r.maxAbs, col.dark), N, N, o), size, col);
      mark(Viz.paintRGBA($("c2"), signedRGBA(r.b, r.maxAbs, col.dark), N, N, o), size, col);
      mark(Viz.paintGray($("c3"), scaledGray(r.mag, r.max), N, N, o), size, col);
      var ctx = Viz.paintRGBA($("c4"), directionRGBA(r), N, N, o);
      wheel(ctx);
      mark(ctx, size, col);
      mark(Viz.paintGray($("c5"), maskGray(r.edges), N, N, o), size, col);
      setCaption(1, op.titles[0]);
      setCaption(2, op.titles[1]);
      setCaption(3, "Magnitude |G|", "max " + fmt(r.max));
      setCaption(4, "Direction θ");
      setCaption(5, "Edges", r.count + " px");
    } else {
      mark(Viz.paintRGBA($("c1"), signedRGBA(r.resp, r.absMax, col.dark), N, N, o), size, col);
      mark(Viz.paintGray($("c2"), scaledGray(r.resp, r.absMax, true), N, N, o), size, col);
      mark(Viz.paintRGBA($("c3"), signRGBA(r.resp, col.dark), N, N, o), size, col);
      mark(Viz.paintGray($("c4"), maskGray(r.zc), N, N, o), size, col);
      mark(Viz.paintGray($("c5"), maskGray(r.edges), N, N, o), size, col);
      setCaption(1, "Response " + op.sym[0]);
      setCaption(2, "Strength |" + op.sym[0] + "|", "max " + fmt(r.absMax));
      setCaption(3, "Sign of the response");
      setCaption(4, "All zero-crossings", r.zcCount + " px");
      setCaption(5, "Edges", r.count + " px");
    }
  }

  function renderLegend() {
    var r = state.results[state.op];
    var dark = Viz.colors().dark;
    var p = diverge(1, dark);
    var n = diverge(-1, dark);
    var sw = function (c) {
      return '<i class="swatch" style="background: rgb(' + c.join(",") + ')"></i>';
    };
    var html = "<span>" + sw(p) + "positive response</span><span>" + sw(n) + "negative response</span>";
    if (r.type === "grad") {
      html += "<span>direction: hue = angle of the gradient (see the wheel), shown where |G| passes the threshold</span>";
    } else {
      html += "<span>edges: zero-crossings whose jump passes the threshold</span>";
    }
    html += '<span><i class="swatch" style="background: var(--peach)"></i>cross-hair: inspected pixel, kernel footprint</span>';
    $("legend").innerHTML = html;
  }

  // ------------------------------------------------------- worked example
  function patch(size) {
    var f = footprint(size);
    var out = new Float32Array(size * size);
    for (var j = 0; j < size; j++) {
      for (var i = 0; i < size; i++) {
        var xx = Viz.clamp(f.x + i, 0, N - 1);
        var yy = Viz.clamp(f.y + j, 0, N - 1);
        out[j * size + i] = state.input[yy * N + xx];
      }
    }
    return out;
  }

  function numeric(values, size, gray, format) {
    var html = '<div class="matrix" style="grid-template-columns: repeat(' + size + ', auto)">';
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (gray) {
        var gv = Math.round(Viz.clamp(v, 0, 255));
        html += '<span style="background: rgb(' + gv + "," + gv + "," + gv + "); color: " +
          (gv > 140 ? "#111" : "#fff") + '">' + fmt(v) + "</span>";
      } else {
        html += '<span class="' + (v > EPS ? "pos" : v < -EPS ? "neg" : "") + '">' +
          (format || fmtK)(v) + "</span>";
      }
    }
    return html + "</div>";
  }

  function heat(values, size, gray, dark) {
    var cell = Math.max(5, Math.floor(100 / size));
    var maxAbs = 0;
    var i;
    for (i = 0; i < values.length; i++) maxAbs = Math.max(maxAbs, Math.abs(values[i]));
    var html = '<div class="matrix heat" style="--cell: ' + cell + "px; grid-template-columns: repeat(" +
      size + ", " + cell + 'px)">';
    for (i = 0; i < values.length; i++) {
      var c;
      if (gray) {
        var gv = Math.round(Viz.clamp(values[i], 0, 255));
        c = [gv, gv, gv];
      } else {
        c = diverge(maxAbs > 0 ? values[i] / maxAbs : 0, dark);
      }
      html += '<span style="background: rgb(' + c.join(",") + ')" title="' + fmtK(values[i]) + '"></span>';
    }
    return html + "</div>";
  }

  function boxed(inner, caption) {
    return '<span class="mx">' + inner + '<span class="cap">' + caption + "</span></span>";
  }

  function calcRow(kernel, pix, size, dark) {
    var prod = new Float32Array(pix.length);
    var sum = 0;
    for (var i = 0; i < pix.length; i++) {
      prod[i] = pix[i] * kernel.k[i];
      sum += prod[i];
    }
    var small = size <= 3;
    return '<div class="calc-row">' +
      boxed(small ? numeric(pix, size, true) : heat(pix, size, true, dark), "pixels") +
      '<span class="sym">×</span>' +
      boxed(small ? numeric(kernel.k, size, false) : heat(kernel.k, size, false, dark),
        "kernel " + kernel.sym + (small ? "" : " " + size + "×" + size)) +
      '<span class="sym">=</span>' +
      boxed(small ? numeric(prod, size, false, fmt) : heat(prod, size, false, dark), "products") +
      '<span class="sum">Σ = <b>' + fmt(sum) + "</b></span></div>";
  }

  function renderInspector() {
    var op = opById(state.op);
    var r = state.results[op.id];
    var size = r.K.size;
    var pix = patch(size);
    var dark = Viz.colors().dark;
    var i = state.cy * N + state.cx;

    $("insp-pos").textContent = "pixel (" + state.cx + ", " + state.cy + ")";
    $("row-pos").textContent = "y = " + state.cy;
    $("op-note").textContent = op.label + ". " + op.note;
    $("calc").innerHTML = r.K.list.map(function (k) { return calcRow(k, pix, size, dark); }).join("");

    var text;
    if (r.type === "grad") {
      var deg = Math.round((r.ang[i] * 180) / Math.PI);
      var s0 = op.sym[0];
      var s1 = op.sym[1];
      text = "<b>" + s0 + "</b> = " + fmt(r.a[i]) + " &nbsp; <b>" + s1 + "</b> = " + fmt(r.b[i]) +
        "<br><b>|G|</b> = √(" + s0 + "² + " + s1 + "²) = " + fmt(r.mag[i]);
      if (r.mag[i] > EPS) {
        text += "<br><b>θ</b> = " + (op.diagonal
          ? fmt(deg) + "° (rotated back from the diagonals to the image axes)"
          : "atan2(" + s1 + ", " + s0 + ") = " + fmt(deg) + "°");
      } else {
        text += "<br><b>θ</b> undefined: no change here";
      }
      text += "<br>edge: " + (r.edges[i]
        ? "<b>yes</b> — |G| ≥ threshold " + fmt(r.cut)
        : "no — |G| &lt; threshold " + fmt(r.cut));
      $("arrow").hidden = false;
    } else {
      text = "<b>" + op.sym[0] + "</b> = " + fmt(r.resp[i]) +
        "<br>sign change next to this pixel: " +
        (r.zc[i] ? "<b>yes</b>, jump " + fmt(r.strength[i]) : "no") +
        "<br>edge: " + (r.edges[i]
          ? "<b>yes</b> — jump ≥ threshold " + fmt(r.cut)
          : "no" + (r.zc[i] ? " — jump &lt; threshold " + fmt(r.cut) : ""));
      $("arrow").hidden = true;
    }
    $("result").innerHTML = text;
  }

  function drawArrow(ctx, w, h, col) {
    var r = state.results[state.op];
    if (r.type !== "grad") return;
    var i = state.cy * N + state.cx;
    var cx = w / 2;
    var cy = h / 2;
    var R = Math.min(w, h) / 2 - 4;
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    if (!(r.mag[i] > EPS) || !(r.max > EPS)) {
      ctx.fillStyle = col.faint;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fill();
      return;
    }
    var a = r.ang[i];
    var len = R * (0.35 + 0.65 * Math.min(1, r.mag[i] / r.max));
    var c = hsv(hueOf(a), 0.85, col.dark ? 1 : 0.8);
    var colour = "rgb(" + c.join(",") + ")";
    var ex = cx + Math.cos(a) * len;
    var ey = cy + Math.sin(a) * len;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4);
    ctx.lineTo(ex + Math.cos(a + 2.5) * 8, ey + Math.sin(a + 2.5) * 8);
    ctx.lineTo(ex + Math.cos(a - 2.5) * 8, ey + Math.sin(a - 2.5) * 8);
    ctx.closePath();
    ctx.fill();
  }

  // ------------------------------------------------------------ 1D profile
  function drawProfile(ctx, w, h, col) {
    var y = state.cy;
    var f = new Float32Array(N);
    var d1 = new Float32Array(N);
    var d2 = new Float32Array(N);
    var x;
    for (x = 0; x < N; x++) f[x] = state.input[y * N + x];
    for (x = 0; x < N; x++) {
      var l = f[Math.max(0, x - 1)];
      var rr = f[Math.min(N - 1, x + 1)];
      d1[x] = (rr - l) / 2;
      d2[x] = rr - 2 * f[x] + l;
    }
    var bands = [
      { data: f, label: "f(x) · intensity", colour: col.text, signed: false },
      { data: d1, label: "f′(x) · first derivative", colour: col.accent, signed: true },
      { data: d2, label: "f″(x) · second derivative", colour: col.primary, signed: true }
    ];
    var padL = 6;
    var padR = 6;
    var gap = 8;
    var bh = (h - gap * 2) / 3;
    var X = function (v) { return padL + ((v + 0.5) / N) * (w - padL - padR); };

    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textBaseline = "top";
    bands.forEach(function (b, k) {
      var top = k * (bh + gap);
      var y0 = top + 16;
      var y1 = top + bh - 2;
      var Y;
      var m = 0;
      var i;
      if (b.signed) {
        for (i = 0; i < N; i++) m = Math.max(m, Math.abs(b.data[i]));
        if (m < 1) m = 1;
        var mid = (y0 + y1) / 2;
        Y = function (v) { return mid - (v / m) * ((y1 - y0) / 2); };
        ctx.strokeStyle = col.faint;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, mid);
        ctx.lineTo(w - padR, mid);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        Y = function (v) { return y1 - (v / 255) * (y1 - y0); };
      }
      ctx.strokeStyle = b.colour;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        if (i) ctx.lineTo(X(i), Y(b.data[i])); else ctx.moveTo(X(i), Y(b.data[i]));
      }
      ctx.stroke();

      ctx.fillStyle = b.colour;
      ctx.beginPath();
      ctx.arc(X(state.cx), Y(b.data[state.cx]), 3.5, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = col.muted;
      ctx.textAlign = "left";
      ctx.fillText(b.label, padL, top);
      ctx.textAlign = "right";
      ctx.fillStyle = col.text;
      ctx.fillText(fmt(b.data[state.cx]), w - padR, top);

      if (k < 2) {
        ctx.strokeStyle = col.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, top + bh + gap / 2);
        ctx.lineTo(w, top + bh + gap / 2);
        ctx.stroke();
      }
    });

    ctx.strokeStyle = col.peach;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(X(state.cx), 14);
    ctx.lineTo(X(state.cx), h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------ comparison strip
  function buildStrip() {
    var strip = $("strip");
    OPS.forEach(function (op) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.op = op.id;
      var cap = document.createElement("span");
      cap.className = "tile-cap";
      var name = document.createElement("span");
      name.textContent = op.short || op.label;
      cap.appendChild(name);
      cap.appendChild(document.createElement("small"));
      tile.appendChild(cap);
      tile.appendChild(document.createElement("canvas"));
      strip.appendChild(tile);
    });
    strip.addEventListener("click", function (ev) {
      var tile = ev.target.closest("button[data-op]");
      if (!tile) return;
      setOp(tile.dataset.op);
      render();
    });
  }

  function renderStrip() {
    Array.prototype.forEach.call($("strip").children, function (tile) {
      var r = state.results[tile.dataset.op];
      // Drawn at twice the size and scaled down smoothly, so one-pixel lines never drop out.
      Viz.paintGray(tile.querySelector("canvas"), maskGray(r.edges), N, N, { scale: 2 });
      tile.querySelector("small").textContent = r.count + " px";
      tile.classList.toggle("is-active", tile.dataset.op === state.op);
      tile.setAttribute("aria-pressed", String(tile.dataset.op === state.op));
    });
  }

  // ------------------------------------------------------------ rendering
  /** Everything that depends on the inspected pixel. */
  function renderCursor() {
    paintPanes();
    renderInspector();
    plots.profile.redraw();
    plots.arrow.redraw();
  }

  function render() {
    renderLegend();
    renderStrip();
    renderCursor();
  }

  function recompute() {
    compute();
    render();
  }

  // ----------------------------------------------------------- interaction
  function setOp(id) {
    state.op = id;
    $("op").value = id;
    $("ctl-sigma").hidden = id !== "log";
  }

  function syncLabels() {
    $("o-noise").textContent = state.noise ? "σ = " + state.noise : "none";
    $("o-blur").textContent = state.blur > 0 ? state.blur.toFixed(1) : "off";
    $("o-thr").textContent = state.thr + "% of max";
    $("o-sigma").textContent = state.sigma.toFixed(1);
  }

  function bindSlider(id, key) {
    $(id).addEventListener("input", function () {
      state[key] = parseFloat($(id).value);
      syncLabels();
      recompute();
    });
  }

  function trackPointer(canvas) {
    function move(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = Math.floor(((ev.clientX - rect.left) / rect.width) * N);
      var y = Math.floor(((ev.clientY - rect.top) / rect.height) * N);
      if (x < 0 || y < 0 || x >= N || y >= N) return;
      if (x === state.cx && y === state.cy) return;
      state.cx = x;
      state.cy = y;
      renderCursor();
    }
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", move);
  }

  function init() {
    var picker = Viz.imagePicker($("picker"), {
      samples: ["scene", "shapes", "coins", "text", "checker"],
      size: N,
      value: "scene",
      onChange: function (img) {
        state.src = img;
        compute();
        placeCursor();
        render();
      }
    });
    state.src = picker.image();

    OPS.forEach(function (op) {
      var o = document.createElement("option");
      o.value = op.id;
      o.textContent = op.label;
      $("op").appendChild(o);
    });
    $("op").addEventListener("change", function () {
      setOp($("op").value);
      render();
    });

    bindSlider("noise", "noise");
    bindSlider("blur", "blur");
    bindSlider("thr", "thr");
    bindSlider("sigma", "sigma");

    buildStrip();
    setOp(state.op);
    syncLabels();
    compute();
    placeCursor();

    plots.profile = Viz.autoCanvas($("profile"), { aspect: 0.66, draw: drawProfile });
    plots.arrow = Viz.autoCanvas($("arrow"), { height: 76, draw: drawArrow });
    for (var k = 0; k < 6; k++) trackPointer($("c" + k));

    // Signed panes and swatches use theme-dependent colours.
    Viz.onTheme(function () {
      renderLegend();
      paintPanes();
      renderInspector();
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
