# og-image

Source for `public/og-image.png`, the default social-share (Open Graph /
Twitter card) image used by pages that don't set their own — garage,
profile and report. Home, about, route, segment and event pages define
generated nuxt-og-image cards instead (issue #59).

1200x630 (the standard `summary_large_image` ratio), styled after the app:
slate-900 background, the lucide `bike` header icon, and the Nuxt UI green
(`#C6F135`) from `app/assets/css/main.css`.

## Regenerating

`og-image.svg` is the source of truth for the layout, but ImageMagick's
fallback MSVG renderer (used when `rsvg-convert` isn't installed, as in the
devcontainer) silently drops `<circle>`/`<path>` elements and group
transforms - only `<rect>` and `<text>` survive. The icon and corner arcs
are therefore drawn twice: once in the SVG (for renderers that can handle
it) and once as `-draw` primitives layered on top, with the same
coordinates. Keep the two in sync when editing.

```sh
magick scripts/og-image/og-image.svg -depth 8 \
  -fill none -stroke '#1B2F2A' -strokewidth 4 \
  -draw "circle -40,640 -40,310" \
  -draw "circle -40,640 -40,380" \
  -draw "circle 1240,-10 1240,320" \
  -draw "circle 1240,-10 1240,250" \
  -fill none -stroke '#C6F135' -strokewidth 16 \
  -draw "stroke-linecap round stroke-linejoin round circle 652,212 652,184" \
  -draw "stroke-linecap round stroke-linejoin round circle 548,212 548,184" \
  -draw "stroke-linecap round stroke-linejoin round circle 624,112 624,104" \
  -draw "stroke-linecap round stroke-linejoin round path 'M 600,212 L 600,184 L 576,160 L 608,136 L 624,160 L 640,160'" \
  public/og-image.png
```

(With a proper SVG renderer installed the `-draw` layers are harmless - they
paint the same shapes over themselves.)
