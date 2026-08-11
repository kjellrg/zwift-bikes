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
    name: 'Zwift Bikes',
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

  sitemap: {
    sources: ['/api/__sitemap__/urls'],
    zeroRuntime: true
  }
})
