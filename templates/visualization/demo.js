/* Template: an image, one slider, a processed result. Replace with your visualization. */
(function () {
  "use strict";

  var SIZE = 128;   // image side in pixels
  var SCALE = 3;    // on-screen enlargement
  var $ = function (id) { return document.getElementById(id); };

  var state = { image: null, sigma: 1.5 };

  function render() {
    var img = state.image;
    var out = Viz.blur(img.data, img.w, img.h, state.sigma);
    Viz.paintGray($("cIn"), img.data, img.w, img.h, { scale: SCALE });
    Viz.paintGray($("cOut"), out, img.w, img.h, { scale: SCALE });
    $("o-sigma").textContent = state.sigma.toFixed(1);
    $("readout").innerHTML = "<b>g</b> = G<sub>σ</sub> ∗ f &nbsp; with σ = " + state.sigma.toFixed(1);
  }

  function init() {
    var picker = Viz.imagePicker($("picker"), {
      samples: ["scene", "shapes", "coins", "text", "checker"],
      size: SIZE,
      onChange: function (img) {
        state.image = img;
        render();
      }
    });
    state.image = picker.image();

    $("sigma").addEventListener("input", function () {
      state.sigma = parseFloat($("sigma").value);
      render();
    });

    // For drawings that depend on theme colours use Viz.autoCanvas(canvas, { draw })
    // — it redraws on resize and when the palette changes.
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
