---
title: Lens projections and distortion
description: How different lenses map straight and parallel lines — rectilinear and fisheye projections, barrel and pincushion distortion.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.1 · Camera Model. Filtering. Morphology</p>

# Lens projections and distortion

A lens is defined by how far from the image centre it places a ray that arrives at angle \(\theta\)
to the optical axis. An ordinary (rectilinear) lens keeps straight lines straight; a fisheye trades
that for a much wider view and bends them — in the stereographic case into exact arcs of circles.
The second part shows the polynomial model used to describe the small distortion of real lenses.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Lens projections and distortion — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Start with the **grid wall** and switch the projection from *Rectilinear* to each fisheye. The wall
  is flat and its lines are straight; only the lens changes.
- Click any line to **highlight** it. The dashed curve is the circle through three of its points.
  With the *stereographic* projection the line lies on that circle exactly; with the other fisheyes
  it drifts away from it by the amount shown.
- Pick a line that passes through the image centre. It stays straight in every model.
- Open the **corridor** or the **railway** and drag the view to look sideways. In a rectilinear image
  parallel lines meet at one vanishing point; in a fisheye they become curves that meet at two — one
  ahead and one behind you.
- Push the **field of view** up. The rectilinear lens stops at 150° and stretches the edges
  enormously on the way; most of the fisheyes go past 180° and show what is beside and behind the camera.
- In the second part move **k₁** below and above zero, then try the *Mustache* preset. Watch the
  straight edges of the grid and the checkerboard.

## The idea

**Projection models.** With \(f\) the focal length and \(\theta\) the angle between a ray and the
optical axis, the distance \(r\) of its image from the centre is

| Projection | Mapping | Straight lines become |
| --- | --- | --- |
| Rectilinear (perspective) | \(r = f \tan\theta\) | straight lines |
| Stereographic | \(r = 2f \tan(\theta/2)\) | arcs of circles |
| Equidistant | \(r = f\,\theta\) | curves close to circles |
| Equisolid | \(r = 2f \sin(\theta/2)\) | curves, bent more at the edge |
| Orthographic | \(r = f \sin\theta\) | arcs of ellipses |

All five agree near the axis, where \(\tan\theta \approx \sin\theta \approx \theta\); they differ in
how they treat the edge. \(\tan\theta\) grows without bound, so a rectilinear lens cannot reach a
180° field of view, while the fisheye mappings stay finite.

Seen from the camera, a straight line is part of a great circle on the sphere of viewing directions.
The stereographic projection maps every circle on that sphere to a circle in the image, which is why
its lines are exact circular arcs. Lines through the optical axis are great circles through the pole
and stay straight in every model.

**Radial distortion.** Real lenses deviate slightly from the ideal rectilinear mapping. The
Brown–Conrady model moves each ideal image point \((x, y)\) along its radius, with
\(r^2 = x^2 + y^2\):

\[
x_d = x\,(1 + k_1 r^2 + k_2 r^4), \qquad y_d = y\,(1 + k_1 r^2 + k_2 r^4)
\]

With \(k_1 < 0\) the magnification falls towards the edge and straight lines bow outwards (*barrel*);
with \(k_1 > 0\) it grows and they bow inwards (*pincushion*). Coefficients of opposite sign give a
wavy *mustache* shape. Camera calibration estimates \(k_1, k_2\) so that this warp can be undone.
In the demo \(r = 1\) at the corner of the image.
