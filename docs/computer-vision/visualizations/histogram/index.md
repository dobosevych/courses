---
title: Histogram
description: Point operations, contrast stretching and histogram equalization on an image histogram.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.2 · Affine transformation. Histogram. Edge detection</p>

# Histogram

A histogram counts how many pixels have each intensity. It ignores where the pixels are, yet it
tells you at a glance whether an image is dark, bright, flat or well exposed — and it is all you
need to fix the contrast.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Histogram — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Start with the **low contrast** input: the histogram is a narrow hill in the middle. Switch between
  *Contrast stretching* and *Equalization* and compare how each spreads it.
- In **Manual** mode move one slider at a time. Brightness shifts the histogram, contrast scales it
  around mid-gray, gamma bends it — watch pixels pile up at 0 or 255 when the curve is clipped.
- Pick **Underexposed** and fix it with gamma only, then with equalization. Which keeps the sky smooth?
- Hover over the image, or tap it on a phone: the orange marker follows that pixel through the transfer function and both
  histograms.
- Raise the **clip** percentage in contrast stretching and see how a few outliers stop limiting the range.

## The idea

All three operations are *point operations*: the new value of a pixel depends only on its old value,
\( s = T(r) \). They differ in how the transfer function \(T\) is chosen.

**Brightness, contrast, gamma** — you choose the curve yourself:

\[
s = 255 \left( \frac{c\,(r - 128) + 128 + b}{255} \right)^{\gamma}
\]

**Contrast stretching** — a straight line that maps the darkest and brightest pixels of the image to
0 and 255:

\[
s = 255 \cdot \frac{r - r_{\min}}{r_{\max} - r_{\min}}
\]

**Histogram equalization** — the transfer function is the cumulative distribution of the image itself,
so frequent intensities are pulled apart and rare ones are squeezed together:

\[
s = 255 \cdot \mathrm{CDF}(r) = 255 \sum_{k=0}^{r} \frac{h(k)}{N}
\]

After equalization the output CDF is close to a straight line, which is the same as saying that the
histogram is as flat as the discrete intensity levels allow.
