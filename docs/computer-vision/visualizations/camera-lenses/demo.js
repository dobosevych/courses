/* Camera and lenses: one 3D scene projected with the pinhole model x = f·X / Z
   for any focal length, sensor size and camera distance. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // Sensor sizes in millimetres (all close to 3:2, so the view keeps one shape).
  var SENSORS = {
    ff: { label: "Full frame", w: 36, h: 24 },
    apsc: { label: "APS-C", w: 23.6, h: 15.7 },
    phone: { label: "Phone-size", w: 6.2, h: 4.13 }
  };
  var SENSOR_ORDER = ["ff", "apsc", "phone"];
  var FF_DIAGONAL = Math.sqrt(36 * 36 + 24 * 24);

  var PRIMES = [14, 24, 35, 50, 85, 135, 200];
  var F_MIN = 14;
  var F_MAX = 200;
  var D_MIN = 1;
  var D_MAX = 40;
  var ASPECT = 2 / 3;
  var CAM_H = 1.5;        // camera height above the ground, metres
  var NEAR = 0.3;         // nothing closer than this is drawn
  var SUBJECT_H = 1.75;
  var BUILDING_Z = 70;

  // ------------------------------------------------------------------ scene
  // World: X to the right, Y up, Z away from the camera. The subject stands at Z = 0,
  // the camera is at Z = -D and looks along +Z, so depth = Z + D.
  var POLES = [5, 15, 25, 35, 45, 55, 65].map(function (z) { return { kind: "pole", x: -3, z: z }; });
  var TREES = [
    { kind: "tree", x: 5.5, z: 9, h: 6, r: 2 },
    { kind: "tree", x: -7.5, z: 13, h: 5, r: 1.7 },
    { kind: "tree", x: 8.5, z: 22, h: 8, r: 2.6 },
    { kind: "tree", x: -9.5, z: 31, h: 7, r: 2.3 },
    { kind: "tree", x: 10.5, z: 46, h: 9, r: 3 },
    { kind: "tree", x: -12, z: 56, h: 8, r: 2.6 }
  ];
  var BUILDING = { kind: "building", x0: -14, x1: 14, z: BUILDING_Z, h: 16, depth: 12 };
  var PERSON = { kind: "person", x: 0, z: 0 };
  var OBJECTS = [BUILDING].concat(TREES, POLES, [PERSON]).sort(function (a, b) { return b.z - a.z; });

  // A far mountain ridge: 3 km away, so moving the camera a few metres does not change it.
  var MOUNTAIN_Z = 3000;
  var MOUNTAINS = (function () {
    var pts = [];
    for (var i = 0; i <= 44; i++) {
      var x = -5500 + i * 250;
      var hgt = 170 + 330 * Math.abs(Math.sin(i * 1.7)) * (0.55 + 0.45 * Math.sin(i * 0.63 + 1));
      pts.push([x, hgt]);
    }
    return pts;
  })();

  // ------------------------------------------------------------------ state
  var state = {
    f: 50,          // focal length, mm
    D: 8,           // camera–subject distance, m
    sensor: "ff",
    lock: false,    // dolly zoom: keep f / D constant
    k: 50 / 8
  };

  var canvases = { thumbs: [] };

  function fov(size, f) { return 2 * Math.atan(size / (2 * f)) * 180 / Math.PI; }

  /** Camera used for a given focal length: in dolly-zoom mode the distance follows the lens. */
  function cameraFor(f) {
    var D = state.lock ? Viz.clamp(f / state.k, D_MIN, D_MAX) : state.D;
    return { f: f, D: D, sensor: state.sensor };
  }

  // ----------------------------------------------------------------- colours
  function rgb(hex) {
    hex = String(hex).replace("#", "");
    if (hex.length === 3) hex = hex.replace(/(.)/g, "$1$1");
    var n = parseInt(hex, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function css(c, alpha) {
    var s = Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]);
    return alpha === undefined ? "rgb(" + s + ")" : "rgba(" + s + "," + alpha + ")";
  }

  var paletteCache = null;
  var paletteTheme = null;

  function palette(col) {
    if (paletteCache && paletteTheme === Viz.theme()) return paletteCache;
    var base = rgb(col.base);
    var dark = col.dark;
    var skyLow = lerp3(rgb(col.sky), base, dark ? 0.62 : 0.8);
    paletteCache = {
      skyTop: lerp3(rgb(col.blue), base, dark ? 0.84 : 0.5),
      skyLow: skyLow,
      haze: skyLow,
      mountain: lerp3(rgb(col.overlay1), skyLow, 0.45),
      groundNear: lerp3(rgb(col.green), base, dark ? 0.72 : 0.5),
      groundFar: lerp3(rgb(col.green), base, dark ? 0.6 : 0.72),
      grid: lerp3(rgb(col.green), rgb(col.text), 0.45),
      road: lerp3(rgb(col.surface2), base, dark ? 0.15 : 0.35),
      building: lerp3(rgb(col.mauve), base, dark ? 0.35 : 0.3),
      buildingDark: lerp3(rgb(col.mauve), rgb(col.crust), dark ? 0.6 : 0.15),
      window: lerp3(rgb(col.yellow), base, dark ? 0.25 : 0.7),
      leaf: lerp3(rgb(col.green), rgb(col.crust), dark ? 0.3 : 0.05),
      leafLight: lerp3(rgb(col.green), base, 0.3),
      trunk: lerp3(rgb(col.peach), rgb(col.text), 0.6),
      pole: rgb(col.subtext1),
      lamp: rgb(col.yellow),
      person: rgb(col.peach),
      text: rgb(col.text),
      base: base,
      accent: rgb(col.accent)
    };
    paletteTheme = Viz.theme();
    return paletteCache;
  }

  // ------------------------------------------------------------- camera view
  /**
   * Draw the scene as the sensor sees it. Everything is placed by x = f·X / Z:
   * `k` is that focal length expressed in canvas pixels, so k / depth is the size
   * in pixels of one metre at that depth.
   */
  function drawScene(ctx, w, h, col, cam, detail) {
    var pal = palette(col);
    var sensor = SENSORS[cam.sensor];
    var k = (w / sensor.w) * cam.f;
    var cx = w / 2;
    var cy = h / 2;
    var lw = Math.max(0.5, w / 560);
    var i;

    function sc(Z) { return k / (Z + cam.D); }
    function px(X, Z) { return cx + sc(Z) * X; }
    function py(Y, Z) { return cy - sc(Z) * (Y - CAM_H); }
    function hazed(c, Z) { return css(lerp3(c, pal.haze, Viz.clamp((Z + cam.D) / 240, 0, 0.5))); }
    function disc(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    // Sky. The camera looks horizontally, so the horizon is at the centre of the frame.
    var sky = ctx.createLinearGradient(0, 0, 0, cy);
    sky.addColorStop(0, css(pal.skyTop));
    sky.addColorStop(1, css(pal.skyLow));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, cy + 1);

    ctx.fillStyle = css(pal.mountain);
    ctx.beginPath();
    ctx.moveTo(px(MOUNTAINS[0][0], MOUNTAIN_Z), cy + 1);
    for (i = 0; i < MOUNTAINS.length; i++) {
      ctx.lineTo(px(MOUNTAINS[i][0], MOUNTAIN_Z), py(MOUNTAINS[i][1], MOUNTAIN_Z));
    }
    ctx.lineTo(px(MOUNTAINS[MOUNTAINS.length - 1][0], MOUNTAIN_Z), cy + 1);
    ctx.closePath();
    ctx.fill();

    var ground = ctx.createLinearGradient(0, cy, 0, h);
    ground.addColorStop(0, css(pal.groundFar));
    ground.addColorStop(1, css(pal.groundNear));
    ctx.fillStyle = ground;
    ctx.fillRect(0, cy, w, h - cy);

    // Ground grid, 5 m cells.
    var zNear = -cam.D + NEAR;
    ctx.lineWidth = lw;
    ctx.strokeStyle = css(pal.grid, 0.22);
    ctx.beginPath();
    for (i = -200; i <= 200; i += 5) {
      ctx.moveTo(px(i, zNear), py(0, zNear));
      ctx.lineTo(px(i, 900), py(0, 900));
    }
    ctx.stroke();
    for (i = Math.ceil(zNear / 5) * 5; i <= 300; i += 5) {
      ctx.strokeStyle = css(pal.grid, Viz.clamp(0.42 - (i + cam.D) / 400, 0.05, 0.42));
      ctx.beginPath();
      ctx.moveTo(0, py(0, i));
      ctx.lineTo(w, py(0, i));
      ctx.stroke();
    }

    // Path from the camera to the building door.
    ctx.fillStyle = css(pal.road);
    ctx.beginPath();
    ctx.moveTo(px(-1.2, zNear), py(0, zNear));
    ctx.lineTo(px(1.2, zNear), py(0, zNear));
    ctx.lineTo(px(1.2, BUILDING_Z), py(0, BUILDING_Z));
    ctx.lineTo(px(-1.2, BUILDING_Z), py(0, BUILDING_Z));
    ctx.closePath();
    ctx.fill();

    // Objects, far to near. Each is flat and faces the camera, so it is only scaled by k / depth.
    OBJECTS.forEach(function (o) {
      var s = sc(o.z);
      var gy = py(0, o.z);
      var x;
      var r;
      var c;
      if (o.kind === "building") {
        x = px(o.x0, o.z);
        ctx.fillStyle = hazed(pal.building, o.z);
        ctx.fillRect(x, gy - o.h * s, (o.x1 - o.x0) * s, o.h * s);
        ctx.fillStyle = hazed(pal.buildingDark, o.z);
        ctx.fillRect(x - 0.5 * s, gy - (o.h + 0.9) * s, (o.x1 - o.x0 + 1) * s, 0.9 * s);
        ctx.fillRect(px(-1.3, o.z), gy - 3 * s, 2.6 * s, 3 * s);
        ctx.fillStyle = hazed(pal.window, o.z);
        for (r = 0; r < 4; r++) {
          for (c = 0; c < 7; c++) {
            if (r === 0 && c === 3) continue;   // the door
            ctx.fillRect(px(o.x0 + 1 + c * 4, o.z), gy - (3.6 + r * 3.1 + 1.9) * s, 2 * s, 1.9 * s);
          }
        }
      } else if (o.kind === "tree") {
        x = px(o.x, o.z);
        ctx.fillStyle = hazed(pal.trunk, o.z);
        ctx.fillRect(x - 0.2 * s, gy - (o.h - o.r) * s, 0.4 * s, (o.h - o.r) * s);
        ctx.fillStyle = hazed(pal.leaf, o.z);
        disc(x, gy - (o.h - o.r) * s, o.r * s);
        ctx.fillStyle = hazed(pal.leafLight, o.z);
        disc(x - 0.3 * o.r * s, gy - (o.h - 0.7 * o.r) * s, 0.45 * o.r * s);
      } else if (o.kind === "pole") {
        x = px(o.x, o.z);
        var pw = Math.max(0.16 * s, lw);
        ctx.fillStyle = hazed(pal.pole, o.z);
        ctx.fillRect(x - pw / 2, gy - 5 * s, pw, 5 * s);
        ctx.fillRect(x, gy - 5 * s, 1.1 * s, Math.max(0.12 * s, lw * 0.8));
        ctx.fillStyle = hazed(pal.lamp, o.z);
        ctx.fillRect(x + 0.7 * s, gy - 4.9 * s, 0.45 * s, Math.max(0.2 * s, lw * 0.8));
      } else {
        x = px(o.x, o.z);
        ctx.fillStyle = css(pal.person);
        ctx.fillRect(x - 0.17 * s, gy - 0.88 * s, 0.15 * s, 0.88 * s);          // legs
        ctx.fillRect(x + 0.02 * s, gy - 0.88 * s, 0.15 * s, 0.88 * s);
        ctx.fillRect(x - 0.22 * s, gy - 1.46 * s, 0.44 * s, 0.62 * s);          // torso
        ctx.fillRect(x - 0.31 * s, gy - 1.44 * s, 0.07 * s, 0.62 * s);          // arms
        ctx.fillRect(x + 0.24 * s, gy - 1.44 * s, 0.07 * s, 0.62 * s);
        disc(x, gy - 1.61 * s, 0.14 * s);                                       // head
      }
    });

    if (detail) {
      // Frames of the smaller sensors: the same lens, a smaller piece of the same image.
      ctx.font = "600 10px JetBrains Mono, monospace";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      SENSOR_ORDER.forEach(function (key) {
        var other = SENSORS[key];
        if (other.w >= sensor.w) return;
        var fw = w * other.w / sensor.w;
        var fh = h * other.h / sensor.h;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = css(pal.text, 0.9);
        ctx.strokeRect(cx - fw / 2, cy - fh / 2, fw, fh);
        ctx.setLineDash([]);
        var label = other.label;
        var tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = css(pal.base, 0.82);
        ctx.fillRect(cx - fw / 2, cy - fh / 2 - 15, tw, 14);
        ctx.fillStyle = css(pal.text);
        ctx.fillText(label, cx - fw / 2 + 4, cy - fh / 2 - 2);
      });
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- plan view
  function drawPlan(ctx, w, h, col) {
    var pal = palette(col);
    var cam = cameraFor(state.f);
    var sensor = SENSORS[cam.sensor];
    var zMin = -(D_MAX + 6);
    var zMax = 92;
    var s = w / (zMax - zMin);          // pixels per metre
    var i;

    function X(z) { return (z - zMin) * s; }
    function Y(x) { return h / 2 + x * s; }   // the camera's right-hand side is drawn downwards

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    ctx.fillStyle = css(lerp3(pal.groundFar, pal.base, 0.45));
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = css(pal.grid, 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = -40; i <= 90; i += 10) {
      ctx.moveTo(X(i), 0);
      ctx.lineTo(X(i), h);
    }
    for (i = -60; i <= 60; i += 10) {
      ctx.moveTo(0, Y(i));
      ctx.lineTo(w, Y(i));
    }
    ctx.stroke();

    ctx.fillStyle = css(pal.road);
    ctx.fillRect(0, Y(-1.2), X(BUILDING_Z), 2.4 * s);

    // Field of view: everything inside the wedge reaches the sensor.
    var half = Math.atan(sensor.w / (2 * cam.f));
    var reach = (zMax + cam.D) * Math.tan(half);
    ctx.fillStyle = css(pal.accent, 0.2);
    ctx.strokeStyle = css(pal.accent);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X(-cam.D), Y(0));
    ctx.lineTo(X(zMax), Y(-reach));
    ctx.lineTo(X(zMax), Y(reach));
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(X(zMax), Y(-reach));
    ctx.lineTo(X(-cam.D), Y(0));
    ctx.lineTo(X(zMax), Y(reach));
    ctx.stroke();

    ctx.strokeStyle = css(pal.text, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(-cam.D), Y(0));
    ctx.lineTo(X(zMax), Y(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Objects.
    ctx.fillStyle = css(pal.building);
    ctx.fillRect(X(BUILDING.z), Y(BUILDING.x0), BUILDING.depth * s, (BUILDING.x1 - BUILDING.x0) * s);
    TREES.forEach(function (t) {
      ctx.fillStyle = css(pal.leaf);
      ctx.beginPath();
      ctx.arc(X(t.z), Y(t.x), Math.max(t.r * s, 3), 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.fillStyle = css(pal.pole);
    POLES.forEach(function (p) {
      ctx.fillRect(X(p.z) - 2, Y(p.x) - 2, 4, 4);
    });

    // Width of the scene that fits in the frame at the subject: w·Z / f.
    var frame = sensor.w * cam.D / cam.f;
    ctx.strokeStyle = css(pal.person);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(-frame / 2));
    ctx.lineTo(X(0), Y(frame / 2));
    ctx.stroke();
    ctx.fillStyle = css(pal.person);
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 4.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = css(pal.base);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Camera: body with the lens pointing along +Z.
    var cxp = X(-cam.D);
    ctx.fillStyle = css(pal.text);
    ctx.fillRect(cxp - 12, Y(0) - 6, 8, 12);
    ctx.beginPath();
    ctx.moveTo(cxp - 4, Y(0) - 3.5);
    ctx.lineTo(cxp + 1, Y(0) - 5.5);
    ctx.lineTo(cxp + 1, Y(0) + 5.5);
    ctx.lineTo(cxp - 4, Y(0) + 3.5);
    ctx.closePath();
    ctx.fill();

    // Labels.
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = css(pal.text, 0.75);
    for (i = -40; i <= 80; i += 20) {
      ctx.fillText(i === 0 ? "0 m" : String(i), X(i), h - 13);
    }
    ctx.fillStyle = css(pal.text);
    ctx.font = "600 10px JetBrains Mono, monospace";
    ctx.textBaseline = "bottom";
    ctx.fillText("building", X(BUILDING.z + BUILDING.depth / 2), Y(BUILDING.x0) - 3);
    ctx.textAlign = cxp < 46 ? "left" : "center";
    ctx.fillText("camera", cxp < 46 ? 2 : cxp - 6, Y(0) - 10);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("subject", X(0) + 8, Y(0) + 13);
    ctx.restore();
  }

  // ----------------------------------------------------------------- readout
  function fmt(v, digits) { return v.toFixed(digits); }

  function focalText(f) { return (Math.abs(f - Math.round(f)) < 0.05 ? String(Math.round(f)) : f.toFixed(1)) + " mm"; }

  function metres(v) { return v >= 100 ? fmt(v, 0) : v >= 10 ? fmt(v, 1) : fmt(v, 2); }

  /** Whole numbers without a trailing ".0". */
  function num(v) { return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1); }

  function renderInfo() {
    var cam = cameraFor(state.f);
    var sensor = SENSORS[cam.sensor];
    var crop = FF_DIAGONAL / Math.sqrt(sensor.w * sensor.w + sensor.h * sensor.h);
    var hf = fov(sensor.w, cam.f);
    var vf = fov(sensor.h, cam.f);
    var df = fov(Math.sqrt(sensor.w * sensor.w + sensor.h * sensor.h), cam.f);
    var onSensor = cam.f * SUBJECT_H / cam.D;                 // mm
    var share = 100 * onSensor / sensor.h;
    var atSubject = sensor.w * cam.D / cam.f;
    var atBuilding = sensor.w * (cam.D + BUILDING_Z) / cam.f;

    $("cap-view").textContent = focalText(cam.f) + " · " + fmt(hf, 1) + "° wide";
    $("cap-strip").textContent = state.lock
      ? "each from the distance that keeps the subject the same size"
      : "all from " + fmt(cam.D, 1) + " m — click one to mount it";

    $("info").innerHTML =
      "<b>Field of view</b> = 2·atan(w / 2f) = 2·atan(" + sensor.w + " / (2·" + num(cam.f) + ")) = " +
      fmt(hf, 1) + "° horizontal · " + fmt(vf, 1) + "° vertical · " + fmt(df, 1) + "° diagonal<br>" +
      "<b>Sensor</b> " + sensor.label + " " + sensor.w + " × " + num(sensor.h) + " mm · crop factor " +
      fmt(crop, 2) + " · frames like a " + fmt(cam.f * crop, 0) + " mm lens on full frame<br>" +
      "<b>Projection</b> x = f·X / Z: the " + SUBJECT_H + " m subject at " + fmt(cam.D, 1) + " m is " +
      num(cam.f) + "·" + SUBJECT_H + " / " + fmt(cam.D, 1) + " = " + fmt(onSensor, 1) +
      " mm tall on the sensor (" + fmt(share, 0) + "% of the frame height)<br>" +
      "<b>Frame width</b> = w·Z / f: " + metres(atSubject) + " m at the subject, " + metres(atBuilding) +
      " m at the building — the background is magnified " + fmt(cam.D / (cam.D + BUILDING_Z) * 100, 0) +
      "% as much as the subject";
  }

  // ------------------------------------------------------------- interaction
  function toSlider(v, lo, hi) { return Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo)); }
  function fromSlider(t, lo, hi) { return lo * Math.pow(hi / lo, t / 1000); }

  /** Snap to a prime when the slider is within about 1.5% of it. */
  function snap(f) {
    for (var i = 0; i < PRIMES.length; i++) {
      if (Math.abs(Math.log(f / PRIMES[i])) < 0.015) return PRIMES[i];
    }
    return f;
  }

  function setFocal(f) {
    if (state.lock) {
      f = Viz.clamp(f, Math.max(F_MIN, state.k * D_MIN), Math.min(F_MAX, state.k * D_MAX));
      state.D = f / state.k;
    }
    state.f = Viz.clamp(f, F_MIN, F_MAX);
  }

  function setDistance(D) {
    if (state.lock) {
      D = Viz.clamp(D, Math.max(D_MIN, F_MIN / state.k), Math.min(D_MAX, F_MAX / state.k));
      state.f = state.k * D;
    }
    state.D = Viz.clamp(D, D_MIN, D_MAX);
  }

  function update(source) {
    if (source !== "f") $("f").value = toSlider(state.f, F_MIN, F_MAX);
    if (source !== "d") $("d").value = toSlider(state.D, D_MIN, D_MAX);
    $("o-f").textContent = focalText(state.f);
    $("o-d").textContent = fmt(state.D, 1) + " m";
    canvases.thumbs.forEach(function (t) {
      t.button.setAttribute("aria-pressed", String(Math.abs(t.f - state.f) < 0.05));
      var cam = cameraFor(t.f);
      t.note.textContent = state.lock
        ? fmt(cam.D, 1) + " m"
        : fmt(fov(SENSORS[state.sensor].w, t.f), 0) + "°";
      t.plot.redraw();
    });
    canvases.view.redraw();
    canvases.plan.redraw();
    renderInfo();
  }

  function buildStrip() {
    var strip = $("strip");
    PRIMES.forEach(function (f) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lens";
      button.title = "Mount the " + f + " mm lens";
      var canvas = document.createElement("canvas");
      var label = document.createElement("span");
      label.className = "lens-label";
      var name = document.createElement("span");
      name.textContent = f + " mm";
      var note = document.createElement("small");
      label.appendChild(name);
      label.appendChild(note);
      button.appendChild(canvas);
      button.appendChild(label);
      strip.appendChild(button);
      var plot = Viz.autoCanvas(canvas, {
        aspect: ASPECT,
        draw: function (ctx, w, h, col) { drawScene(ctx, w, h, col, cameraFor(f), false); }
      });
      button.addEventListener("click", function () {
        setFocal(f);
        update();
      });
      canvases.thumbs.push({ f: f, button: button, note: note, plot: plot });
    });
  }

  function init() {
    canvases.view = Viz.autoCanvas($("view"), {
      aspect: ASPECT,
      draw: function (ctx, w, h, col) { drawScene(ctx, w, h, col, cameraFor(state.f), true); }
    });
    canvases.plan = Viz.autoCanvas($("plan"), { aspect: ASPECT, draw: drawPlan });
    buildStrip();

    $("f").addEventListener("input", function () {
      setFocal(snap(fromSlider(parseFloat($("f").value), F_MIN, F_MAX)));
      update(state.lock ? undefined : "f");
    });
    $("d").addEventListener("input", function () {
      setDistance(fromSlider(parseFloat($("d").value), D_MIN, D_MAX));
      update(state.lock ? undefined : "d");
    });
    $("sensor").addEventListener("change", function () {
      state.sensor = $("sensor").value;
      update();
    });
    $("lock").addEventListener("change", function () {
      state.lock = $("lock").checked;
      state.k = state.f / state.D;
      update();
    });

    update();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
