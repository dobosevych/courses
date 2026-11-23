/* Test-time augmentation — data, model and evaluation (no DOM, also runs in Node).

   A small multilayer perceptron is trained on noisy 16×16 images of six shapes.
   At test time each image is transformed in several label-preserving ways, the
   model predicts on every view, and the predictions are averaged. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TTACore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var N = 16;                 // image side
  var D = N * N;              // inputs
  var CLASSES = ["ring", "square", "triangle", "diamond", "plus", "cross"];
  var C = CLASSES.length;

  // ---------------------------------------------------------------- random
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

  function gauss(rand) {
    var u = 1 - rand();
    var v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function uniform(rand, lo, hi) { return lo + (hi - lo) * rand(); }

  // ---------------------------------------------------------------- shapes
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var t = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var dx = px - (ax + t * vx), dy = py - (ay + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function boxOutline(x, y, h) {
    var qx = Math.abs(x) - h, qy = Math.abs(y) - h;
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.abs(Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0));
  }

  var S2 = Math.SQRT1_2;

  /** Distance from (x, y) to the centre line of the stroke of shape `cls` with radius R. */
  function shapeDist(cls, x, y, R) {
    var u, v;
    switch (cls) {
      case 0: return Math.abs(Math.sqrt(x * x + y * y) - R);
      case 1: return boxOutline(x, y, R * 0.86);
      case 2:
        return Math.min(
          segDist(x, y, 0, -R, R * 0.92, R * 0.72),
          segDist(x, y, R * 0.92, R * 0.72, -R * 0.92, R * 0.72),
          segDist(x, y, -R * 0.92, R * 0.72, 0, -R)
        );
      case 3:
        u = (x + y) * S2;
        v = (x - y) * S2;
        return boxOutline(u, v, R * 0.74);
      case 4:
        return Math.min(segDist(x, y, -R, 0, R, 0), segDist(x, y, 0, -R, 0, R));
      default:
        u = (x + y) * S2;
        v = (x - y) * S2;
        return Math.min(segDist(u, v, -R, 0, R, 0), segDist(u, v, 0, -R, 0, R));
    }
  }

  /** Clean image of a shape under pose p = { dx, dy, angle, scale, thick, bright }. */
  function render(cls, p) {
    var out = new Float32Array(D);
    var ca = Math.cos(-p.angle), sa = Math.sin(-p.angle);
    var R = 5.2;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var x = i + 0.5 - N / 2 - p.dx;
        var y = j + 0.5 - N / 2 - p.dy;
        var xr = (ca * x - sa * y) / p.scale;
        var yr = (sa * x + ca * y) / p.scale;
        var d = shapeDist(cls, xr, yr, R) * p.scale;
        var val = p.thick / 2 + 0.5 - d;
        out[j * N + i] = (val < 0 ? 0 : val > 1 ? 1 : val) * p.bright;
      }
    }
    return out;
  }

  /**
   * A labelled set of `count` noisy images.
   * cfg: { noise, shift, rot (radians), scaleLo, scaleHi }.
   */
  function makeSet(seed, count, cfg) {
    var rand = rng(seed);
    var x = new Float32Array(count * D);
    var y = new Uint8Array(count);
    for (var k = 0; k < count; k++) {
      var cls = k % C;
      var img = render(cls, {
        dx: uniform(rand, -cfg.shift, cfg.shift),
        dy: uniform(rand, -cfg.shift, cfg.shift),
        angle: uniform(rand, -cfg.rot, cfg.rot),
        scale: uniform(rand, cfg.scaleLo, cfg.scaleHi),
        thick: uniform(rand, 1.2, 2.0),
        bright: uniform(rand, 0.65, 1)
      });
      for (var i = 0; i < D; i++) {
        var v = img[i] + gauss(rand) * cfg.noise;
        x[k * D + i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      y[k] = cls;
    }
    return { x: x, y: y, count: count };
  }

  // ----------------------------------------------------------- augmentation
  /**
   * Transform an image: view = { flip, dx, dy, angle, scale }.
   * Bilinear resampling about the image centre, zero outside.
   */
  function warp(src, off, view, out) {
    out = out || new Float32Array(D);
    var s = view.scale || 1;
    var a = view.angle || 0;
    var ca = Math.cos(-a), sa = Math.sin(-a);
    var dx = view.dx || 0, dy = view.dy || 0;
    var half = N / 2;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var x = i + 0.5 - half - dx;
        var y = j + 0.5 - half - dy;
        var xs = (ca * x - sa * y) / s;
        var ys = (sa * x + ca * y) / s;
        if (view.flip) xs = -xs;
        var fx = xs + half - 0.5;
        var fy = ys + half - 0.5;
        var x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = fx - x0, ty = fy - y0;
        var acc = 0;
        for (var yy = 0; yy < 2; yy++) {
          var py = y0 + yy;
          if (py < 0 || py >= N) continue;
          for (var xx = 0; xx < 2; xx++) {
            var px = x0 + xx;
            if (px < 0 || px >= N) continue;
            acc += src[off + py * N + px] * (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty);
          }
        }
        out[j * N + i] = acc;
      }
    }
    return out;
  }

  var DEG = Math.PI / 180;

  /** Label-preserving views used for test-time augmentation. The first one is the original. */
  var VIEWS = [
    { id: "orig", group: "orig", label: "original" },
    { id: "flip", group: "flip", label: "flip", flip: true },
    { id: "sl", group: "shift", label: "shift ←1", dx: -1 },
    { id: "sr", group: "shift", label: "shift →1", dx: 1 },
    { id: "su", group: "shift", label: "shift ↑1", dy: -1 },
    { id: "sd", group: "shift", label: "shift ↓1", dy: 1 },
    { id: "r-", group: "rotate", label: "rotate −8°", angle: -8 * DEG },
    { id: "r+", group: "rotate", label: "rotate +8°", angle: 8 * DEG },
    { id: "z-", group: "scale", label: "scale 0.9×", scale: 0.9 },
    { id: "z+", group: "scale", label: "scale 1.1×", scale: 1.1 },
    { id: "fr-", group: "fliprot", label: "flip + rot −8°", flip: true, angle: -8 * DEG },
    { id: "fr+", group: "fliprot", label: "flip + rot +8°", flip: true, angle: 8 * DEG }
  ];

  // ------------------------------------------------------------------ model
  function createModel(seed, hidden) {
    var rand = rng(seed);
    var m = {
      hidden: hidden,
      w1: new Float32Array(hidden * D),
      b1: new Float32Array(hidden),
      w2: new Float32Array(C * hidden),
      b2: new Float32Array(C)
    };
    var i;
    var s1 = Math.sqrt(2 / D), s2 = Math.sqrt(2 / hidden);
    for (i = 0; i < m.w1.length; i++) m.w1[i] = gauss(rand) * s1;
    for (i = 0; i < m.w2.length; i++) m.w2[i] = gauss(rand) * s2;
    return m;
  }

  /** Forward pass for one image at x[off…]; writes hidden activations to h and probabilities to p. */
  function forward(m, x, off, h, p) {
    var H = m.hidden;
    var i, j, acc, row;
    for (j = 0; j < H; j++) {
      acc = m.b1[j];
      row = j * D;
      for (i = 0; i < D; i++) acc += m.w1[row + i] * (x[off + i] - 0.5);
      h[j] = acc > 0 ? acc : 0;
    }
    var max = -Infinity;
    for (j = 0; j < C; j++) {
      acc = m.b2[j];
      row = j * H;
      for (i = 0; i < H; i++) acc += m.w2[row + i] * h[i];
      p[j] = acc;
      if (acc > max) max = acc;
    }
    var sum = 0;
    for (j = 0; j < C; j++) {
      p[j] = Math.exp(p[j] - max);
      sum += p[j];
    }
    for (j = 0; j < C; j++) p[j] /= sum;
  }

  /**
   * Trainer with Adam. opts: { lr, batch, augment, seed }.
   * With `augment` every training image gets a random label-preserving transform each epoch.
   * Call epoch() repeatedly; it returns the mean training loss.
   */
  function createTrainer(m, set, opts) {
    var H = m.hidden;
    var rand = rng(opts.seed || 1);
    var params = [m.w1, m.b1, m.w2, m.b2];
    var grads = params.map(function (p) { return new Float32Array(p.length); });
    var mom = params.map(function (p) { return new Float32Array(p.length); });
    var vel = params.map(function (p) { return new Float32Array(p.length); });
    var order = new Uint32Array(set.count);
    var k;
    for (k = 0; k < set.count; k++) order[k] = k;
    var h = new Float32Array(H);
    var p = new Float32Array(C);
    var dh = new Float32Array(H);
    var buf = new Float32Array(D);
    var step = 0;
    var b1 = 0.9, b2 = 0.999, eps = 1e-8;

    function apply(n) {
      step++;
      var lr = opts.lr * Math.sqrt(1 - Math.pow(b2, step)) / (1 - Math.pow(b1, step));
      for (var q = 0; q < params.length; q++) {
        var P = params[q], G = grads[q], M = mom[q], V = vel[q];
        for (var i = 0; i < P.length; i++) {
          var gr = G[i] / n;
          M[i] = b1 * M[i] + (1 - b1) * gr;
          V[i] = b2 * V[i] + (1 - b2) * gr * gr;
          P[i] -= lr * M[i] / (Math.sqrt(V[i]) + eps);
          G[i] = 0;
        }
      }
    }

    function epoch() {
      var i, j, t;
      for (i = set.count - 1; i > 0; i--) {
        j = Math.floor(rand() * (i + 1));
        t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      var loss = 0;
      var inBatch = 0;
      for (var s = 0; s < set.count; s++) {
        var idx = order[s];
        var x = set.x;
        var off = idx * D;
        if (opts.augment) {
          warp(set.x, off, {
            flip: rand() < 0.5,
            dx: uniform(rand, -1.5, 1.5),
            dy: uniform(rand, -1.5, 1.5),
            angle: uniform(rand, -10, 10) * DEG,
            scale: uniform(rand, 0.88, 1.12)
          }, buf);
          x = buf;
          off = 0;
        }
        forward(m, x, off, h, p);
        var label = set.y[idx];
        loss -= Math.log(p[label] + 1e-12);
        // Backward pass.
        for (j = 0; j < H; j++) dh[j] = 0;
        for (var c = 0; c < C; c++) {
          var dz = p[c] - (c === label ? 1 : 0);
          grads[3][c] += dz;
          var row = c * H;
          for (j = 0; j < H; j++) {
            grads[2][row + j] += dz * h[j];
            dh[j] += dz * m.w2[row + j];
          }
        }
        for (j = 0; j < H; j++) {
          if (h[j] <= 0) continue;
          var g = dh[j];
          grads[1][j] += g;
          var r1 = j * D;
          for (i = 0; i < D; i++) grads[0][r1 + i] += g * (x[off + i] - 0.5);
        }
        if (++inBatch === opts.batch) {
          apply(inBatch);
          inBatch = 0;
        }
      }
      if (inBatch) apply(inBatch);
      return loss / set.count;
    }

    return { epoch: epoch };
  }

  // -------------------------------------------------------------- evaluation
  /**
   * Predict every view of every image.
   * Returns probs[v] = Float32Array(count * C) for each view in `views`.
   */
  function predictViews(m, set, views) {
    var h = new Float32Array(m.hidden);
    var p = new Float32Array(C);
    var buf = new Float32Array(D);
    return views.map(function (view) {
      var out = new Float32Array(set.count * C);
      var identity = !view.flip && !view.dx && !view.dy && !view.angle && (view.scale || 1) === 1;
      for (var k = 0; k < set.count; k++) {
        if (identity) forward(m, set.x, k * D, h, p);
        else {
          warp(set.x, k * D, view, buf);
          forward(m, buf, 0, h, p);
        }
        out.set(p, k * C);
      }
      return out;
    });
  }

  /**
   * Combine the predictions of the views in `subset` (indices into probs) for image k.
   * mode: "mean" (average probabilities), "geo" (average log-probabilities), "vote" (majority).
   * Writes the combined distribution into `out` and returns the predicted class.
   */
  function combine(probs, subset, k, mode, out) {
    var c, v, best;
    for (c = 0; c < C; c++) out[c] = 0;
    for (v = 0; v < subset.length; v++) {
      var P = probs[subset[v]];
      if (mode === "vote") {
        best = 0;
        for (c = 1; c < C; c++) if (P[k * C + c] > P[k * C + best]) best = c;
        out[best] += 1;
      } else if (mode === "geo") {
        for (c = 0; c < C; c++) out[c] += Math.log(P[k * C + c] + 1e-12);
      } else {
        for (c = 0; c < C; c++) out[c] += P[k * C + c];
      }
    }
    var sum = 0;
    if (mode === "geo") {
      var max = -Infinity;
      for (c = 0; c < C; c++) {
        out[c] /= subset.length;
        if (out[c] > max) max = out[c];
      }
      for (c = 0; c < C; c++) {
        out[c] = Math.exp(out[c] - max);
        sum += out[c];
      }
    } else {
      for (c = 0; c < C; c++) sum += out[c];
    }
    best = 0;
    for (c = 0; c < C; c++) {
      out[c] /= sum;
      if (out[c] > out[best]) best = c;
    }
    return best;
  }

  /** Predicted class of every image for the given subset of views. */
  function predictSet(probs, subset, count, mode) {
    var out = new Uint8Array(count);
    var tmp = new Float32Array(C);
    for (var k = 0; k < count; k++) out[k] = combine(probs, subset, k, mode, tmp);
    return out;
  }

  function accuracy(pred, y) {
    var ok = 0;
    for (var k = 0; k < y.length; k++) if (pred[k] === y[k]) ok++;
    return ok / y.length;
  }

  return {
    N: N, D: D, C: C, CLASSES: CLASSES, VIEWS: VIEWS,
    rng: rng, gauss: gauss,
    render: render, makeSet: makeSet, warp: warp,
    createModel: createModel, forward: forward, createTrainer: createTrainer,
    predictViews: predictViews, combine: combine, predictSet: predictSet, accuracy: accuracy
  };
});
