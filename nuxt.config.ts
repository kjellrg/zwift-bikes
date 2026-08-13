// https://nuxt.com/docs/api/configuration/nuxt-config
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
        }
      }
    },
    prerender: {
      routes: ['/robots.txt']
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
