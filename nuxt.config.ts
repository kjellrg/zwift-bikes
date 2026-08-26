// https://nuxt.com/docs/api/configuration/nuxt-config
import { getRoutesWithMeta } from './shared/utils/catalog'
import { getPublishableRaces, getSeasons } from './shared/utils/events'
import { getAllSegmentSummaries } from './shared/utils/routeSegments'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxtjs/sitemap',
    '@nuxtjs/robots',
    'nuxt-og-image'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  site: {
    name: 'ZwiftBikes',
    description: 'Find the fastest bike and wheelset for any Zwift route, ranked by predicted finish time for your rider profile.',
    url: 'https://zwiftbikes.com'
  },

  runtimeConfig: {
    public: {
      /**
       * Short commit the site was built from, shown in the "app context"
       * block of a bug report (see `useReportContext`) so a report can be
       * tied to a build - there are no released versions, only whatever is
       * currently on `main`.
       *
       * Resolved here, at build time, rather than left to a runtime env
       * lookup: the SSR function on Azure has no `GITHUB_SHA` in its
       * environment, so a runtime-only value would be empty for every page
       * that isn't prerendered. Reading it in this file inlines it as the
       * default instead, which prerendered pages and the SSR function then
       * both carry. Fed by the `env:` block on the deploy workflow's build
       * step, which Azure's action forwards into the Oryx build container.
       *
       * Deliberately `BUILD_SHA` and not `NUXT_PUBLIC_BUILD_SHA`: Nuxt
       * applies `NUXT_PUBLIC_*` variables over the resolved config value
       * automatically, which would hand the raw 40-character SHA straight to
       * the app and skip the `slice()` below entirely. Keeping the variable
       * out of that namespace leaves this expression the only thing that
       * decides the value.
       */
      buildSha: (process.env.BUILD_SHA || process.env.GITHUB_SHA || '').slice(0, 7)
    }
  },

  routeRules: {
    '/': { prerender: true },
    // The catalog endpoints serve data that only changes on deploy, so
    // browsers (and any proxy in front) may cache them briefly instead of
    // invoking the SSR function for every repeated fetch. Exact-path rules on
    // purpose: the slug and recommend endpoints stay uncached. Applied at
    // runtime inside the Nitro app. Deliberately NOT Nitro `swr`/`cache`
    // rules: that cache is per-instance memory, all correctness risk for
    // almost no win over plain browser caching.
    '/api/routes': { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } },
    '/api/bikes': { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } },
    '/api/segments': { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } },
    '/api/wheelsets': { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    preset: 'cloudflare_module',
    prerender: {
      // Route pages are the site's landing pages and its slowest responses:
      // served from the SSR function they measure ~1.7s TTFB (vs ~0.2s for
      // the prerendered homepage), which puts them well past Google's 0.8s
      // "good" threshold and eats most of the 2.5s LCP budget before a byte
      // is rendered. They prerender cleanly because the server-rendered pass
      // uses the default rider profile either way - the real profile lives in
      // localStorage and is applied on hydration.
      //
      // Enumerated from the same catalog the sitemap source uses
      // (server/api/__sitemap__/urls.ts) so the two can't drift.
      //
      // /segments/** joined the list once the old `?route=` param (which
      // made prerendering unsafe - a static file answers by path, ignoring
      // the query) was removed (issue #56). TTFB alone hadn't justified the
      // build-time cost, but build-time OG cards require the page to be
      // prerendered (zeroRuntime renders cards only during the prerender
      // pass - an un-prerendered page with `defineOgImage` ships an orphaned
      // 404 og:image), and that tipped it (issue #59 phase 2).
      //
      // Event pages prerender for the same reasons as routes: they take no
      // query parameters at all. Only races whose route, format and lap
      // counts the organiser has actually published get a page -
      // `getPublishableRaces()` is the same source the sitemap uses.
      routes: [
        '/robots.txt',
        '/about',
        '/report',
        '/events',
        ...getSeasons().map(season => `/events/${season.slug}`),
        ...getPublishableRaces().map(race => race.path),
        ...getRoutesWithMeta().map(route => `/routes/${route.slug}`),
        ...getAllSegmentSummaries().map(segment => `/segments/${segment.slug}`)
      ]
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  icon: {
    clientBundle: {
      // `scan` defaults to `false`, so without this the client bundle only
      // ever contained Nuxt UI's own small set of internal icons (chevrons,
      // checkmarks, etc.) - none of this app's own icon usage (mountain,
      // bike, database, github, ...), literal or otherwise, was ever
      // bundled. Unbundled icons fall back to a runtime fetch from
      // Iconify's API, which fails without outbound network access and was
      // crashing app initialization (NUXT_E1005 -> Error500) under load
      // (the sitemap's zeroRuntime prerender crawl hits nearly every icon
      // in the app back-to-back). Scanning bundles every icon reachable as
      // a literal string across app/shared source.
      scan: true,
      // Icons only ever reached via a Record/object lookup (e.g.
      // `SURFACE_TYPE_ICONS[surface]` in app/utils/labels.ts, consumed by
      // RouteSurfaceComposition.vue, RouteSurfaceSpeedProfile.vue and
      // SurfaceBadges.vue) aren't literal strings in the source, so `scan`
      // can't find them either - list them explicitly.
      icons: [
        'lucide:road',
        'lucide:brick-wall',
        'lucide:fence',
        'lucide:grip',
        'lucide:snowflake',
        'lucide:footprints',
        'lucide:sprout',
        'lucide:waves',
        'lucide:stone',
        'lucide:mountain-snow',
        // `POWERUP_ICONS` in app/utils/labels.ts - object lookup, invisible
        // to `scan`, rendered by the event race pages' powerup badges.
        'lucide:feather',
        'lucide:wind',
        'lucide:truck',
        'lucide:ghost',
        'lucide:anvil',
        'lucide:tractor',
        'lucide:sandwich'
      ]
    }
  },

  ogImage: {
    // Every page that defines a card (routes, segments, events, home, about)
    // is in the prerender list above, so the cards render at build time and
    // ship as static assets - nothing (no Wasm renderer, no font loading)
    // lands in the Worker bundle. That coupling is load-bearing: a page with
    // `defineOgImage` that is NOT prerendered would ship an og:image URL
    // whose asset was never generated (the module warns about "orphaned OG
    // image" hashes at prerender:done).
    zeroRuntime: true,
    // 1200x630 (not the module's 1200x600 default): the documented OG size
    // every large-card scraper (Facebook, Discord, Slack, X) crops to.
    defaults: {
      width: 1200,
      height: 630
    }
  },

  sitemap: {
    sources: ['/api/__sitemap__/urls'],
    zeroRuntime: true,
    // Static app routes are auto-discovered, which swept these two in. Both
    // render purely from localStorage and are marked `noindex` in-page, so
    // submitting them here would just ask Google to crawl a URL we then tell
    // it to drop.
    exclude: ['/profile', '/garage']
  }
})
