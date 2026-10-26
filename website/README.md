# BitPadel website

The project site published at <https://vectordesigngroup.github.io/bitpadel/>.

Plain HTML and CSS with a few lines of JavaScript (mobile menu and copy buttons). There is no build step.

- `index.html`: the whole page
- `styles.css`: dark theme, Bitcoin orange and padel green accents
- `sell-sheets/`: three one-page sell sheets (HTML plus a US Letter PDF of each), and an index page. The HTML is the source. Regenerate a PDF from the `website/` directory with headless Chrome, which applies the print CSS: `google-chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=sell-sheets/club-overview.pdf sell-sheets/club-overview.html` (same for `payments` and `access`).
- `assets/`: favicon, Open Graph image, and compressed copies of the promo posters from `media/promos/`
- `assets/video/`: copies of the promo MP4s from `media/promos/` (16:9 and 9:16), played in the Videos section. If a promo is re-rendered, copy the new MP4 here too.

Preview locally: open `index.html` in a browser, or run `python3 -m http.server -d website 8000` from the repo root and visit <http://localhost:8000>.

The live site is currently published from the `gh-pages` branch, which holds a copy of this folder plus an empty `.nojekyll` file. After changing `website/` on `main`, copy it to `gh-pages` again. A GitHub Actions workflow (`.github/workflows/pages.yml`) can automate this later; Pages would then need **Source: GitHub Actions** in the repository settings.

Every claim on the page should match the repository. Don't add prices, user counts, testimonials or club-specific plans.
