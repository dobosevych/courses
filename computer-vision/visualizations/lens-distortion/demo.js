/* Lens projections and distortion.
   Part A: projection models r(θ) applied to scenes made of straight 3D lines.
   Part B: polynomial radial distortion x_d = x·(1 + k1·r² + k2·r⁴). */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var RAD = Math.PI / 180;

  // ===================================================================== A
  // θ is the angle between a ray and the optical axis, r the distance of its image
  // from the image centre. maxTheta: rays beyond it are not imaged (or not drawn).
  var MODELS = {
    rectilinear: {
      name: "Rectilinear", formula: "r = f·tan θ", short: "tan θ",
      fn: function (t) { return Math.tan(t); }, maxTheta: 88 * RAD, maxFov: 150,
      note: "Straight lines stay straight and parallel lines meet at a vanishing point. " +
        "The image stretches without limit towards θ = 90°, so the field of view can never reach 180°."
    },
    stereographic: {
      name: "Stereographic fisheye", formula: "r = 2f·tan(θ/2)", short: "2·tan(θ/2)",
      fn: function (t) { return 2 * Math.tan(t / 2); }, maxTheta: 172 * RAD, maxFov: 240,
      note: "Every straight line becomes an arc of a circle (or stays straight if it passes through " +
        "the centre). Angles are preserved, so small shapes keep their form even near the edge."
    },
    equidistant: {
      name: "Equidistant fisheye", formula: "r = f·θ", short: "θ",
      fn: function (t) { return t; }, maxTheta: 176 * RAD, maxFov: 240,
      note: "The distance from the centre is proportional to the angle. Straight lines bend into " +
        "curves that are close to circles, but not exactly circles."
    },
    equisolid: {
      name: "Equisolid fisheye", formula: "r = 2f·sin(θ/2)", short: "2·sin(θ/2)",
      fn: function (t) { return 2 * Math.sin(t / 2); }, maxTheta: 172 * RAD, maxFov: 240,
      note: "Equal solid angles cover equal areas of the sensor — the mapping of most photographic " +
        "fisheyes. Lines bend more and more strongly towards the edge."
    },
    orthographic: {
      name: "Orthographic fisheye", formula: "r = f·sin θ", short: "sin θ",
      fn: function (t) { return Math.sin(t); }, maxTheta: 90 * RAD, maxFov: 180,
      note: "Straight lines become arcs of ellipses. The edge is squeezed hardest, and nothing " +
        "further than 90° from the axis can be seen."
    }
  };
  var MODEL_ORDER = ["rectilinear", "stereographic", "equidistant", "equisolid", "orthographic"];

  var A = { model: "stereographic", scene: "wall", fov: 150, yaw: 0, pitch: 0, sel: 0 };
  var view = { w: 0, h: 0, f: 1, analysis: null };
  var plots = {};

  // -------------------------------------------------------------- 3D lines
  /**
   * Points along the segment a→b, spaced evenly in the angle seen from the camera
   * (the origin), so that the projected curve is smooth where it bends most.
   */
  function sampleSegment(a, b) {
    var ux = b[0] - a[0];
    var uy = b[1] - a[1];
    var uz = b[2] - a[2];
    var len = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= len; uy /= len; uz /= len;
    var t0 = -(a[0] * ux + a[1] * uy + a[2] * uz);        // foot of the perpendicular
    var fx = a[0] + t0 * ux;
    var fy = a[1] + t0 * uy;
    var fz = a[2] + t0 * uz;
    var d = Math.sqrt(fx * fx + fy * fy + fz * fz);       // distance from camera to the line
    var pts = [];
    var i;
    var n;
    if (d < 1e-6) {
      n = 24;
      for (i = 0; i <= n; i++) {
        pts.push([a[0] + ux * len * i / n, a[1] + uy * len * i / n, a[2] + uz * len * i / n]);
      }
      return pts;
    }
    var a0 = Math.atan2(-t0, d);
    var a1 = Math.atan2(len - t0, d);
    n = Math.max(2, Math.min(140, Math.ceil(Math.abs(a1 - a0) / (1.25 * RAD))));
    for (i = 0; i <= n; i++) {
      var t = d * Math.tan(a0 + (a1 - a0) * i / n);
      pts.push([fx + t * ux, fy + t * uy, fz + t * uz]);
    }
    return pts;
  }

  // Line groups: "z" into depth, "x" across, "y" vertical, "n" neutral (not selectable).
  function seg(a, b, g) { return { g: g, pts: sampleSegment(a, b) }; }

  function buildWall() {
    var lines = [];
    var Z = 4;
    var i;
    for (i = -5; i <= 5; i++) lines.push(seg([-8, i, Z], [8, i, Z], "x"));
    for (i = -8; i <= 8; i++) lines.push(seg([i, -5, Z], [i, 5, Z], "y"));
    return { lines: lines, sel: 7 };                       // the horizontal line y = 2
  }

  function buildCorridor() {
    var lines = [];
    var hw = 1.5;
    var hh = 1.25;
    var z0 = -12;
    var z1 = 40;
    [-hw, -hw / 2, 0, hw / 2, hw].forEach(function (x) {
      lines.push(seg([x, -hh, z0], [x, -hh, z1], "z"));
      lines.push(seg([x, hh, z0], [x, hh, z1], "z"));
    });
    lines.push(seg([-hw, 0, z0], [-hw, 0, z1], "z"));
    lines.push(seg([hw, 0, z0], [hw, 0, z1], "z"));
    for (var z = z0; z <= z1; z += 2) {
      lines.push(seg([-hw, -hh, z], [hw, -hh, z], "x"));
      lines.push(seg([-hw, hh, z], [hw, hh, z], "x"));
      lines.push(seg([-hw, -hh, z], [-hw, hh, z], "y"));
      lines.push(seg([hw, -hh, z], [hw, hh, z], "y"));
    }
    return { lines: lines, sel: 40 };                      // the floor line 2 m ahead
  }

  function buildRails() {
    var lines = [];
    var gy = -1.5;
    var z;
    lines.push(seg([-0.72, gy, -40], [-0.72, gy, 150], "z"));
    lines.push(seg([0.72, gy, -40], [0.72, gy, 150], "z"));
    lines.push(seg([-3.2, 4, -40], [-3.2, 4, 150], "z"));   // wire along the pole tops
    lines.push(seg([4, gy, -40], [4, gy, 150], "z"));       // platform edge
    for (z = -39; z <= 60; z += 1.5) lines.push(seg([-1.2, gy, z], [1.2, gy, z], "x"));
    for (z = -35; z <= 95; z += 10) lines.push(seg([-3.2, gy, z], [-3.2, 4, z], "y"));
    var horizon = [];
    for (var a = 0; a <= 360; a += 1.5) {
      horizon.push([6000 * Math.cos(a * RAD), gy, 6000 * Math.sin(a * RAD)]);
    }
    lines.push({ g: "n", pts: horizon });
    return { lines: lines, sel: 32 };                      // the sleeper 3 m ahead
  }

  var SCENES = { wall: buildWall(), corridor: buildCorridor(), rails: buildRails() };

  // ------------------------------------------------------------ projection
  function camera(w, h) {
    var model = MODELS[A.model];
    var yaw = A.yaw * RAD;
    var pitch = A.pitch * RAD;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return {
      model: model,
      f: (w / 2) / model.fn(A.fov / 2 * RAD),              // focal length in pixels
      cx: w / 2,
      cy: h / 2,
      right: [cy, 0, -sy],
      up: [-sy * sp, cp, -cy * sp],
      fwd: [sy * cp, sp, cy * cp]
    };
  }

  /** World point → image point [x, y], or null when the lens cannot image that direction. */
  function project(p, cam) {
    var xc = p[0] * cam.right[0] + p[1] * cam.right[1] + p[2] * cam.right[2];
    var yc = p[0] * cam.up[0] + p[1] * cam.up[1] + p[2] * cam.up[2];
    var zc = p[0] * cam.fwd[0] + p[1] * cam.fwd[1] + p[2] * cam.fwd[2];
    var rho = Math.sqrt(xc * xc + yc * yc);
    var theta = Math.atan2(rho, zc);
    if (theta > cam.model.maxTheta) return null;
    if (rho < 1e-12) return [cam.cx, cam.cy];
    var r = cam.f * cam.model.fn(theta);
    return [cam.cx + r * xc / rho, cam.cy - r * yc / rho];
  }

  // ------------------------------------------------------- line analysis
  /** Longest run of consecutive projected points that fall inside (or just around) the picture. */
  function visibleRun(proj, w, h) {
    var best = [];
    var run = [];
    var mx = 0.12 * w;
    var my = 0.12 * h;
    for (var i = 0; i <= proj.length; i++) {
      var p = proj[i];
      if (p && p[0] > -mx && p[0] < w + mx && p[1] > -my && p[1] < h + my) {
        run.push(p);
      } else {
        if (run.length > best.length) best = run;
        run = [];
      }
    }
    return best;
  }

  /** Is the projected line straight, an exact circular arc, or some other curve? */
  function analyse(pts, cx, cy) {
    if (pts.length < 3) return null;
    var a = pts[0];
    var m = pts[pts.length >> 1];
    var b = pts[pts.length - 1];
    var chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (chord < 1e-6) return null;
    var i;
    var length = 0;
    var devLine = 0;
    for (i = 0; i < pts.length; i++) {
      var d = Math.abs((b[0] - a[0]) * (pts[i][1] - a[1]) - (b[1] - a[1]) * (pts[i][0] - a[0])) / chord;
      if (d > devLine) devLine = d;
      if (i) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    var out = { a: a, m: m, b: b, n: pts.length, length: length, devLine: devLine };
    if (devLine < 0.02) {
      out.kind = "straight";
      out.centre = Math.abs((b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0])) / chord;
      return out;
    }
    // Circle through a, m, b.
    var ax = a[0], ay = a[1], bx = m[0], by = m[1], qx = b[0], qy = b[1];
    var det = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, q2 = qx * qx + qy * qy;
    out.ox = (a2 * (by - qy) + b2 * (qy - ay) + q2 * (ay - by)) / det;
    out.oy = (a2 * (qx - bx) + b2 * (ax - qx) + q2 * (bx - ax)) / det;
    out.R = Math.hypot(ax - out.ox, ay - out.oy);
    var devCircle = 0;
    for (i = 0; i < pts.length; i++) {
      var e = Math.abs(Math.hypot(pts[i][0] - out.ox, pts[i][1] - out.oy) - out.R);
      if (e > devCircle) devCircle = e;
    }
    out.devCircle = devCircle;
    out.kind = devCircle < 0.02 ? "circle" : "curve";
    return out;
  }

  // ------------------------------------------------------------- the view
  function drawView(ctx, w, h, col) {
    var cam = camera(w, h);
    var scene = SCENES[A.scene];
    var colour = { z: col.blue, x: col.green, y: col.mauve, n: col.faint };
    var jump = 0.6 * w;      // never join two samples this far apart (wrap-around guard)
    var i;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, h);

    // Where rays at 90° from the axis land: the edge of the front hemisphere.
    if (cam.model.maxTheta >= 90 * RAD) {
      var r90 = cam.f * cam.model.fn(Math.PI / 2);
      if (r90 < Math.hypot(w, h) * 0.75) {
        ctx.strokeStyle = col.faint;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.arc(cam.cx, cam.cy, r90, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col.muted;
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        if (cam.cy - r90 > 14) ctx.fillText("θ = 90°", cam.cx, cam.cy - r90 - 3);
      }
    }

    function trace(proj) {
      var pen = false;
      var last = null;
      for (var k = 0; k < proj.length; k++) {
        var p = proj[k];
        if (!p || (last && Math.hypot(p[0] - last[0], p[1] - last[1]) > jump)) {
          pen = false;
          last = p;
          if (!p) continue;
        }
        if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
        pen = true;
        last = p;
      }
    }

    scene.lines.forEach(function (line) {
      line.proj = line.pts.map(function (p) { return project(p, cam); });
    });

    ["n", "x", "y", "z"].forEach(function (g) {
      ctx.strokeStyle = colour[g];
      ctx.lineWidth = g === "n" ? 1 : 1.4;
      ctx.globalAlpha = g === "n" ? 0.9 : 0.85;
      ctx.beginPath();
      for (i = 0; i < scene.lines.length; i++) {
        if (scene.lines[i].g === g && i !== A.sel) trace(scene.lines[i].proj);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Optical axis.
    ctx.strokeStyle = col.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cam.cx - 6, cam.cy);
    ctx.lineTo(cam.cx + 6, cam.cy);
    ctx.moveTo(cam.cx, cam.cy - 6);
    ctx.lineTo(cam.cx, cam.cy + 6);
    ctx.stroke();

    // Highlighted line and the circle through three of its points.
    var selected = scene.lines[A.sel];
    var an = selected ? analyse(visibleRun(selected.proj, w, h), cam.cx, cam.cy) : null;
    if (an && an.kind !== "straight") {
      ctx.strokeStyle = col.text;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      if (an.R < 40 * w) {
        ctx.arc(an.ox, an.oy, an.R, 0, 2 * Math.PI);
      } else {
        ctx.moveTo(an.a[0], an.a[1]);
        ctx.lineTo(an.b[0], an.b[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      ctx.strokeStyle = col.peach;
      ctx.lineWidth = 3.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      trace(selected.proj);
      ctx.stroke();
    }
    if (an && an.kind !== "straight") {
      [an.a, an.m, an.b].forEach(function (p) {
        ctx.fillStyle = col.bg;
        ctx.strokeStyle = col.text;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();

    view.w = w;
    view.h = h;
    view.f = cam.f;
    view.analysis = an;
  }

  // ---------------------------------------------------------- mapping plot
  function drawMapping(ctx, w, h, col) {
    var padL = 30, padR = 18, padT = 8, padB = 24;
    var tMax = 120;       // degrees
    var yMax = 3.2;       // r / f
    var X = function (deg) { return padL + (deg / tMax) * (w - padL - padR); };
    var Y = function (v) { return padT + (1 - v / yMax) * (h - padT - padB); };
    var i;

    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i <= tMax; i += 30) { ctx.moveTo(X(i), Y(0)); ctx.lineTo(X(i), Y(yMax)); }
    for (i = 0; i <= 3; i++) { ctx.moveTo(X(0), Y(i)); ctx.lineTo(X(tMax), Y(i)); }
    ctx.stroke();

    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = col.muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (i = 0; i <= tMax; i += 30) ctx.fillText(i + "°", X(i), Y(0) + 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (i = 1; i <= 3; i++) ctx.fillText(String(i), padL - 5, Y(i));

    // Half of the current field of view.
    var half = A.fov / 2;
    if (half <= tMax) {
      ctx.strokeStyle = col.peach;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(X(half), Y(0));
      ctx.lineTo(X(half), Y(yMax));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT - 1, w - padL - padR + 1, h - padT - padB + 2);
    ctx.clip();
    MODEL_ORDER.forEach(function (key) {
      var mdl = MODELS[key];
      var active = key === A.model;
      ctx.strokeStyle = active ? col.accent : col.faint;
      ctx.lineWidth = active ? 2.6 : 1.2;
      ctx.beginPath();
      var end = Math.min(tMax, mdl.maxTheta / RAD);
      for (var d = 0; d <= end + 1e-9; d += 1) {
        var v = mdl.fn(Math.min(d, end) * RAD);
        if (d) ctx.lineTo(X(d), Y(v)); else ctx.moveTo(X(d), Y(v));
        if (v > yMax * 1.3) break;
      }
      ctx.stroke();
    });
    ctx.restore();

    // Curve labels at fixed, non-overlapping spots.
    var labels = {
      rectilinear: [66, 2.95, "right"],
      stereographic: [108, 2.95, "right"],
      equidistant: [118, 2.3, "right"],
      equisolid: [118, 1.3, "right"],
      orthographic: [118, 0.7, "right"]
    };
    ctx.textBaseline = "middle";
    MODEL_ORDER.forEach(function (key) {
      var l = labels[key];
      ctx.textAlign = l[2];
      ctx.fillStyle = key === A.model ? col.accent : col.muted;
      ctx.font = (key === A.model ? "600 " : "") + "10px JetBrains Mono, monospace";
      ctx.fillText(MODELS[key].short, X(l[0]), Y(l[1]));
    });
  }

  // ------------------------------------------------------------- readouts
  function renderA() {
    var model = MODELS[A.model];
    var an = view.analysis;
    $("o-fov").textContent = A.fov + "°";
    $("o-yaw").textContent = A.yaw.toFixed(0) + "°";
    $("o-pitch").textContent = A.pitch.toFixed(0) + "°";

    $("model-info").innerHTML = "<b>" + model.name + "</b> " + model.formula +
      " &nbsp;·&nbsp; f = " + view.f.toFixed(0) + " px gives a " + A.fov +
      "° horizontal field of view<br>" + model.note;

    var text;
    if (!an) {
      text = "Not in view — look around or click another line.";
    } else if (an.kind === "straight") {
      text = "<b>Stays straight</b> — deviation from a straight line: " + an.devLine.toFixed(2) + " px." +
        (A.model === "rectilinear" ? "<br>A rectilinear lens keeps every straight line straight."
          : an.centre < 1 ? "<br>It passes through the image centre: such lines stay straight in every model."
            : "");
    } else if (an.kind === "circle") {
      text = "<b>Exact arc of a circle</b><br>radius " + an.R.toFixed(0) + " px = " +
        (an.R / view.f).toFixed(2) + "·f<br>all " + an.n + " sampled points lie on the dashed circle " +
        "to within " + an.devCircle.toFixed(3) + " px<br>bend from a straight line: " +
        an.devLine.toFixed(1) + " px";
    } else {
      text = "<b>Curved, but not a circle</b><br>leaves the dashed circle through its ends and middle " +
        "by up to " + an.devCircle.toFixed(1) + " px (" + (100 * an.devCircle / an.length).toFixed(1) +
        "% of its length)<br>bend from a straight line: " + an.devLine.toFixed(1) + " px";
    }
    $("line-info").innerHTML = text;
  }

  function redrawA() {
    plots.view.redraw();
    plots.map.redraw();
    renderA();
  }

  function syncA() {
    $("model").value = A.model;
    $("scene").value = A.scene;
    $("fov").max = MODELS[A.model].maxFov;
    $("fov").value = A.fov;
    $("yaw").value = A.yaw;
    $("pitch").value = A.pitch;
  }

  function wrap(deg) { return ((deg + 180) % 360 + 360) % 360 - 180; }

  function pick(ev) {
    var canvas = $("view");
    var rect = canvas.getBoundingClientRect();
    var x = (ev.clientX - rect.left) * view.w / rect.width;
    var y = (ev.clientY - rect.top) * view.h / rect.height;
    var lines = SCENES[A.scene].lines;
    var best = -1;
    var bestD = 16;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].g === "n" || !lines[i].proj) continue;
      for (var k = 0; k < lines[i].proj.length; k++) {
        var p = lines[i].proj[k];
        if (!p) continue;
        var d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) {
      A.sel = best;
      redrawA();
    }
  }

  function initA() {
    plots.view = Viz.autoCanvas($("view"), { aspect: 0.68, draw: drawView });
    plots.map = Viz.autoCanvas($("map"), { aspect: 0.82, draw: drawMapping });

    $("model").addEventListener("change", function () {
      A.model = $("model").value;
      A.fov = Math.min(A.fov, MODELS[A.model].maxFov);
      syncA();
      redrawA();
    });
    $("scene").addEventListener("change", function () {
      A.scene = $("scene").value;
      A.sel = SCENES[A.scene].sel;
      redrawA();
    });
    $("fov").addEventListener("input", function () {
      A.fov = parseFloat($("fov").value);
      redrawA();
    });
    $("yaw").addEventListener("input", function () {
      A.yaw = parseFloat($("yaw").value);
      redrawA();
    });
    $("pitch").addEventListener("input", function () {
      A.pitch = parseFloat($("pitch").value);
      redrawA();
    });
    $("reset-view").addEventListener("click", function () {
      A.yaw = 0;
      A.pitch = 0;
      A.sel = SCENES[A.scene].sel;
      syncA();
      redrawA();
    });

    // Drag to look around; a click without movement highlights the nearest line.
    var canvas = $("view");
    var drag = null;
    canvas.addEventListener("pointerdown", function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, yaw: A.yaw, pitch: A.pitch, moved: false };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    canvas.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x;
      var dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      canvas.classList.add("is-dragging");
      var degPerPx = A.fov / Math.max(view.w, 1);
      A.yaw = Math.round(wrap(drag.yaw - dx * degPerPx));
      A.pitch = Math.round(Viz.clamp(drag.pitch + dy * degPerPx, -90, 90));
      syncA();
      redrawA();
    });
    function end(ev) {
      if (drag && !drag.moved && ev.type === "pointerup") pick(ev);
      drag = null;
      canvas.classList.remove("is-dragging");
    }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    A.sel = SCENES[A.scene].sel;
    syncA();
    redrawA();
  }

  // ===================================================================== B
  // Coordinates are normalised so that r = 1 at the corner of the square image;
  // the middle of an edge is then at r = 1/√2.
  var EDGE = Math.SQRT1_2;
  var N = 192;
  var B = { k1: -0.22, k2: 0, img: null };

  function gain(r) { return 1 + B.k1 * r * r + B.k2 * r * r * r * r; }
  function distort(r) { return r * gain(r); }

  /** Radius at which the model stops being one-to-one (its derivative reaches zero). */
  function foldRadius() {
    for (var r = 0.005; r <= 2.5; r += 0.005) {
      if (1 + 3 * B.k1 * r * r + 5 * B.k2 * r * r * r * r <= 0) return r;
    }
    return Infinity;
  }

  /** Inverse of distort() on the range where it is one-to-one: r_d → r, or NaN. */
  function inverse() {
    var rMax = Math.min(foldRadius(), 2.5);
    var n = 900;
    var ru = new Float64Array(n + 1);
    var rd = new Float64Array(n + 1);
    for (var i = 0; i <= n; i++) {
      ru[i] = rMax * i / n;
      rd[i] = distort(ru[i]);
    }
    return function (d) {
      if (d > rd[n]) return NaN;
      var lo = 0;
      var hi = n;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (rd[mid] <= d) lo = mid; else hi = mid;
      }
      var span = rd[hi] - rd[lo];
      return ru[lo] + (span > 0 ? (d - rd[lo]) / span : 0) * (ru[hi] - ru[lo]);
    };
  }

  /** The picture the distorting lens produces: for every output pixel find where it came from. */
  function renderWarp() {
    var inv = inverse();
    var src = B.img.data;
    var out = new Uint8ClampedArray(N * N * 4);
    var half = N / 2;
    for (var j = 0; j < N; j++) {
      var v = (j + 0.5 - half) / half * EDGE;
      for (var i = 0; i < N; i++) {
        var u = (i + 0.5 - half) / half * EDGE;
        var rd = Math.sqrt(u * u + v * v);
        var k = 1;
        if (rd > 1e-9) {
          var ru = inv(rd);
          if (ru !== ru) continue;                           // NaN: nothing lands here
          k = ru / rd;
        }
        var x = u * k / EDGE * half + half - 0.5;
        var y = v * k / EDGE * half + half - 0.5;
        if (x < 0 || y < 0 || x > N - 1 || y > N - 1) continue;
        var x0 = Math.floor(x), y0 = Math.floor(y);
        var x1 = Math.min(x0 + 1, N - 1), y1 = Math.min(y0 + 1, N - 1);
        var fx = x - x0, fy = y - y0;
        var val = (src[y0 * N + x0] * (1 - fx) + src[y0 * N + x1] * fx) * (1 - fy) +
          (src[y1 * N + x0] * (1 - fx) + src[y1 * N + x1] * fx) * fy;
        var o = (j * N + i) * 4;
        out[o] = out[o + 1] = out[o + 2] = val;
        out[o + 3] = 255;
      }
    }
    // Empty pixels stay transparent, so clear what the previous frame left behind.
    var canvas = $("warp");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    Viz.paintRGBA(canvas, out, N, N, { scale: 2 });
  }

  function drawGrid(ctx, w, h, col) {
    var S = Math.min(w, h) * 0.345 / EDGE;           // pixels per normalised unit
    var X = function (u) { return w / 2 + u * S; };
    var Y = function (v) { return h / 2 + v * S; };
    var cells = 8;
    var i;
    var k;

    ctx.strokeStyle = col.faint;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (i = 0; i <= cells; i++) {
      var c = -EDGE + 2 * EDGE * i / cells;
      ctx.moveTo(X(c), Y(-EDGE));
      ctx.lineTo(X(c), Y(EDGE));
      ctx.moveTo(X(-EDGE), Y(c));
      ctx.lineTo(X(EDGE), Y(c));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    function warped(u, v) {
      var g = gain(Math.sqrt(u * u + v * v));
      return [X(u * g), Y(v * g)];
    }

    for (i = 0; i <= cells; i++) {
      var c2 = -EDGE + 2 * EDGE * i / cells;
      var outer = i === 0 || i === cells;
      ctx.strokeStyle = outer ? col.primary : col.accent;
      ctx.lineWidth = outer ? 2.2 : 1.5;
      ctx.beginPath();
      for (k = 0; k <= 60; k++) {
        var t = -EDGE + 2 * EDGE * k / 60;
        var p = warped(c2, t);
        if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }
      for (k = 0; k <= 60; k++) {
        var t2 = -EDGE + 2 * EDGE * k / 60;
        var q = warped(t2, c2);
        if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      }
      ctx.stroke();
    }
  }

  function drawRadial(ctx, w, h, col) {
    var padL = 34, padR = 10, padT = 10, padB = 30;
    var xMax = 1.1;
    var yMax = 1.4;
    var X = function (r) { return padL + (r / xMax) * (w - padL - padR); };
    var Y = function (r) { return padT + (1 - r / yMax) * (h - padT - padB); };
    var i;

    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i <= 5; i++) { ctx.moveTo(X(i * 0.2), Y(0)); ctx.lineTo(X(i * 0.2), Y(yMax)); }
    for (i = 0; i <= 7; i++) { ctx.moveTo(X(0), Y(i * 0.2)); ctx.lineTo(X(xMax), Y(i * 0.2)); }
    ctx.stroke();

    // Edge and corner of the image.
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    [[EDGE, "edge"], [1, "corner"]].forEach(function (m) {
      ctx.strokeStyle = col.peach;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(X(m[0]), Y(0));
      ctx.lineTo(X(m[0]), Y(yMax));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.peach;
      ctx.fillText(m[1], X(m[0]) - 4, padT + 3);
    });

    ctx.strokeStyle = col.faint;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(xMax), Y(xMax));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, w - padL - padR, h - padT - padB);
    ctx.clip();
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (i = 0; i <= 110; i++) {
      var r = xMax * i / 110;
      if (i) ctx.lineTo(X(r), Y(distort(r))); else ctx.moveTo(X(r), Y(distort(r)));
    }
    ctx.stroke();
    var fold = foldRadius();
    if (fold < xMax) {
      ctx.fillStyle = col.red;
      ctx.beginPath();
      ctx.arc(X(fold), Y(distort(fold)), 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = col.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (i = 0; i <= 5; i++) ctx.fillText((i * 0.2).toFixed(1), X(i * 0.2), Y(0) + 4);
    ctx.fillText("ideal radius r", X(xMax / 2), Y(0) + 16);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (i = 1; i <= 7; i++) ctx.fillText((i * 0.2).toFixed(1), padL - 5, Y(i * 0.2));
  }

  function classify() {
    var falls = false;
    var grows = false;
    for (var r = 0.02; r <= 1.0001; r += 0.02) {
      var d = 2 * B.k1 * r + 4 * B.k2 * r * r * r;       // slope of the magnification
      if (d < -1e-9) falls = true;
      if (d > 1e-9) grows = true;
    }
    if (!falls && !grows) return "no distortion — the grid is unchanged";
    if (falls && !grows) return "barrel — magnification falls towards the edge, straight lines bow outwards";
    if (grows && !falls) return "pincushion — magnification grows towards the edge, straight lines bow inwards";
    return B.k1 < 0
      ? "mustache — barrel in the centre turning into pincushion towards the corners"
      : "mixed — pincushion in the centre turning into barrel towards the corners";
  }

  function signed(v, digits) { return (v < 0 ? "− " : "+ ") + Math.abs(v).toFixed(digits); }

  function percent(v) { return (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%"; }

  function renderB() {
    $("o-k1").textContent = (B.k1 > 0 ? "+" : "") + B.k1.toFixed(2);
    $("o-k2").textContent = (B.k2 > 0 ? "+" : "") + B.k2.toFixed(2);
    Array.prototype.forEach.call($("presets").children, function (b) {
      var on = Math.abs(parseFloat(b.dataset.k1) - B.k1) < 1e-6 && Math.abs(parseFloat(b.dataset.k2) - B.k2) < 1e-6;
      b.setAttribute("aria-pressed", String(on));
    });
    var fold = foldRadius();
    $("radial-info").innerHTML =
      "<b>x<sub>d</sub></b> = x · (1 " + signed(B.k1, 2) + "·r² " + signed(B.k2, 2) + "·r⁴), the same for y" +
      " &nbsp;·&nbsp; r = 1 at the image corner<br>" +
      "<b>Type</b> " + classify() + "<br>" +
      "<b>Shift</b> middle of an edge (r = 0.71): " + percent(gain(EDGE) - 1) +
      " &nbsp;·&nbsp; corner (r = 1): " + percent(gain(1) - 1) +
      (fold <= 1 ? "<br><b>Fold-over</b> beyond r = " + fold.toFixed(2) +
        " the model maps points back towards the centre; only the part inside it is drawn in the image" : "");
    renderWarp();
    plots.grid.redraw();
    plots.radial.redraw();
  }

  function initB() {
    var picker = Viz.imagePicker($("picker"), {
      samples: ["checker", "scene", "text", "shapes"],
      size: N,
      value: "checker",
      onChange: function (img) {
        B.img = img;
        renderB();
      }
    });
    B.img = picker.image();
    plots.grid = Viz.autoCanvas($("grid"), { aspect: 1, draw: drawGrid });
    plots.radial = Viz.autoCanvas($("radial"), { aspect: 1, draw: drawRadial });

    $("k1").addEventListener("input", function () {
      B.k1 = parseFloat($("k1").value);
      renderB();
    });
    $("k2").addEventListener("input", function () {
      B.k2 = parseFloat($("k2").value);
      renderB();
    });
    $("presets").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-k1]");
      if (!b) return;
      B.k1 = parseFloat(b.dataset.k1);
      B.k2 = parseFloat(b.dataset.k2);
      $("k1").value = B.k1;
      $("k2").value = B.k2;
      renderB();
    });
    renderB();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initA();
    initB();
  });
})();
