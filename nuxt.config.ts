// https://nuxt.com/docs/api/configuration/nuxt-config
import { getRoutesWithMeta } from './shared/utils/catalog'
import { getPublishableRaces, getSeasons } from './shared/utils/events'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxtjs/sitemap',
    '@nuxtjs/robots'
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
    azure: {
      config: {
        globalHeaders: {
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        },
        platform: {
          // Pinned explicitly because the preset can't pick this itself: it
          // only recognizes node 16/18/20 (see `writeSWARoutes` in
          // nitropack's azure preset), matched against `engines.node` or the
          // local node version, and falls back to `node:18` when neither is
          // in that set - which is what it was writing here. Azure ended
          // support for `node:18` on 2025-05-31; `node:22` is supported with
          // no announced end-of-support date, and is the current Node LTS.
          // The preset spreads this object last, so it wins over that default.
          apiRuntime: 'node:22'
        },
        // Without this, SWA serves /routes/x, /routes/x/ and
        // /routes/x/index.html all as 200s - three URLs, one page. `never`
        // 301s the latter two onto the first, which is the form every
        // internal link and the sitemap already use, and the form the
        // canonical tag in app.vue emits.
        trailingSlash: 'never'
      }
    },
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
      // /segments/** is deliberately NOT prerendered: those pages take a
      // `?route=` param that tailors the ranking to one route's surface data,
      // and SWA matches static files by path only (ignoring the query), so a
      // prerendered segment page would answer `?route=` requests with the
      // generic ranking and - because the page fetches with `watch: false` -
      // never correct itself on the client.
      //
      // Event pages prerender for the same reasons and with the same caveat
      // handled: they take no query parameters at all, so the `?route=`
      // problem that keeps /segments/** dynamic can't arise. Only races whose
      // route, format and lap counts the organiser has actually published get
      // a page - `getPublishableRaces()` is the same source the sitemap uses.
      routes: [
        '/robots.txt',
        '/about',
        '/report',
        '/events',
        ...getSeasons().map(season => `/events/${season.slug}`),
        ...getPublishableRaces().map(race => race.path),
        ...getRoutesWithMeta().map(route => `/routes/${route.slug}`)
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
