/* Test-time augmentation: train a small classifier in the browser, then measure what
   averaging predictions over transformed copies of each test image does to accuracy. */
(function () {
  "use strict";

  var T = window.TTACore;
  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;

  var EPOCHS = 40;
  var HIDDEN = 32;
  var TEST = 600;
  var SUBSETS = 24;                 // random view subsets per point of the curve
  var SYMBOL = ["○", "□", "△", "◇", "+", "×"];

  var state = {
    seed: 8,            // a draw whose gain is close to the average over many draws
    train: 400,
    noise: 0.25,
    augment: false,
    mode: "mean",
    groups: { flip: true, shift: true, rotate: true, scale: true },
    runId: 0,
    model: null,
    testSet: null,
    probs: null,        // probs[view] = Float32Array(TEST * C), for every view in T.VIEWS
    enabled: [0],       // indices into T.VIEWS used at test time
    predSingle: null,
    predTTA: null,
    lists: { fixed: [], broken: [] },
    cursor: { fixed: 0, broken: 0 },
    sel: 0,
    curve: [],
    accSingle: 0,
    accTTA: 0,
    trainAcc: 0,
    trainMs: 0
  };

  var chart = null;

  function pct(v, digits) { return (100 * v).toFixed(digits === undefined ? 1 : digits) + "%"; }
  function className(c) { return SYMBOL[c] + " " + T.CLASSES[c]; }

  // --------------------------------------------------------------- training
  function train() {
    var run = ++state.runId;
    var cfg = { noise: state.noise, shift: 2, rot: 12 * DEG, scaleLo: 0.82, scaleHi: 1.15 };
    var base = state.seed * 1000;
    var trainSet = T.makeSet(base + 1, state.train, cfg);
    var testSet = T.makeSet(base + 2, TEST, cfg);
    var model = T.createModel(base + 3, HIDDEN);
    var trainer = T.createTrainer(model, trainSet, {
      lr: 0.003, batch: 32, augment: state.augment, seed: base + 4
    });
    var done = 0;
    var spent = 0;

    function tick() {
      if (run !== state.runId) return;          // a newer run has started
      var t0 = performance.now();
      do {
        trainer.epoch();
        done++;
      } while (done < EPOCHS && performance.now() - t0 < 30);
      spent += performance.now() - t0;
      $("progress").style.width = (100 * done / EPOCHS) + "%";
      $("status").textContent = "Training in your browser… epoch " + done + " of " + EPOCHS;
      if (done < EPOCHS) {
        setTimeout(tick, 0);
        return;
      }
      state.model = model;
      state.testSet = testSet;
      state.trainMs = spent;
      state.probs = T.predictViews(model, testSet, T.VIEWS);
      var trainProbs = T.predictViews(model, trainSet, [T.VIEWS[0]]);
      state.trainAcc = T.accuracy(T.predictSet(trainProbs, [0], trainSet.count, "mean"), trainSet.y);
      $("status").textContent = "Network 256 → " + HIDDEN + " → 6, trained on " + state.train +
        " images for " + EPOCHS + " epochs in " + (spent / 1000).toFixed(2) + " s" +
        (state.augment ? ", with random flips, shifts, rotations and scaling." : ", without augmentation.");
      $("progress").parentElement.style.visibility = "hidden";
      state.cursor.fixed = state.cursor.broken = 0;
      evaluate();
      pick(state.lists.fixed.length ? "fixed" : "random");
    }

    $("progress").style.width = "0%";
    $("progress").parentElement.style.visibility = "visible";
    setTimeout(tick, 0);
  }

  // ------------------------------------------------------------- evaluation
  function enabledViews() {
    var g = state.groups;
    var out = [];
    T.VIEWS.forEach(function (v, i) {
      var on = v.group === "orig" || g[v.group] === true ||
        (v.group === "fliprot" && g.flip && g.rotate);
      if (on) out.push(i);
    });
    return out;
  }

  function evaluate() {
    if (!state.probs) return;
    var y = state.testSet.y;
    var E = state.enabled = enabledViews();
    state.predSingle = T.predictSet(state.probs, [0], TEST, state.mode);
    state.predTTA = T.predictSet(state.probs, E, TEST, state.mode);
    state.accSingle = T.accuracy(state.predSingle, y);
    state.accTTA = T.accuracy(state.predTTA, y);

    var fixed = [], broken = [], right = 0, wrong = 0;
    for (var k = 0; k < TEST; k++) {
      var a = state.predSingle[k] === y[k];
      var b = state.predTTA[k] === y[k];
      if (!a && b) fixed.push(k);
      else if (a && !b) broken.push(k);
      else if (a) right++;
      else wrong++;
    }
    state.lists = { fixed: fixed, broken: broken };

    // Accuracy as a function of how many views are averaged. The original image is
    // always included; the others are drawn at random from the enabled views.
    var rand = T.rng(12345);
    var others = E.slice(1);
    state.curve = [];
    for (var n = 1; n <= E.length; n++) {
      var accs = [];
      var trials = (n === 1 || n === E.length) ? 1 : SUBSETS;
      for (var t = 0; t < trials; t++) {
        var pool = others.slice();
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(rand() * (i + 1));
          var tmp = pool[i];
          pool[i] = pool[j];
          pool[j] = tmp;
        }
        var subset = [0].concat(pool.slice(0, n - 1));
        accs.push(T.accuracy(T.predictSet(state.probs, subset, TEST, state.mode), y));
      }
      var sum = accs.reduce(function (p, c) { return p + c; }, 0);
      state.curve.push({
        n: n,
        mean: sum / accs.length,
        min: Math.min.apply(null, accs),
        max: Math.max.apply(null, accs)
      });
    }

    renderSet(right, wrong);
    renderSample();
  }

  // ----------------------------------------------------------------- render
  function renderSet(right, wrong) {
    var E = state.enabled;
    var gain = (state.accTTA - state.accSingle) * 100;
    $("acc1").textContent = pct(state.accSingle);
    $("accN").textContent = pct(state.accTTA);
    $("accN-label").textContent = "TTA · " + E.length + (E.length === 1 ? " view" : " views");
    $("gain").textContent = (gain >= 0 ? "+" : "−") + Math.abs(gain).toFixed(1) + " pp";
    $("gain-box").classList.toggle("neg", gain < 0);
    $("n-fixed").textContent = state.lists.fixed.length;
    $("n-broken").textContent = state.lists.broken.length;
    $("n-right").textContent = right;
    $("n-wrong").textContent = wrong;
    $("n-train").textContent = pct(state.trainAcc);
    $("n-cost").textContent = E.length + "× forward passes";
    $("pick-fixed").disabled = !state.lists.fixed.length;
    $("pick-broken").disabled = !state.lists.broken.length;
    if (chart) chart.redraw();
  }

  function drawChart(ctx, w, h, col) {
    var curve = state.curve;
    if (!curve.length) return;
    var L = 46, R = 14, Tp = 12, B = 34;
    var pw = w - L - R, ph = h - Tp - B;
    var lo = Infinity, hi = -Infinity;
    curve.forEach(function (p) {
      lo = Math.min(lo, p.min);
      hi = Math.max(hi, p.max);
    });
    lo = Math.floor((lo * 100 - 1.5) / 2) * 2;
    hi = Math.ceil((hi * 100 + 1.5) / 2) * 2;
    if (hi - lo < 6) hi = lo + 6;
    var K = curve.length;
    var X = function (n) { return K === 1 ? L + pw / 2 : L + ((n - 1) / (K - 1)) * pw; };
    var Y = function (a) { return Tp + ph - ((a * 100 - lo) / (hi - lo)) * ph; };
    var i;

    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    var stepY = (hi - lo) <= 10 ? 2 : (hi - lo) <= 24 ? 4 : 10;
    for (var v = lo; v <= hi + 1e-9; v += stepY) {
      var yy = Y(v / 100);
      ctx.strokeStyle = col.line;
      ctx.beginPath();
      ctx.moveTo(L, yy);
      ctx.lineTo(L + pw, yy);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(v + "%", L - 6, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (i = 1; i <= K; i++) ctx.fillText(String(i), X(i), Tp + ph + 6);
    ctx.fillText("views averaged", L + pw / 2, Tp + ph + 20);

    // Single-view accuracy as the reference line.
    ctx.strokeStyle = col.faint;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(L, Y(curve[0].mean));
    ctx.lineTo(L + pw, Y(curve[0].mean));
    ctx.stroke();
    ctx.setLineDash([]);

    if (K > 1) {
      ctx.fillStyle = col.accent;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      for (i = 0; i < K; i++) ctx.lineTo(X(curve[i].n), Y(curve[i].max));
      for (i = K - 1; i >= 0; i--) ctx.lineTo(X(curve[i].n), Y(curve[i].min));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (i = 0; i < K; i++) {
        if (i) ctx.lineTo(X(curve[i].n), Y(curve[i].mean));
        else ctx.moveTo(X(curve[i].n), Y(curve[i].mean));
      }
      ctx.stroke();
    }
    ctx.fillStyle = col.accent;
    for (i = 0; i < K; i++) {
      ctx.beginPath();
      ctx.arc(X(curve[i].n), Y(curve[i].mean), 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function grayCanvas(data, off) {
    var c = document.createElement("canvas");
    var px = new Float32Array(T.D);
    for (var i = 0; i < T.D; i++) px[i] = data[off + i] * 255;
    Viz.paintGray(c, px, T.N, T.N, { scale: 5 });
    return c;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderSample() {
    if (!state.probs) return;
    var k = state.sel;
    var y = state.testSet.y[k];
    var E = state.enabled;
    var C = T.C;
    var box = $("views");
    box.textContent = "";
    var buf = new Float32Array(T.D);
    var votes = 0;

    E.forEach(function (vi) {
      var view = T.VIEWS[vi];
      var P = state.probs[vi];
      var best = 0;
      for (var c = 1; c < C; c++) if (P[k * C + c] > P[k * C + best]) best = c;
      if (best === y) votes++;
      var tile = el("div", "tile " + (best === y ? "ok" : "bad"));
      if (vi === 0) tile.appendChild(grayCanvas(state.testSet.x, k * T.D));
      else {
        T.warp(state.testSet.x, k * T.D, view, buf);
        tile.appendChild(grayCanvas(buf, 0));
      }
      tile.appendChild(el("div", "t", view.label));
      tile.appendChild(el("div", "p", className(best) + " " + pct(P[k * C + best], 0)));
      box.appendChild(tile);
    });

    var combined = new Float32Array(C);
    var predTTA = T.combine(state.probs, E, k, state.mode, combined);
    var single = new Float32Array(C);
    var predSingle = T.combine(state.probs, [0], k, "mean", single);

    var sum = el("div", "tile " + (predTTA === y ? "ok" : "bad"));
    sum.appendChild(el("div", "sym", SYMBOL[predTTA]));
    sum.appendChild(el("div", "t", "combined"));
    sum.appendChild(el("div", "p", className(predTTA) + " " + pct(combined[predTTA], 0)));
    box.appendChild(sum);

    var bars = $("bars");
    bars.textContent = "";
    bars.appendChild(el("span", "h", ""));
    bars.appendChild(el("span", "h", "original only"));
    bars.appendChild(el("span", "h", state.mode === "vote" ? "share of votes" : "combined"));
    for (var c = 0; c < C; c++) {
      bars.appendChild(el("span", "cls" + (c === y ? " true" : ""), className(c) + (c === y ? " ✓" : "")));
      [[single, predSingle, "bar"], [combined, predTTA, "bar tta"]].forEach(function (col) {
        var bar = el("span", col[2] + (col[1] === c ? " win" + (c === y ? "" : " wrong") : ""));
        var fill = el("i");
        fill.style.width = (100 * col[0][c]).toFixed(1) + "%";
        bar.appendChild(fill);
        bar.appendChild(el("b", "", pct(col[0][c], 0)));
        bars.appendChild(bar);
      });
    }

    var a = predSingle === y;
    var b = predTTA === y;
    var text = "Test image #" + (k + 1) + " is a <b>" + className(y) + "</b>. ";
    text += "On the original image the model says " + className(predSingle) +
      " (" + pct(single[predSingle], 0) + ") — " + (a ? "correct" : "wrong") + ". ";
    text += votes + " of " + E.length + " views vote for the true class; combined, the answer is " +
      className(predTTA) + " (" + pct(combined[predTTA], 0) + ") — " + (b ? "correct" : "wrong") + ". ";
    if (!a && b) text += "<b>TTA fixed this one</b>: the mistake on the original view is outvoted by the other views.";
    else if (a && !b) text += "<b>TTA broke this one</b>: the original view was right, but most transformed views push towards another class.";
    else if (a) text += "Both agree; TTA usually changes the confidence more than the answer.";
    else text += "Both are wrong: when every view is fooled the same way, averaging cannot help.";
    $("verdict").innerHTML = text;
    $("pick-info").textContent = "showing test image " + (k + 1) + " of " + TEST;
  }

  // ------------------------------------------------------------ interaction
  function pick(kind) {
    if (kind === "random") {
      state.sel = Math.floor(Math.random() * TEST);
    } else {
      var list = state.lists[kind];
      if (!list.length) return;
      state.sel = list[state.cursor[kind] % list.length];
      state.cursor[kind]++;
    }
    renderSample();
  }

  function syncLabels() {
    $("o-train").textContent = state.train;
    $("o-noise").textContent = state.noise.toFixed(2);
  }

  function init() {
    chart = Viz.autoCanvas($("chart"), { aspect: 0.56, draw: drawChart });

    $("train").addEventListener("input", function () {
      state.train = parseInt($("train").value, 10);
      syncLabels();
    });
    $("noise").addEventListener("input", function () {
      state.noise = parseFloat($("noise").value);
      syncLabels();
    });
    $("train").addEventListener("change", train);
    $("noise").addEventListener("change", train);
    $("augment").addEventListener("change", function () {
      state.augment = $("augment").checked;
      train();
    });
    $("retrain").addEventListener("click", function () {
      state.seed++;
      train();
    });
    Array.prototype.forEach.call(document.querySelectorAll("input[data-group]"), function (box) {
      box.addEventListener("change", function () {
        state.groups[box.dataset.group] = box.checked;
        state.cursor.fixed = state.cursor.broken = 0;
        evaluate();
      });
    });
    $("mode").addEventListener("change", function () {
      state.mode = $("mode").value;
      state.cursor.fixed = state.cursor.broken = 0;
      evaluate();
    });
    $("pick-fixed").addEventListener("click", function () { pick("fixed"); });
    $("pick-broken").addEventListener("click", function () { pick("broken"); });
    $("pick-random").addEventListener("click", function () { pick("random"); });

    syncLabels();
    train();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
