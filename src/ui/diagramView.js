// Pathway diagram: Reactome's SVG export, sanitized and inlined, with analysis overlay (when a token exists), zoom, pan and reset.
import { sanitizeSvg } from '../core/diagramSanitize.js';
import { links } from '../core/links.js';
import { getDiagramSvg } from '../core/reactomeContent.js';
import { getAncestors } from '../core/hierarchy.js';
import { emptyState, errorState, skeleton, warningNote } from './cards.js';
import { externalLink, h, setChildren } from './dom.js';
import { analysisOwners, getHierarchyOnce, state } from './state.js';

const ZOOM_STEP = 1.25;

// Creates a diagram panel in `root`. callbacks: { onOpenPathway(stId) } for "open the parent's diagram" buttons.
export function createDiagramView(root, { onOpenPathway }) {
  let controller = null;

  // Adds zoom/pan to a sanitized <svg> element by editing its viewBox (no libraries needed).
  function makeInteractive(svg, frame) {
    const base = svg
      .getAttribute('viewBox')
      ?.split(/[\s,]+/)
      .map(Number);
    const hasBox = base?.length === 4 && base.every(Number.isFinite);
    if (!hasBox) {
      const w = Number.parseFloat(svg.getAttribute('width'));
      const hgt = Number.parseFloat(svg.getAttribute('height'));
      if (!(w > 0 && hgt > 0)) return null;
      svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    }
    const [x0, y0, w0, h0] = hasBox ? base : svg.getAttribute('viewBox').split(/\s+/).map(Number);
    let view = { x: x0, y: y0, w: w0, h: h0 };
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.classList.add('diagram-svg');
    const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    // Zooms by a factor around a point given as fractions (0..1) of the frame.
    const zoom = (factor, fx = 0.5, fy = 0.5) => {
      const w = Math.min(w0 * 8, Math.max(w0 / 20, view.w / factor));
      const hh = (w / w0) * h0;
      view = { x: view.x + (view.w - w) * fx, y: view.y + (view.h - hh) * fy, w, h: hh };
      apply();
    };
    frame.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = frame.getBoundingClientRect();
        zoom(
          e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
          (e.clientX - r.left) / r.width,
          (e.clientY - r.top) / r.height,
        );
      },
      { passive: false },
    );
    let drag = null;
    frame.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      frame.setPointerCapture(e.pointerId);
      frame.classList.add('dragging');
    });
    frame.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = frame.getBoundingClientRect();
      view = {
        ...view,
        x: view.x - ((e.clientX - drag.x) / r.width) * view.w,
        y: view.y - ((e.clientY - drag.y) / r.height) * view.h,
      };
      drag = { x: e.clientX, y: e.clientY };
      apply();
    });
    const stop = () => {
      drag = null;
      frame.classList.remove('dragging');
    };
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('pointercancel', stop);
    return {
      zoomIn: () => zoom(ZOOM_STEP),
      zoomOut: () => zoom(1 / ZOOM_STEP),
      reset: () => {
        view = { x: x0, y: y0, w: w0, h: h0 };
        apply();
      },
    };
  }

  // Parses sanitized SVG text into an element (null if it is not valid SVG).
  function toElement(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return doc.querySelector('parsererror') ? null : document.importNode(doc.documentElement, true);
  }

  // Shows the diagram for a pathway. `opts.hasDiagram` decides whether one exists; `opts.name` labels it for screen readers.
  async function show(stId, { hasDiagram, name, owners = [] }) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    if (!hasDiagram) {
      setChildren(
        root,
        emptyState(
          'This pathway has no diagram of its own. Reactome shows its steps inside the diagram of a larger pathway.',
        ),
      );
      try {
        const hierarchy = await getHierarchyOnce();
        if (signal.aborted) return;
        const parents = [...getAncestors(hierarchy, stId)]
          .map((id) => hierarchy.nodes.get(id))
          .filter((n) => n.hasDiagram)
          .slice(0, 6);
        if (parents.length)
          root.append(
            h(
              'p',
              {},
              'Diagrams that contain it: ',
              parents
                .map((p) =>
                  h(
                    'button',
                    { class: 'link-btn', type: 'button', onclick: () => onOpenPathway(p.stId) },
                    p.name,
                  ),
                )
                .flatMap((b, i) => (i ? [', ', b] : [b])),
            ),
          );
      } catch {
        // The hint is optional; ignore hierarchy failures here.
      }
      return;
    }
    setChildren(root, skeleton(6));
    const token = state.session?.reactomeToken ?? null;
    let svgText;
    let overlay = Boolean(token);
    let overlayFailed = false;
    try {
      try {
        svgText = await getDiagramSvg(stId, {
          token,
          signal,
          owners: token ? [...owners, ...analysisOwners()] : owners,
        });
      } catch (error) {
        if (!token || signal.aborted) throw error;
        overlayFailed = true;
        overlay = false;
        svgText = await getDiagramSvg(stId, { signal, owners });
      }
      if (signal.aborted) return;
      const clean = sanitizeSvg(svgText);
      const svg = clean ? toElement(clean) : null;
      if (!svg) throw new Error('The diagram could not be displayed safely.');
      svg.setAttribute('role', 'img');
      svg.setAttribute(
        'aria-label',
        `Diagram of the pathway ${name}. A text list of its participants is shown in the participants table.`,
      );
      const frame = h(
        'div',
        {
          class: 'diagram-frame',
          tabindex: '0',
          'aria-label': 'Pathway diagram; drag to pan, scroll to zoom',
        },
        svg,
      );
      const controls = makeInteractive(svg, frame);
      setChildren(
        root,
        overlayFailed &&
          warningNote(
            'The analysis highlighting could not be loaded (the Reactome result may have expired), so the plain diagram is shown.',
          ),
        overlay &&
          h(
            'p',
            { class: 'note' },
            "Colors on the diagram are Reactome's highlighting of entities matching your analysis.",
          ),
        h(
          'div',
          { class: 'toolbar' },
          controls && [
            h(
              'button',
              {
                class: 'btn secondary',
                type: 'button',
                onclick: controls.zoomIn,
                'aria-label': 'Zoom in',
              },
              '＋',
            ),
            h(
              'button',
              {
                class: 'btn secondary',
                type: 'button',
                onclick: controls.zoomOut,
                'aria-label': 'Zoom out',
              },
              '－',
            ),
            h(
              'button',
              { class: 'btn secondary', type: 'button', onclick: controls.reset },
              'Reset view',
            ),
          ],
          externalLink(links.reactomePathway(stId), 'Open this diagram on Reactome'),
        ),
        frame,
      );
    } catch (error) {
      if (signal.aborted) return;
      setChildren(
        root,
        errorState(error, () => show(stId, { hasDiagram, name, owners })),
      );
    }
  }
  return {
    show,
    clear: () => {
      controller?.abort();
      setChildren(root);
    },
  };
}
