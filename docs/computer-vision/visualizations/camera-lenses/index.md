---
title: Camera and lenses
description: One scene through different focal lengths — field of view, sensor size and the dolly zoom.
hide:
  - toc
---

<p class="viz-lecture">Lecture 1.1 · Camera Model. Filtering. Morphology</p>

# Camera and lenses

A lens does not change the scene, only how much of it lands on the sensor. The focal length sets the
field of view; where the camera stands sets the perspective. Here one scene — a person, lamp posts
10 m apart, trees and a building 70 m further back — is projected with the pinhole model for any
focal length, sensor and camera distance.

<div class="viz-embed">
  <iframe class="viz-frame" src="demo.html" title="Camera and lenses — interactive visualization"></iframe>
</div>

<div class="viz-actions" markdown>
[:material-fullscreen: Open full screen](demo.html){ .md-button target="_blank" }
</div>

## What to try

- Drag the **focal length** from 14 to 200 mm without moving the camera. Nothing changes shape: a
  longer lens shows a smaller part of the same picture, enlarged. The strip of prime lenses shows
  all seven crops at once — click one to mount it.
- Watch the green wedge in the **top-down plan**. Its opening angle is the field of view; whatever
  is inside it reaches the sensor.
- Switch the **sensor** to APS-C or phone-size and keep the focal length. The dashed frames in the
  camera view show what the smaller sensors cut out: the same lens frames like a longer one.
- Tick **Keep the subject the same size** and zoom again. Now the camera moves back as the lens gets
  longer. The person stays put, the building grows and the lamp posts stack up behind each other —
  the "compression" of a telephoto shot comes from the distance, not from the lens.
- With the toggle on, compare the 14 mm and 200 mm tiles: the same subject, a very different background.

## The idea

A pinhole camera maps a point \((X, Y, Z)\) in front of it to the sensor by similar triangles, where
\(f\) is the focal length and \(Z\) the depth along the optical axis:

\[
x = f\,\frac{X}{Z}, \qquad y = f\,\frac{Y}{Z}
\]

An object of height \(H\) at distance \(Z\) is therefore \(f H / Z\) tall on the sensor: twice the
focal length or half the distance gives twice the size.

The sensor has a fixed width \(w\), so only rays within a certain angle land on it. That angle is the
**field of view**:

\[
\mathrm{FOV} = 2 \arctan\!\left(\frac{w}{2f}\right)
\]

For a 50 mm lens on a 36 mm wide full-frame sensor this is \(2\arctan(36/100) \approx 39.6^\circ\).
A smaller sensor behind the same lens sees a smaller angle; the ratio of the sensor diagonals is the
*crop factor*, and \(f \times \text{crop}\) is the full-frame focal length with the same framing.

At distance \(Z\) the frame covers a width of \(w Z / f\). Keeping \(f / Z\) constant for the subject
(the dolly zoom) keeps its size, but the background at \(Z + \Delta\) is magnified by
\(f / (Z + \Delta)\), which grows as the camera moves back and the lens gets longer. Perspective —
the relative size of near and far things — depends only on where the camera is.
