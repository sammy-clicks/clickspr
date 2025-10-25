// media-config.js
// Central place to configure a CDN/base URL for Media assets.
// Set MEDIA_BASE to your CDN or Cloudinary base (include trailing slash).
// Example Cloudinary base: 'https://res.cloudinary.com/<cloud_name>/image/upload/'
// Example CloudFront base: 'https://d111111.cloudfront.net/'
// Cloudinary base provided by you. Keep the trailing slash.
// This points to the 'clicks' folder in your Cloudinary upload path.
const MEDIA_BASE = 'https://res.cloudinary.com/drppscucj/image/upload/clicks/';

// Per-file map: if your uploaded files have different public IDs (filenames)
// than the local paths (for example Cloudinary appended hashes), add explicit
// mappings here so old local references (Media/xxx.png) resolve to the exact
// hosted URL.
const MEDIA_MAP = {
  // Local path : Full CDN URL
  'Media/vsj.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407027/vsj_drf2lg.png',
  'Media/loiza.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407027/loiza_xbmqxz.png',
  'Media/placita.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407027/placita_gakixy.png',
  'Media/condado.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407024/condado_jv3p7o.png',
  'Media/cerra.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407022/cerra_ibt9fn.png',
  'Media/crowd.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407022/crowd_d4oto8.png',
  'Media/logo.png': 'https://res.cloudinary.com/drppscucj/image/upload/v1761407020/logo_s05ued.png',
  'Media/home.mp4': 'https://res.cloudinary.com/drppscucj/video/upload/v1761407032/home_g9bpcf.mp4'
};

// Resolve a path that may be 'Media/...' into a CDN URL.
window.resolveMedia = function(path){
  if (!path) return path;
  if (typeof path !== 'string') return path;
  // If there's an explicit map for this path, return it (covers renamed uploads)
  if (MEDIA_MAP && MEDIA_MAP[path]) return MEDIA_MAP[path];

  if (path.startsWith('Media/')) {
    // Remove the Media/ prefix and join with MEDIA_BASE
    return MEDIA_BASE + path.replace(/^Media\//, '');
  }
  return path;
};

function rewriteElement(el){
  if (!el || el.nodeType !== 1) return;

  // Attributes to check
  ['src','poster','href','data-src'].forEach(attr => {
    try {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && v.startsWith('Media/')) {
        el.setAttribute(attr, window.resolveMedia(v));
      }
    } catch(e){}
  });

  // Inline style background-image (style property)
  try {
    const bg = el.style && el.style.backgroundImage;
    if (bg && bg.includes('Media/')){
      el.style.backgroundImage = bg.replace(/url\((['"]?)(Media\/[^'"\)]+)\1\)/g, (m, q, p) => `url(${window.resolveMedia(p)})`);
    }
  } catch(e){}

  // Inline style attribute (sometimes background-image is in attribute form)
  try {
    const s = el.getAttribute && el.getAttribute('style');
    if (s && s.includes('Media/')){
      el.setAttribute('style', s.replace(/url\((['"]?)(Media\/[^'"\)]+)\1\)/g, (m, q, p) => `url(${window.resolveMedia(p)})`));
    }
  } catch(e){}
}

function rewriteTree(root){
  root = root || document;
  // Find nodes that may contain media refs
  const nodes = root.querySelectorAll('[src], [poster], [style], [href], [data-src]');
  nodes.forEach(n => rewriteElement(n));
}

// Run initially and observe later changes (covers dynamic templates inserted by app.js)
document.addEventListener('DOMContentLoaded', function(){
  try { rewriteTree(document); } catch(e){}

  const mo = new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.type === 'childList' && m.addedNodes && m.addedNodes.length){
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1){
            rewriteElement(n);
            try { rewriteTree(n); } catch(e){}
          }
        });
      }
      if (m.type === 'attributes' && m.target){
        rewriteElement(m.target);
      }
    });
  });

  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','style','poster','href','data-src'] });
});

// Expose a small helper to convert server-returned paths in JS
window.mediaUrl = function(path){ return window.resolveMedia(path); };
