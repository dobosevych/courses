/* Canny edge detector, one stage at a time. */
(function () {
  "use strict";

  var N = 128;      // image side in pixels
  var BIG = 4;      // enlargement of the main view
  var R = 3;        // the loupe shows (2R + 1)² pixels around the cursor
  var EPS = 0.01;   // gradients smaller than this count as zero (float round-off)
  var $ = function (id) { return document.getElementById(id); };

  var SX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  var SY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  // The four rounded gradient directions and the neighbour each one points to (y runs down).
  var DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  var DIR_LABEL = ["0° →", "45° ↘", "90° ↓", "135° ↙"];
  var DIR_RGB = [[77, 166, 255], [90, 209, 122], [255, 179, 71], [255, 111, 174]];

  var C_NONE = [14, 14, 22];
  var C_STRONG = [255, 255, 255];
  var C_WEAK = [255, 160, 60];
  var C_KEPT = [80, 220, 130];
  var C_DROP = [235, 75, 95];

  var STAGES = [
    {
      id: "input", short: "Input", title: "Input image",
      text: "Canny works on one channel of intensities. Whatever noise is in the image now will " +
        "be amplified by the derivative in stage 3 — add some with the <b>Noise</b> slider and " +
        "follow it through the stages."
    },
    {
      id: "smooth", short: "Smoothing", title: "Gaussian smoothing",
      text: "The image is blurred with a Gaussian of scale <b>σ</b>. <b>Why:</b> a derivative " +
        "amplifies noise, so the noise has to go first. The price is detail — a larger σ " +
        "removes fine structure and rounds corners."
    },
    {
      id: "gradient", short: "Gradient", title: "Gradient magnitude and direction",
      text: "Sobel filters estimate the horizontal and vertical change, G<sub>x</sub> and " +
        "G<sub>y</sub>. The magnitude <b>|G|</b> says how strong the edge is; the angle " +
        "<b>θ</b> points across it. <b>Why it is not enough:</b> every edge is still a ridge " +
        "several pixels wide."
    },
    {
      id: "nms", short: "Non-max suppression", title: "Non-maximum suppression",
      text: "Each pixel is compared with its two neighbours along the gradient direction, " +
        "rounded to 0°, 45°, 90° or 135°. It survives only if it is the largest of the three. " +
        "<b>Why:</b> the edge is the crest of the ridge, so everything beside the crest is removed " +
        "and the edge becomes one pixel wide."
    },
    {
      id: "threshold", short: "Double threshold", title: "Double threshold",
      text: "Two thresholds sort the surviving pixels: <b>strong</b> (at or above high) are " +
        "certainly edges, <b>weak</b> (between low and high) are candidates, the rest are " +
        "discarded. <b>Why two:</b> a single threshold either lets noise through or breaks real " +
        "contours where they fade."
    },
    {
      id: "hysteresis", short: "Hysteresis", title: "Edge tracking by hysteresis",
      text: "A weak pixel is kept only if it is connected to a strong one, directly or through " +
        "other weak pixels (8 neighbours). <b>Why:</b> a weak response that continues a real " +
        "contour is probably edge; an isolated one is probably noise."
    },
    {
      id: "result", short: "Result", title: "Final edge map",
      text: "Strong pixels plus the weak pixels linked to them. The contours are one pixel wide " +
        "and have far fewer gaps than a single threshold would leave."
    }
  ];

  var state = {
    src: null,
    noise: 0,        // standard deviation of the added noise, gray levels
    sigma: 1.4,      // scale of the Gaussian smoothing
    low: 8,          // thresholds, % of the largest gradient magnitude
    high: 20,
    stage: 0,
    colorDir: false,
    overlay: false,
    cx: N >> 1,      // inspected pixel
    cy: N >> 1,
    images: {}       // rendered stage images, rebuilt after every change
  };

  var unit = null;   // unit-variance noise, generated once so sliders do not reshuffle it
  var loupe = null;

  // ------------------------------------------------------------- processing
  function at(a, x, y) {
    return x < 0 || y < 0 || x >= N || y >= N ? 0 : a[y * N + x];
  }

  function compute() {
    var n = N * N;
    var i, x, y;

    if (!unit) {
      unit = new Float32Array(n);
      var rand = Viz.rng(23);
      for (i = 0; i < n; i++) unit[i] = Viz.gauss(rand);
    }

    // 1. Input (with optional noise).
    var input = new Float32Array(n);
    for (i = 0; i < n; i++) {
      input[i] = Math.round(Viz.clamp(state.src.data[i] + state.noise * unit[i], 0, 255));
    }

    // 2. Gaussian smoothing.
    var smooth = Viz.blur(input, N, N, state.sigma);

    // 3. Gradient (Sobel): magnitude, angle, and the angle rounded to four directions.
    var gx = Viz.convolve(smooth, N, N, SX, 3, 3);
    var gy = Viz.convolve(smooth, N, N, SY, 3, 3);
    var mag = new Float32Array(n);
    var ang = new Float32Array(n);
    var bin = new Uint8Array(n);
    var maxMag = 0;
    for (i = 0; i < n; i++) {
      var m = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
      ang[i] = Math.atan2(gy[i], gx[i]);
      var d = (((ang[i] * 180) / Math.PI) % 180 + 180) % 180;
      bin[i] = d < 22.5 || d >= 157.5 ? 0 : d < 67.5 ? 1 : d < 112.5 ? 2 : 3;
    }

    // 4. Non-maximum suppression. A tie is broken towards one side so that a plateau
    //    two pixels wide still leaves a single line.
    var nms = new Float32Array(n);
    var nmsCount = 0;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        i = y * N + x;
        if (!(mag[i] > EPS)) continue;
        var dir = DIRS[bin[i]];
        if (mag[i] > at(mag, x + dir[0], y + dir[1]) && mag[i] >= at(mag, x - dir[0], y - dir[1])) {
          nms[i] = mag[i];
          nmsCount++;
        }
      }
    }

    // 5. Double threshold: 0 discarded, 1 weak, 2 strong.
    var hi = (state.high / 100) * maxMag;
    var lo = (state.low / 100) * maxMag;
    var cls = new Uint8Array(n);
    var strong = 0;
    var weak = 0;
    var stack = [];
    for (i = 0; i < n; i++) {
      if (!(nms[i] > 0)) continue;
      if (nms[i] >= hi) { cls[i] = 2; strong++; stack.push(i); }
      else if (nms[i] >= lo) { cls[i] = 1; weak++; }
    }

    // 6. Hysteresis: 0 none, 1 weak and dropped, 2 strong, 3 weak and kept.
    var out = new Uint8Array(cls);
    var kept = 0;
    while (stack.length) {
      i = stack.pop();
      x = i % N;
      y = (i / N) | 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx;
          var yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          var j = yy * N + xx;
          if (out[j] === 1) {
            out[j] = 3;
            kept++;
            stack.push(j);
          }
        }
      }
    }

    state.input = input;
    state.smooth = smooth;
    state.gx = gx;
    state.gy = gy;
    state.mag = mag;
    state.ang = ang;
    state.bin = bin;
    state.maxMag = maxMag;
    state.nms = nms;
    state.lo = lo;
    state.hi = hi;
    state.cls = cls;
    state.out = out;
    state.counts = {
      nms: nmsCount, strong: strong, weak: weak, kept: kept,
      dropped: weak - kept, final: strong + kept
    };
    state.images = {};
  }

  /** Start on a strong edge pixel near the centre, so the loupe has something to show. */
  function placeCursor() {
    var best = -1;
    var bestD = Infinity;
    for (var y = R; y < N - R; y++) {
      for (var x = R; x < N - R; x++) {
        if (state.out[y * N + x] !== 2) continue;
        var d = (x - N / 2) * (x - N / 2) + (y - N / 2) * (y - N / 2);
        if (d < bestD) { bestD = d; best = y * N + x; }
      }
    }
    if (best >= 0) {
      state.cx = best % N;
      state.cy = (best / N) | 0;
    }
  }

  // ----------------------------------------------------------- stage images
  function magGray(a) {
    var out = new Float32Array(N * N);
    if (state.maxMag > EPS) {
      for (var i = 0; i < N * N; i++) out[i] = 255 * Math.pow(a[i] / state.maxMag, 0.6);
    }
    return out;
  }

  function rgbaFrom(pick) {
    var out = new Uint8ClampedArray(N * N * 4);
    for (var i = 0, j = 0; i < N * N; i++, j += 4) {
      var c = pick(i);
      out[j] = c[0];
      out[j + 1] = c[1];
      out[j + 2] = c[2];
      out[j + 3] = 255;
    }
    return out;
  }

  function directionRGBA(a) {
    return rgbaFrom(function (i) {
      if (!(a[i] > EPS) || !(state.maxMag > EPS)) return C_NONE;
      var k = Math.pow(a[i] / state.maxMag, 0.6);   // same brightness curve as the gray view
      var c = DIR_RGB[state.bin[i]];
      return [
        C_NONE[0] + (c[0] - C_NONE[0]) * k,
        C_NONE[1] + (c[1] - C_NONE[1]) * k,
        C_NONE[2] + (c[2] - C_NONE[2]) * k
      ];
    });
  }

  function stageImage(id) {
    if (state.images[id]) return state.images[id];
    var img;
    switch (id) {
      case "input":
        img = { gray: state.input };
        break;
      case "smooth":
        img = { gray: state.smooth };
        break;
      case "gradient":
        img = state.colorDir ? { rgba: directionRGBA(state.mag) } : { gray: magGray(state.mag) };
        break;
      case "nms":
        img = state.colorDir ? { rgba: directionRGBA(state.nms) } : { gray: magGray(state.nms) };
        break;
      case "threshold":
        img = {
          rgba: rgbaFrom(function (i) {
            return state.cls[i] === 2 ? C_STRONG : state.cls[i] === 1 ? C_WEAK : C_NONE;
          })
        };
        break;
      case "hysteresis":
        img = {
          rgba: rgbaFrom(function (i) {
            var o = state.out[i];
            return o === 2 ? C_STRONG : o === 3 ? C_KEPT : o === 1 ? C_DROP : C_NONE;
          })
        };
        break;
      default:
        img = state.overlay
          ? {
            rgba: rgbaFrom(function (i) {
              var v = 0.45 * state.input[i] + 12;
              return state.out[i] >= 2 ? C_KEPT : [v, v, v];
            })
          }
          : { rgba: rgbaFrom(function (i) { return state.out[i] >= 2 ? C_STRONG : C_NONE; }) };
    }
    state.images[id] = img;
    return img;
  }

  function paint(canvas, img, scale) {
    return img.rgba
      ? Viz.paintRGBA(canvas, img.rgba, N, N, { scale: scale })
      : Viz.paintGray(canvas, img.gray, N, N, { scale: scale });
  }

  function colourAt(img, i) {
    if (img.rgba) return [img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]];
    var v = Viz.clamp(Math.round(img.gray[i]), 0, 255);
    return [v, v, v];
  }

  // --------------------------------------------------------------- drawing
  function fmt(v) {
    var r = Math.round(v);
    var s = Math.abs(v - r) < 0.05 ? String(r === 0 ? 0 : r) : v.toFixed(1);
    return s.replace("-", "−");
  }

  function css(c) { return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")"; }

  function swatch(c, label) {
    return '<span><i class="swatch" style="background: ' + css(c) + '"></i>' + label + "</span>";
  }

  function stageId() { return STAGES[state.stage].id; }

  function stageInfo(id) {
    var c = state.counts;
    switch (id) {
      case "input": return state.noise ? "noise σ = " + state.noise : "no noise";
      case "smooth": return state.sigma > 0 ? "σ = " + state.sigma.toFixed(1) : "off";
      case "gradient": return "max |G| = " + fmt(state.maxMag);
      case "nms": return c.nms + " px left";
      case "threshold": return "low " + fmt(state.lo) + " · high " + fmt(state.hi);
      case "hysteresis": return "kept " + c.kept + " · dropped " + c.dropped;
      default: return c.final + " edge px";
    }
  }

  function legend(id) {
    if ((id === "gradient" || id === "nms") && state.colorDir) {
      return DIR_RGB.map(function (c, k) { return swatch(c, DIR_LABEL[k]); }).join("") +
        "<span>brightness = |G|</span>";
    }
    if (id === "gradient" || id === "nms") return "<span>brightness = gradient magnitude |G|</span>";
    if (id === "threshold") {
      return swatch(C_STRONG, "strong: |G| ≥ high") + swatch(C_WEAK, "weak: low ≤ |G| &lt; high") +
        "<span>black: discarded</span>";
    }
    if (id === "hysteresis") {
      return swatch(C_STRONG, "strong") + swatch(C_KEPT, "weak, connected → kept") +
        swatch(C_DROP, "weak, isolated → dropped");
    }
    if (id === "result") {
      return swatch(state.overlay ? C_KEPT : C_STRONG, "edge");
    }
    return "";
  }

  /** Main view: cross-hair through the inspected pixel, a wash over the loupe region. */
  function paintBig() {
    var col = Viz.colors();
    var ctx = paint($("big"), stageImage(stageId()), BIG);
    var x0 = (state.cx - R) * BIG;
    var y0 = (state.cy - R) * BIG;
    var side = (2 * R + 1) * BIG;
    var mx = state.cx * BIG + BIG / 2;
    var my = state.cy * BIG + BIG / 2;
    var end = N * BIG;
    ctx.fillStyle = col.peach;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, my - 1, x0, 2);
    ctx.fillRect(x0 + side, my - 1, end - x0 - side, 2);
    ctx.fillRect(mx - 1, 0, 2, y0);
    ctx.fillRect(mx - 1, y0 + side, 2, end - y0 - side);
    ctx.globalAlpha = 0.2;
    ctx.fillRect(x0, y0, side, side);
    ctx.globalAlpha = 1;
    ctx.fillRect(state.cx * BIG, state.cy * BIG, BIG, BIG);
  }

  function drawLoupe(ctx, w, h, col) {
    var id = stageId();
    var img = stageImage(id);
    var cells = 2 * R + 1;
    var cs = w / cells;
    var fontPx = Math.max(8, Math.min(12, cs * 0.27));
    var i, j, x, y, idx;

    ctx.font = "500 " + fontPx + "px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    for (j = 0; j < cells; j++) {
      for (i = 0; i < cells; i++) {
        x = state.cx + i - R;
        y = state.cy + j - R;
        var px = i * cs;
        var py = j * cs;
        if (x < 0 || y < 0 || x >= N || y >= N) {
          ctx.fillStyle = col.line;
          ctx.fillRect(px, py, cs, cs);
          continue;
        }
        idx = y * N + x;
        var c = colourAt(img, idx);
        var ink = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 140 ? "#111" : "#fff";
        ctx.fillStyle = css(c);
        ctx.fillRect(px, py, cs + 0.5, cs + 0.5);

        var label = "";
        if (id === "input") label = String(Math.round(state.input[idx]));
        else if (id === "smooth") label = String(Math.round(state.smooth[idx]));
        else if (id === "gradient" || id === "nms") label = String(Math.round(state.mag[idx]));
        else if (id === "threshold" || id === "hysteresis") {
          label = state.nms[idx] > 0 ? String(Math.round(state.nms[idx])) : "";
        }

        // Stage 3: a small arrow for the gradient direction of every pixel.
        if (id === "gradient" && state.mag[idx] > 0.04 * state.maxMag) {
          var a = state.ang[idx];
          var len = cs * 0.26;
          var ax = px + cs / 2;
          var ay = py + cs * 0.36;
          ctx.strokeStyle = ink;
          ctx.fillStyle = ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ax - Math.cos(a) * len, ay - Math.sin(a) * len);
          ctx.lineTo(ax + Math.cos(a) * len, ay + Math.sin(a) * len);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ax + Math.cos(a) * (len + 2), ay + Math.sin(a) * (len + 2));
          ctx.lineTo(ax + Math.cos(a + 2.5) * 4.5 + Math.cos(a) * len * 0.5,
            ay + Math.sin(a + 2.5) * 4.5 + Math.sin(a) * len * 0.5);
          ctx.lineTo(ax + Math.cos(a - 2.5) * 4.5 + Math.cos(a) * len * 0.5,
            ay + Math.sin(a - 2.5) * 4.5 + Math.sin(a) * len * 0.5);
          ctx.closePath();
          ctx.fill();
        }

        if (label) {
          ctx.fillStyle = ink;
          ctx.fillText(label, px + cs / 2, py + (id === "gradient" ? cs * 0.88 : cs / 2 + fontPx * 0.36));
        }
      }
    }

    // Cell borders.
    ctx.strokeStyle = "rgba(128, 128, 128, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 1; i < cells; i++) {
      ctx.moveTo(i * cs, 0);
      ctx.lineTo(i * cs, h);
      ctx.moveTo(0, i * cs);
      ctx.lineTo(w, i * cs);
    }
    ctx.stroke();

    // Filled corner flags mark cells without hiding their colour: the inspected pixel,
    // and at stage 4 the two neighbours it is compared with.
    function flag(i, j, colour) {
      var k = cs * 0.34;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(i * cs, j * cs);
      ctx.lineTo(i * cs + k, j * cs);
      ctx.lineTo(i * cs, j * cs + k);
      ctx.closePath();
      ctx.fill();
    }

    var centre = state.cy * N + state.cx;
    if (id === "nms" && state.mag[centre] > EPS) {
      var d = DIRS[state.bin[centre]];
      ctx.strokeStyle = col.sky;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.7;
      // Shifted sideways so that it runs beside the numbers, not through them.
      var ox = 0.5 + d[1] * 0.36;
      var oy = 0.5 - d[0] * 0.36;
      ctx.beginPath();
      ctx.moveTo((R - d[0] + ox) * cs, (R - d[1] + oy) * cs);
      ctx.lineTo((R + d[0] + ox) * cs, (R + d[1] + oy) * cs);
      ctx.stroke();
      ctx.globalAlpha = 1;
      flag(R + d[0], R + d[1], col.sky);
      flag(R - d[0], R - d[1], col.sky);
    }
    flag(R, R, col.peach);
  }

  function pixelText() {
    var i = state.cy * N + state.cx;
    var id = stageId();
    var m = state.mag[i];
    var dirName = "<b>" + DIR_LABEL[state.bin[i]] + "</b>";
    switch (id) {
      case "input":
        return "intensity <b>" + Math.round(state.input[i]) + "</b>";
      case "smooth":
        return "intensity " + Math.round(state.input[i]) + " → <b>" + fmt(state.smooth[i]) +
          "</b> after smoothing";
      case "gradient":
        if (!(m > EPS)) return "G<sub>x</sub> = 0, G<sub>y</sub> = 0 — no change here";
        return "G<sub>x</sub> = " + fmt(state.gx[i]) + ", G<sub>y</sub> = " + fmt(state.gy[i]) +
          "<br>|G| = <b>" + fmt(m) + "</b>, θ = " + fmt(Math.round((state.ang[i] * 180) / Math.PI)) +
          "° → rounded to " + dirName;
      case "nms":
        if (!(m > EPS)) return "no gradient here — nothing to compare";
        var d = DIRS[state.bin[i]];
        var m1 = at(state.mag, state.cx + d[0], state.cy + d[1]);
        var m2 = at(state.mag, state.cx - d[0], state.cy - d[1]);
        return "|G| = <b>" + fmt(m) + "</b>, direction " + dirName +
          "<br>neighbours along it: " + fmt(m2) + " and " + fmt(m1) + "<br>" +
          (state.nms[i] > 0
            ? "<b>kept</b> — the largest of the three"
            : "<b>suppressed</b> — a neighbour is at least as large");
      case "threshold":
        if (!(state.nms[i] > 0)) return "already removed by non-maximum suppression";
        if (state.cls[i] === 2) return "|G| = " + fmt(m) + " ≥ high " + fmt(state.hi) + " → <b>strong</b>";
        if (state.cls[i] === 1) {
          return "low " + fmt(state.lo) + " ≤ |G| = " + fmt(m) + " &lt; high " + fmt(state.hi) +
            " → <b>weak</b>";
        }
        return "|G| = " + fmt(m) + " &lt; low " + fmt(state.lo) + " → <b>discarded</b>";
      case "hysteresis":
        if (state.out[i] === 2) return "<b>strong</b> — an edge by itself";
        if (state.out[i] === 3) return "weak, connected to a strong pixel → <b>kept</b>";
        if (state.out[i] === 1) return "weak, not connected to any strong pixel → <b>dropped</b>";
        return "not a candidate";
      default:
        return state.out[i] >= 2 ? "<b>edge</b>" : "not an edge";
    }
  }

  // ------------------------------------------------------------ rendering
  function renderCursor() {
    paintBig();
    loupe.redraw();
    $("loupe-pos").textContent = "pixel (" + state.cx + ", " + state.cy + ")";
    $("loupe-legend").innerHTML =
      '<span><i class="swatch" style="background: var(--peach)"></i>inspected pixel</span>' +
      (stageId() === "nms"
        ? '<span><i class="swatch" style="background: var(--sky)"></i>neighbours it is compared with</span>'
        : "");
    $("pixel").innerHTML = pixelText();
  }

  function renderFilm() {
    Array.prototype.forEach.call($("film").children, function (tile, k) {
      // Drawn at twice the size and scaled down smoothly, so one-pixel lines never drop out.
      paint(tile.querySelector("canvas"), stageImage(STAGES[k].id), 2);
      tile.classList.toggle("is-active", k === state.stage);
      tile.setAttribute("aria-pressed", String(k === state.stage));
    });
  }

  function renderCounts() {
    var c = state.counts;
    $("counts").innerHTML = "pixels after non-maximum suppression: <b>" + c.nms + "</b> · strong: <b>" +
      c.strong + "</b> · weak: <b>" + c.weak + "</b> (kept <b>" + c.kept + "</b>, dropped <b>" +
      c.dropped + "</b>) · final edge pixels: <b>" + c.final + "</b>";
  }

  function render() {
    var stage = STAGES[state.stage];
    $("stage-title").textContent = (state.stage + 1) + " · " + stage.title;
    $("stage-info").textContent = stageInfo(stage.id);
    $("stage-text").innerHTML = stage.text;
    $("legend").innerHTML = legend(stage.id);
    $("big").classList.toggle("has-legend", $("legend").innerHTML !== "");
    $("opt-dir").hidden = !(stage.id === "gradient" || stage.id === "nms");
    $("opt-overlay").hidden = stage.id !== "result";
    Array.prototype.forEach.call($("steps").children, function (b, k) {
      b.setAttribute("aria-pressed", String(k === state.stage));
    });
    $("prev").disabled = state.stage === 0;
    $("next").disabled = state.stage === STAGES.length - 1;
    renderFilm();
    renderCounts();
    renderCursor();
  }

  function recompute() {
    compute();
    render();
  }

  // ----------------------------------------------------------- interaction
  function setStage(k) {
    state.stage = Viz.clamp(k, 0, STAGES.length - 1);
    render();
  }

  function syncLabels() {
    $("o-noise").textContent = state.noise ? "σ = " + state.noise : "none";
    $("o-sigma").textContent = state.sigma > 0 ? state.sigma.toFixed(1) : "off";
    $("o-low").textContent = state.low + "% of max |G|";
    $("o-high").textContent = state.high + "% of max |G|";
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

    STAGES.forEach(function (stage, k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.dataset.stage = String(k);
      b.textContent = (k + 1) + " " + stage.short;
      $("steps").appendChild(b);

      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.stage = String(k);
      var cap = document.createElement("span");
      cap.className = "tile-cap";
      cap.textContent = (k + 1) + " " + stage.short;
      tile.appendChild(cap);
      tile.appendChild(document.createElement("canvas"));
      $("film").appendChild(tile);
    });

    $("steps").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-stage]");
      if (b) setStage(parseInt(b.dataset.stage, 10));
    });
    $("film").addEventListener("click", function (ev) {
      var tile = ev.target.closest("button[data-stage]");
      if (tile) setStage(parseInt(tile.dataset.stage, 10));
    });
    $("prev").addEventListener("click", function () { setStage(state.stage - 1); });
    $("next").addEventListener("click", function () { setStage(state.stage + 1); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      ev.preventDefault();
      setStage(state.stage + (ev.key === "ArrowRight" ? 1 : -1));
    });

    $("noise").addEventListener("input", function () {
      state.noise = parseFloat($("noise").value);
      syncLabels();
      recompute();
    });
    $("sigma").addEventListener("input", function () {
      state.sigma = parseFloat($("sigma").value);
      syncLabels();
      recompute();
    });
    // The low threshold can never exceed the high one: moving either drags the other along.
    $("low").addEventListener("input", function () {
      state.low = parseFloat($("low").value);
      if (state.low > state.high) {
        state.high = state.low;
        $("high").value = state.high;
      }
      syncLabels();
      recompute();
    });
    $("high").addEventListener("input", function () {
      state.high = parseFloat($("high").value);
      if (state.high < state.low) {
        state.low = state.high;
        $("low").value = state.low;
      }
      syncLabels();
      recompute();
    });
    $("dir").addEventListener("change", function () {
      state.colorDir = $("dir").checked;
      state.images = {};
      render();
    });
    $("overlay").addEventListener("change", function () {
      state.overlay = $("overlay").checked;
      state.images = {};
      render();
    });

    function move(ev) {
      var rect = $("big").getBoundingClientRect();
      var x = Math.floor(((ev.clientX - rect.left) / rect.width) * N);
      var y = Math.floor(((ev.clientY - rect.top) / rect.height) * N);
      if (x < 0 || y < 0 || x >= N || y >= N) return;
      if (x === state.cx && y === state.cy) return;
      state.cx = x;
      state.cy = y;
      renderCursor();
    }
    $("big").addEventListener("pointermove", move);
    $("big").addEventListener("pointerdown", move);

    syncLabels();
    compute();
    placeCursor();
    loupe = Viz.autoCanvas($("loupe"), { aspect: 1, draw: drawLoupe });
    Viz.onTheme(paintBig);
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
