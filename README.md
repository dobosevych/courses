# Courses

Interactive visualizations that accompany the lectures, published as a website:

**https://dobosevych.github.io/courses/**

The site is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). Its visual
style (Catppuccin palette, Inter and JetBrains Mono, outline buttons) follows the
[APPS UCU Guidebook](https://ucuinn.github.io/APPS_UCU_GUIDEBOOK/).

## Layout

```
mkdocs.yml                      site configuration and navigation
docs/
  index.md                      landing page: list of courses
  stylesheets/                  site theme (extra.css, buttons.css, courses.css)
  assets/viz/                   viz kit shared by all visualizations (viz.css, viz.js)
  computer-vision/
    index.md                    course page: cards for every visualization
    visualizations/
      <name>/
        index.md                the page on the site: text, embedded demo, formulas
        demo.html               the visualization itself, a standalone page
        demo.js                 its code
templates/visualization/        starting point for a new visualization
```

Each course is one folder under `docs/` and one tab on the site.

## Run locally

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/mkdocs serve        # http://127.0.0.1:8000/courses/
```

A `demo.html` also opens directly from disk in a browser, which is the quickest way to work on one.

## Add a visualization

1. Copy `templates/visualization/` to `docs/<course>/visualizations/<name>/`.
2. Build the demo in `demo.html` and `demo.js`. Use the viz kit for the look and the helpers —
   theme colours, responsive canvases, test images, basic filtering. Its API is described at the
   top of `docs/assets/viz/viz.js`.
3. Write the page in `index.md`: a short introduction, what to try, the idea with formulas.
4. Add the page to `nav` in `mkdocs.yml` under its lecture, and a card to `docs/<course>/index.md`.

The demo is embedded in the page as an `<iframe>`. The kit keeps the frame as tall as its content
and switches the demo to the palette selected on the site, so a demo needs no code for either.
Because a demo is a standalone page, it can also be opened full screen during a lecture or embedded
elsewhere, for example in Moodle.

## Add a course

Create `docs/<course>/index.md`, add a top-level entry for it to `nav` in `mkdocs.yml`, and a card
to `docs/index.md`.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the site with
`mkdocs gh-deploy --strict` and pushes the result to the `gh-pages` branch. GitHub Pages serves
that branch. The strict build fails on broken links and missing pages, so check locally with
`mkdocs build --strict` before pushing.
