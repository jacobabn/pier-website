#!/usr/bin/env node
/* Inline fonts.css + styles.css into index.html and nl/index.html.
 * Eliminates the render-blocking /styles.css request and the third-party
 * fonts.googleapis.com / fonts.gstatic.com round trips on first paint.
 *
 * The HTML must contain markers:
 *   <!-- INLINE-CSS-START -->...<!-- INLINE-CSS-END -->
 * Everything between them is replaced on every build.
 *
 * styles.css is still written to disk so /blog/* pages (which use the
 * shared external stylesheet) keep working unchanged. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FONTS = fs.readFileSync(path.join(ROOT, 'src/fonts.css'), 'utf8');
const STYLES = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const INLINE = `<!-- INLINE-CSS-START -->
<style>${FONTS.trim()}\n${STYLES.trim()}</style>
<!-- INLINE-CSS-END -->`;

const MARKER = /<!-- INLINE-CSS-START -->[\s\S]*?<!-- INLINE-CSS-END -->/;

for (const rel of ['index.html', 'nl/index.html']) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, 'utf8');
  if (!MARKER.test(html)) {
    console.error(`!! ${rel}: missing INLINE-CSS markers, skipping`);
    continue;
  }
  fs.writeFileSync(file, html.replace(MARKER, INLINE));
  console.log(`   ${rel}: inlined ${(FONTS.length + STYLES.length) / 1024 | 0} KB`);
}
