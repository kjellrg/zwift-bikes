# og-image

How the static brand images in `public/` are made: `og-image.png`, the
default social-share (Open Graph / Twitter card) image for the pages that
set none of their own (garage, profile, report), and the favicon and touch
icon. Home, about, route, segment and event pages define generated
nuxt-og-image cards instead (issue #59), and all of them are drawn in the
night Palette with the profile-shaped mark (issue #257).

## `og-image.png`

It is the generated site card (`app/components/OgImage/SiteCard.takumi.vue`)
rendered once and kept as a file, so the fallback and the generated cards
cannot drift apart. With the dev server running (`npm run dev`), take the
card URL the about page advertises and save what it serves:

```sh
url=$(curl -s http://localhost:3000/about | grep -o 'property="og:image" content="[^"]*"' \
  | sed 's/.*content="//; s/"$//; s#^https\?://[^/]*##; s/&amp;/\&/g')
curl -s "http://localhost:3000$url" -o public/og-image.png
```

## `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`

`public/favicon.svg` is the source: the wordmark's profile-shaped mark in
the primary on the dark ground. The ICO (16 and 32 px) and the 180 px touch
icon are rasterised from it - the touch icon square-cornered, since iOS
applies its own mask. ImageMagick's fallback SVG renderer is enough for
these shapes:

```sh
magick -density 1200 -background none public/favicon.svg -resize 16x16 /tmp/fav16.png
magick -density 1200 -background none public/favicon.svg -resize 32x32 /tmp/fav32.png
magick /tmp/fav16.png /tmp/fav32.png public/favicon.ico
sed 's/rx="7"/rx="0"/' public/favicon.svg | magick -density 1200 -background none - -resize 180x180 public/apple-touch-icon.png
```
