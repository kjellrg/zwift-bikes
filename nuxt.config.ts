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
    name: 'Zwift Best Bike',
    description: 'Find the fastest Zwift bike for your needs. Compare weight, aerodynamics',
    url: 'https://zwiftbikes.photic.net'
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    preset: 'azure-swa',
    azure: {
      config: {
        globalHeaders: {
          'Referrer-Policy': 'strict-origin-when-cross-origin'
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
      // route, format and lap counts WTRL has actually published get a page -
      // `getPublishableRaces()` is the same source the sitemap uses.
      routes: [
        '/robots.txt',
        '/about',
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
        'lucide:mountain-snow'
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
