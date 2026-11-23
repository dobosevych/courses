/* Histogram: point operations, contrast stretching, histogram equalization. */
(function () {
  "use strict";

  var SIZE = 192;   // image side in pixels
  var SCALE = 2;    // on-screen enlargement
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    src: null,          // clean sample image
    input: null,        // after the chosen exposure problem
    output: null,       // after the point operation
    lut: new Float32Array(256),
    histIn: null,
    histOut: null,
    mode: "equalize",
    start: "low",
    brightness: 0,
    contrast: 1,
    gamma: 1,
    clip: 1,
    lo: 0,
    hi: 255,
    probe: null         // { r, s } of the pixel under the cursor
  };

  // ------------------------------------------------------------- processing
  function degrade(data, kind) {
    var out = new Float32Array(data.length);
    for (var i = 0; i < data.length; i++) {
      var v = data[i] / 255;
      if (kind === "low") v = 0.38 + (v - 0.5) * 0.34;
      else if (kind === "dark") v = 0.62 * Math.pow(v, 1.9);
      else if (kind === "bright") v = 1 - 0.6 * Math.pow(1 - v, 1.7);
      out[i] = Math.round(Viz.clamp(v, 0, 1) * 255);
    }
    return out;
  }

  function histogram(data) {
    var h = new Uint32Array(256);
    for (var i = 0; i < data.length; i++) h[Viz.clamp(Math.round(data[i]), 0, 255)]++;
    return h;
  }

  function cdf(hist) {
    var out = new Float32Array(256);
    var total = 0;
    var i;
    for (i = 0; i < 256; i++) total += hist[i];
    var acc = 0;
    for (i = 0; i < 256; i++) {
      acc += hist[i];
      out[i] = acc / total;
    }
    return out;
  }

  /** Intensity below which `fraction` of the pixels lie. */
  function percentile(c, fraction) {
    for (var i = 0; i < 256; i++) if (c[i] >= fraction) return i;
    return 255;
  }

  function buildLut() {
    var c = cdf(state.histIn);
    var r;
    if (state.mode === "manual") {
      for (r = 0; r < 256; r++) {
        var v = ((r - 128) * state.contrast + 128 + state.brightness) / 255;
        state.lut[r] = 255 * Math.pow(Viz.clamp(v, 0, 1), state.gamma);
      }
    } else if (state.mode === "stretch") {
      var p = state.clip / 100;
      var lo = percentile(c, p > 0 ? p : 1e-9);
      var hi = percentile(c, 1 - p);
      if (hi <= lo) hi = lo + 1;
      state.lo = lo;
      state.hi = hi;
      for (r = 0; r < 256; r++) state.lut[r] = 255 * Viz.clamp((r - lo) / (hi - lo), 0, 1);
    } else {
      var first = 0;
      while (first < 255 && state.histIn[first] === 0) first++;
      var cmin = c[first];
      for (r = 0; r < 256; r++) {
        state.lut[r] = cmin < 1 ? 255 * Viz.clamp((c[r] - cmin) / (1 - cmin), 0, 1) : r;
      }
    }
  }

  function stats(data) {
    var n = data.length;
    var sum = 0;
    var min = 255;
    var max = 0;
    var i;
    for (i = 0; i < n; i++) {
      sum += data[i];
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    var mean = sum / n;
    var sq = 0;
    for (i = 0; i < n; i++) sq += (data[i] - mean) * (data[i] - mean);
    return { mean: mean, std: Math.sqrt(sq / n), min: min, max: max };
  }

  function compute() {
    state.input = degrade(state.src.data, state.start);
    state.histIn = histogram(state.input);
    buildLut();
    state.output = new Float32Array(state.input.length);
    for (var i = 0; i < state.input.length; i++) {
      state.output[i] = Math.round(state.lut[state.input[i]]);
    }
    state.histOut = histogram(state.output);
  }

  function recompute() {
    compute();
    render();
  }

  // --------------------------------------------------------------- drawing
  function statText(data) {
    var s = stats(data);
    return "range " + s.min + "–" + s.max + " · mean " + s.mean.toFixed(0) + " · σ " + s.std.toFixed(0);
  }

  function drawHistogram(hist, probe) {
    return function (ctx, w, h, col) {
      var padL = 6, padR = 6, padT = 6, strip = 8, axis = 16;
      var plotW = w - padL - padR;
      var plotH = h - padT - strip - axis - 4;
      var base = padT + plotH;
      var i;

      // Robust vertical scale: one huge spike (e.g. clipped pixels) must not flatten the rest.
      var sorted = Array.prototype.slice.call(hist).sort(function (a, b) { return a - b; });
      var top = Math.max(sorted[Math.floor(0.98 * 255)] * 1.25, sorted[255] * 0.25, 1);

      ctx.fillStyle = col.accent;
      var bw = plotW / 256;
      for (i = 0; i < 256; i++) {
        var bh = Math.min(1, hist[i] / top) * plotH;
        if (bh > 0) ctx.fillRect(padL + i * bw, base - bh, Math.max(bw, 1), bh);
      }

      var c = cdf(hist);
      ctx.strokeStyle = col.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (i = 0; i < 256; i++) {
        var x = padL + (i + 0.5) * bw;
        var y = base - c[i] * plotH;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();

      if (probe !== null) {
        ctx.strokeStyle = col.peach;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padL + (probe + 0.5) * bw, padT);
        ctx.lineTo(padL + (probe + 0.5) * bw, base);
        ctx.stroke();
      }

      // Intensity strip: what the horizontal axis means.
      var grad = ctx.createLinearGradient(padL, 0, padL + plotW, 0);
      grad.addColorStop(0, "#000");
      grad.addColorStop(1, "#fff");
      ctx.fillStyle = grad;
      ctx.fillRect(padL, base + 3, plotW, strip);
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(padL + 0.5, base + 3.5, plotW - 1, strip - 1);

      ctx.fillStyle = col.muted;
      ctx.font = "11px " + "JetBrains Mono, monospace";
      ctx.textBaseline = "top";
      [0, 64, 128, 192, 255].forEach(function (t) {
        ctx.textAlign = t === 0 ? "left" : t === 255 ? "right" : "center";
        ctx.fillText(String(t), padL + (t / 255) * plotW, base + strip + 6);
      });
    };
  }

  function drawTransfer(ctx, w, h, col) {
    var pad = 22;
    var size = Math.min(w, h) - pad - 8;
    var x0 = pad + (w - pad - 8 - size) / 2;
    var y0 = 6;
    var X = function (r) { return x0 + (r / 255) * size; };
    var Y = function (s) { return y0 + size - (s / 255) * size; };
    var i;

    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i <= 4; i++) {
      var t = (i / 4) * 255;
      ctx.moveTo(X(t), Y(0));
      ctx.lineTo(X(t), Y(255));
      ctx.moveTo(X(0), Y(t));
      ctx.lineTo(X(255), Y(t));
    }
    ctx.stroke();

    // Identity: output equals input.
    ctx.strokeStyle = col.faint;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(255), Y(255));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (i = 0; i < 256; i++) {
      if (i) ctx.lineTo(X(i), Y(state.lut[i])); else ctx.moveTo(X(i), Y(state.lut[i]));
    }
    ctx.stroke();

    if (state.probe) {
      ctx.strokeStyle = col.peach;
      ctx.fillStyle = col.peach;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(state.probe.r), Y(0));
      ctx.lineTo(X(state.probe.r), Y(state.probe.s));
      ctx.lineTo(X(0), Y(state.probe.s));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(state.probe.r), Y(state.probe.s), 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.fillStyle = col.muted;
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText("input r", X(128), Y(0) + 5);
    ctx.save();
    ctx.translate(x0 - 16, Y(128));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("output s", 0, 0);
    ctx.restore();
  }

  var plots = {};

  function render() {
    Viz.paintGray($("cIn"), state.input, SIZE, SIZE, { scale: SCALE });
    Viz.paintGray($("cOut"), state.output, SIZE, SIZE, { scale: SCALE });
    $("s-in").textContent = statText(state.input);
    $("s-out").textContent = statText(state.output);
    renderPlots();
    renderFormula();
  }

  function renderPlots() {
    plots.t.redraw();
    plots.hIn.redraw();
    plots.hOut.redraw();
  }

  function renderFormula() {
    var text;
    if (state.mode === "manual") {
      text = "<b>s</b> = 255 · clip((c·(r − 128) + 128 + b) / 255)<sup>γ</sup>" +
        " &nbsp; with c = " + state.contrast.toFixed(2) + ", b = " + state.brightness +
        ", γ = " + state.gamma.toFixed(2);
    } else if (state.mode === "stretch") {
      text = "<b>s</b> = 255 · (r − r<sub>min</sub>) / (r<sub>max</sub> − r<sub>min</sub>)" +
        " &nbsp; with r<sub>min</sub> = " + state.lo + ", r<sub>max</sub> = " + state.hi +
        " (" + state.clip.toFixed(1) + "% of pixels clipped at each end)";
    } else {
      text = "<b>s</b> = 255 · CDF(r) &nbsp; — the transfer function is the input's cumulative " +
        "distribution, so the output CDF becomes (almost) a straight line";
    }
    if (state.probe) {
      text += "<br>pixel under the cursor: r = " + state.probe.r + " → s = " + state.probe.s;
    }
    $("formula").innerHTML = text;
  }

  // ------------------------------------------------------------ interaction
  function setMode(mode) {
    state.mode = mode;
    Array.prototype.forEach.call($("mode").children, function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });
    $("row-manual").hidden = mode !== "manual";
    $("row-stretch").hidden = mode !== "stretch";
  }

  function syncLabels() {
    $("o-brightness").textContent = (state.brightness > 0 ? "+" : "") + state.brightness;
    $("o-contrast").textContent = "×" + state.contrast.toFixed(2);
    $("o-gamma").textContent = state.gamma.toFixed(2);
    $("o-clip").textContent = state.clip.toFixed(1) + "%";
  }

  function bindSlider(id, key) {
    $(id).addEventListener("input", function () {
      state[key] = parseFloat($(id).value);
      syncLabels();
      recompute();
    });
  }

  function probeFrom(canvas) {
    function move(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = Math.floor(((ev.clientX - rect.left) / rect.width) * SIZE);
      var y = Math.floor(((ev.clientY - rect.top) / rect.height) * SIZE);
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
      var r = state.input[y * SIZE + x];
      state.probe = { r: r, s: Math.round(state.lut[r]) };
      renderPlots();
      renderFormula();
    }
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", move);
    canvas.addEventListener("pointerleave", function () {
      state.probe = null;
      renderPlots();
      renderFormula();
    });
  }

  function init() {
    var picker = Viz.imagePicker($("picker"), {
      samples: ["scene", "coins", "shapes", "text"],
      size: SIZE,
      value: "scene",
      onChange: function (img) {
        state.src = img;
        recompute();
      }
    });
    state.src = picker.image();
    compute();

    plots.t = Viz.autoCanvas($("cT"), { aspect: 1, draw: drawTransfer });
    plots.hIn = Viz.autoCanvas($("hIn"), {
      aspect: 0.42,
      draw: function (ctx, w, h, col) {
        drawHistogram(state.histIn, state.probe ? state.probe.r : null)(ctx, w, h, col);
      }
    });
    plots.hOut = Viz.autoCanvas($("hOut"), {
      aspect: 0.42,
      draw: function (ctx, w, h, col) {
        drawHistogram(state.histOut, state.probe ? state.probe.s : null)(ctx, w, h, col);
      }
    });

    $("start").addEventListener("change", function () {
      state.start = $("start").value;
      recompute();
    });
    $("mode").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-mode]");
      if (!b) return;
      setMode(b.dataset.mode);
      recompute();
    });
    bindSlider("brightness", "brightness");
    bindSlider("contrast", "contrast");
    bindSlider("gamma", "gamma");
    bindSlider("clip", "clip");
    $("reset").addEventListener("click", function () {
      state.brightness = 0;
      state.contrast = 1;
      state.gamma = 1;
      $("brightness").value = 0;
      $("contrast").value = 1;
      $("gamma").value = 1;
      syncLabels();
      recompute();
    });
    probeFrom($("cIn"));
    probeFrom($("cOut"));

    setMode(state.mode);
    syncLabels();
    recompute();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
