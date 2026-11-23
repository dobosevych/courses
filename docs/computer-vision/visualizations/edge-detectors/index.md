---
title: Edge detectors
description: Roberts, Prewitt, Sobel, Scharr, Laplacian and Laplacian of Gaussian side by side — kernels, responses and edge maps.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.2 · Affine transformation. Histogram. Edge detection</p>

# Edge detectors

An edge is a place where the intensity changes quickly. Every classical detector measures that
change with a small kernel; they differ in which derivative they take, how many pixels they average
and, as a result, how they react to noise. Pick an operator and follow one pixel through the arithmetic.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Edge detectors — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Hover over the image. The panel below multiplies the pixels under the kernel by its weights and
  sums them — that sum is the value you see in the response panes.
- Choose the **Checkerboard** and put the cursor on a vertical border: Sobel gives
  \(G_x = 4 \cdot (214 - 42) = 688\) and \(G_y = 0\). Move to a horizontal border and the two swap.
- Raise the **noise** and watch the strip at the bottom. The Laplacians dissolve into noise first,
  Roberts next; Prewitt, Sobel and Scharr hold longer; LoG with a larger σ stays the cleanest.
- Switch to a **Laplacian**: there is no direction any more, only a signed response. Edges are where
  it changes sign — compare *All zero-crossings* with the thresholded *Edges*.
- Add **blur before the operator** to a noisy image and compare the result with LoG. Blurring first
  and differentiating second is exactly what the LoG kernel does in one step.
- Look at the row plot while crossing an edge: the first derivative peaks, the second one passes
  through zero.

## The idea

**Gradient operators** estimate the two first derivatives with a pair of kernels and combine them:

\[
|G| = \sqrt{G_x^2 + G_y^2}, \qquad \theta = \operatorname{atan2}(G_y,\; G_x)
\]

The magnitude says how strong the edge is; the direction \(\theta\) points across the edge, towards the
brighter side. The horizontal kernels are

\[
\underbrace{\begin{bmatrix} 1 & 0 \\ 0 & -1 \end{bmatrix}}_{\text{Roberts}}
\qquad
\underbrace{\begin{bmatrix} -1 & 0 & 1 \\ -1 & 0 & 1 \\ -1 & 0 & 1 \end{bmatrix}}_{\text{Prewitt}}
\qquad
\underbrace{\begin{bmatrix} -1 & 0 & 1 \\ -2 & 0 & 2 \\ -1 & 0 & 1 \end{bmatrix}}_{\text{Sobel}}
\qquad
\underbrace{\begin{bmatrix} -3 & 0 & 3 \\ -10 & 0 & 10 \\ -3 & 0 & 3 \end{bmatrix}}_{\text{Scharr}}
\]

and the vertical ones are their transposes (for Roberts, the other diagonal). Each 3×3 kernel is a
difference in one direction multiplied by an average in the other: equal weights for Prewitt, 1-2-1
for Sobel, 3-10-3 for Scharr. Roberts averages nothing, which is why it is the noisiest.

**The Laplacian** takes the second derivative in both directions with a single kernel:

\[
\nabla^2 f = \frac{\partial^2 f}{\partial x^2} + \frac{\partial^2 f}{\partial y^2}
\qquad
\begin{bmatrix} 0 & 1 & 0 \\ 1 & -4 & 1 \\ 0 & 1 & 0 \end{bmatrix}
\quad\text{or}\quad
\begin{bmatrix} 1 & 1 & 1 \\ 1 & -8 & 1 \\ 1 & 1 & 1 \end{bmatrix}
\]

It is positive on one side of an edge and negative on the other, so the edge itself is the
zero-crossing. A second derivative amplifies noise even more than a first one, and noise produces
zero-crossings everywhere — the demo keeps only the crossings where the response jumps by more than
the threshold.

**Laplacian of Gaussian** smooths first and differentiates second, in one kernel:

\[
\mathrm{LoG}(x, y) = \frac{x^2 + y^2 - 2\sigma^2}{\sigma^4}\; e^{-\frac{x^2 + y^2}{2\sigma^2}}
\]

The scale \(\sigma\) decides which edges exist at all: small \(\sigma\) keeps fine detail, large
\(\sigma\) keeps only the outlines of big structures.
