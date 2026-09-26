# SEO Content Manual Smoke Tests

Run the full B1 → B6 pipeline from the repository root:

```bat
test.cmd
```

The default fixture is `smoke-input.json`. To use a different input, pass its JSON path:

```bat
test.cmd testing\module-seo-content\local-input.json
```

Add `--no-open` when a browser should not be launched. A run writes `report.html`, `summary.json`, and available B6 WebP artifacts to `output/<timestamp>/`.

`local-input*.json`, `.env.local`, and `output/` are ignored. A fixture must provide `title`, `description`, `niche`, `handle`, and one or more `images`; each image needs either `url` or `localFilePath`. Set optional `siteDomain` to exercise homepage-based niche inference.
