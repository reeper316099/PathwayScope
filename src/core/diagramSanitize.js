// Sanitizes Reactome's SVG export before it is inlined: no scripts, no foreign content, no external references.
import DOMPurify from 'dompurify';

// Reactome's embedded PNGs wrap their base64 text across lines, so whitespace is allowed inside the data.
export const DATA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;

// Returns a sanitized SVG string (empty string if nothing safe remains). Only embedded PNG data: images are kept.
export function sanitizeSvg(svgText, purifier = DOMPurify) {
  // Remove inline style attributes from the RAW text first: parsing them would itself trip our strict CSP (style-src).
  const text = svgText.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const hook = (node) => {
    for (const attr of ['href', 'xlink:href']) {
      const value = node.getAttribute?.(attr);
      if (value !== null && value !== undefined && !DATA_PNG.test(value))
        node.removeAttribute(attr);
    }
    node.removeAttribute?.('style'); // inline styles would be blocked by our CSP anyway
  };
  purifier.addHook('afterSanitizeAttributes', hook);
  try {
    return purifier.sanitize(text, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: [
        'script',
        'foreignObject',
        'style',
        'a',
        'use',
        'animate',
        'set',
        'animateTransform',
        'iframe',
        'object',
        'embed',
      ],
      FORBID_ATTR: ['style'],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ['xlink:href'],
    });
  } finally {
    purifier.removeHook('afterSanitizeAttributes', hook);
  }
}
