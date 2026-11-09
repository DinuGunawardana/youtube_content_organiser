# AdSense verification update

The root layout now includes both:
- `google-adsense-account` meta verification tag for `ca-pub-2741821782196575`
- AdSense library script in the initial document head using Next.js `beforeInteractive`

The manual display ad placement remains conditional on `NEXT_PUBLIC_ADSENSE_LIBRARY_SLOT_ID`.
Set that variable in Netlify only after creating a Display ad unit in AdSense.

The publisher ID is public and intentionally appears in the page source. Do not treat it as a private API key.
