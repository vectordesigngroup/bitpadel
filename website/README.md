# BitPadel website

The project site published at <https://vectordesigngroup.github.io/bitpadel/>.

Plain HTML and CSS with a few lines of JavaScript (mobile menu and copy buttons). There is no build step.

- `index.html`: the whole page
- `styles.css`: dark theme, Bitcoin orange and padel green accents
- `assets/`: favicon, Open Graph image, and compressed copies of the promo posters from `media/promos/`

Preview locally: open `index.html` in a browser, or run `python3 -m http.server -d website 8000` from the repo root and visit <http://localhost:8000>.

Deploys are meant to run from a GitHub Actions workflow (`.github/workflows/pages.yml`, added separately) on pushes to `main` that touch `website/**`. Pages must be set to **Source: GitHub Actions** in the repository settings first.

Every claim on the page should match the repository. Don't add prices, user counts, testimonials or club-specific plans.
