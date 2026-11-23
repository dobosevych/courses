---
title: Canny step by step
description: The Canny edge detector one stage at a time — smoothing, gradient, non-maximum suppression, double threshold and hysteresis.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.2 · Affine transformation. Histogram. Edge detection</p>

# Canny step by step

Canny is not one filter but a pipeline: each stage repairs a weakness of the one before it. Step
through the stages on the same image and watch thick, noisy gradient ridges turn into thin,
connected contours.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Canny step by step — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Walk through the stages with **Next** (or the ← → keys). The filmstrip keeps every stage in view,
  so you can see where a detail appears or is lost.
- At **Non-max suppression**, hover over a thick ridge. The loupe marks the two neighbours along the
  gradient direction; only the largest of the three survives, which is why the edge becomes one pixel wide.
- At **Double threshold**, lower the *low* threshold: more orange (weak) pixels appear. Then go to
  **Hysteresis** — the ones attached to a white contour turn green and stay, the isolated ones turn red
  and are dropped.
- Set low equal to high. Now there are no weak pixels and Canny degenerates into a single threshold:
  compare the gaps in the result.
- Add **noise** and step through again. Then raise **σ** until the noise is gone and notice what
  else you lost — small details and sharp corners.
- At the **Gradient** stage tick *Colour by rounded gradient direction* to see the four directions that
  non-maximum suppression works with.

## The idea

**1 · Smoothing.** A derivative amplifies noise, so the image is first blurred with a Gaussian:

\[
f_\sigma = G_\sigma * f
\]

**2 · Gradient.** Sobel filters give the two derivatives, and from them the strength and direction of
the change at every pixel:

\[
|G| = \sqrt{G_x^2 + G_y^2}, \qquad \theta = \operatorname{atan2}(G_y,\; G_x)
\]

**3 · Non-maximum suppression.** The gradient magnitude forms a ridge a few pixels wide across every
edge. The direction \(\theta\) is rounded to 0°, 45°, 90° or 135°, and a pixel \(p\) is kept only if it
is the crest of the ridge:

\[
|G|(p) \ge |G|(p^{+}) \quad\text{and}\quad |G|(p) \ge |G|(p^{-})
\]

where \(p^{+}\) and \(p^{-}\) are its two neighbours along the rounded direction. (The demo breaks
a tie towards one side, so a flat-topped ridge still leaves a single line.)

**4 · Double threshold.** Two thresholds \(T_\text{low} \le T_\text{high}\) sort the remaining pixels
into strong (\(|G| \ge T_\text{high}\)), weak (\(T_\text{low} \le |G| < T_\text{high}\)) and discarded.
In the demo both are given as a percentage of the largest gradient magnitude in the image.

**5 · Hysteresis.** Strong pixels are edges. A weak pixel becomes an edge only if a chain of
neighbouring weak pixels (8-neighbourhood) connects it to a strong one. This keeps the faint
continuation of a real contour and removes isolated responses of the same strength that are just noise.
