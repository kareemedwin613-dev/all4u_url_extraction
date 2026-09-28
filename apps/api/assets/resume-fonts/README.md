# Resume fonts

Pinned static Latin WOFF faces (regular 400, bold 700, italic 400) from Fontsource 5.3.0:

- Alegreya
- Amiri
- Lora
- Crimson Text
- Titillium Web

Download pattern: `https://cdn.jsdelivr.net/npm/@fontsource/<family>@5.3.0/files/<family>-latin-<weight>-<style>.woff`.
Each family's unmodified OFL-1.1 license is included next to the fonts. Fonts are embedded/subset by PDFKit; production rendering makes no external font requests. These are Latin faces, not full multilingual fallbacks.

The renderer resolves assets relative to its module so both `src/platform` and `dist/platform` work. Vercel explicitly bundles this directory. Keep these assets with the API when deploying outside Vercel too.
