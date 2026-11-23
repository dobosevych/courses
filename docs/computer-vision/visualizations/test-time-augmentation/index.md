---
title: Test-time augmentation
description: Average a classifier's predictions over transformed copies of the input and measure the gain in accuracy.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.2 · Affine transformation. Histogram. Edge detection</p>

# Test-time augmentation

Augmentation is usually applied while training. Test-time augmentation (TTA) applies it at
prediction time: transform the test image in several label-preserving ways, predict on every copy,
and average the answers. Below, a small network is trained in your browser and TTA is measured on
600 test images it has never seen.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Test-time augmentation — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Press **An image TTA fixes** a few times. The original view is wrong, but most transformed views
  are right, so the average recovers the true class.
- Press **An image TTA breaks**. TTA is not a free lunch for every image — it wins on balance, and
  the table counts both directions.
- Turn on **Augment while training**. Single-view accuracy rises and the gain from TTA shrinks: the
  model has already learned to tolerate these transforms.
- Move **Training images** to 2000. The better the model, the less TTA has left to fix.
- Leave only **Flip** checked: the cheapest TTA, two forward passes. Then add groups one by one and
  watch the curve flatten — each extra view helps less than the previous one.
- Press **New data** several times. The gain changes from run to run, so a single run is not a
  result; an average over runs is.

## The idea

For transforms \(t_1, \dots, t_K\) that do not change the label, the prediction is the average of
the model's outputs on the transformed inputs:

\[
\hat{p}(y \mid x) = \frac{1}{K} \sum_{k=1}^{K} p\big(y \mid t_k(x)\big)
\]

It helps because the model is not perfectly invariant: a one-pixel shift or a small rotation changes
its output a little, and sometimes changes the decision. Each view is a slightly different, noisy
estimate of the same answer. If every estimate has variance \(\sigma^2\) and any two are correlated
with coefficient \(\rho\), the average has variance

\[
\sigma^2 \left( \rho + \frac{1 - \rho}{K} \right)
\]

which falls quickly for the first few views and then levels off at \(\rho\,\sigma^2\) — the shape of
the curve in the visualization. Views that fail in the same way are correlated, and averaging
cannot remove an error they all share.

## What the numbers say

Measured with the default settings of this visualization (400 training images, noise 0.25, all
12 views, averaged over 8 different random draws of the data):

| Training | Single view | TTA, 12 views | Gain |
|---|---|---|---|
| Without augmentation | 78.4% | 84.3% | +5.9 pp |
| With augmentation | 87.9% | 90.1% | +2.3 pp |
| With augmentation, 2000 images | 95.2% | 96.5% | +1.3 pp |

Two things to take away. The gain is real but modest, and it is largest for a weak or overfitted
model. And it costs \(K\) forward passes per image, so in practice a few cheap views — a flip and
a couple of shifts or scales — give most of the benefit.

This is a toy problem: six shapes on 16×16 images and a network with one hidden layer make the
experiment fast enough to run live. The mechanism is the same for real models, but the size of the
gain depends on the model, the data and the transforms — measure it on your own validation set.
