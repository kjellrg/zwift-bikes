<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The page a wrong URL lands on. Without this file Nuxt renders its own
 * stock error page: no `lang` on the document (a serious accessibility
 * violation, see `tests/browser/accessibility.spec.ts`), a "| Nuxt" title,
 * and none of the site's shell or Colour mode. This one keeps the answer
 * short - what went wrong, and the three places a rider can go from here -
 * and stays out of the index: a not-found page has nothing to rank for.
 *
 * `error.vue` replaces `app.vue` at the root, so the head that `app.vue`
 * sets (`lang`, icons, viewport) is set again here. The links are full
 * navigations rather than router links on purpose: an error page's state
 * lives until `clearError`, and a plain `href` clears it by leaving.
 */
const props = defineProps<{ error: NuxtError }>()

const status = computed(() => props.error.statusCode ?? 500)
const heading = computed(() => status.value === 404
  ? (props.error.statusMessage || 'Page not found')
  : 'Something went wrong')
const explanation = computed(() => status.value === 404
  ? 'There is nothing at this address. The route, segment or race may have been renamed, or the link may be out of date.'
  : 'The page could not be rendered. Try again in a moment, or head back to the routes.')

useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
  ],
  htmlAttrs: { lang: 'en' }
})
useSeoMeta({ title: () => `${status.value} - ${heading.value} - ZwiftBikes` })
// Same reasoning as `/profile`: the module owns the single robots tag.
useRobotsRule('noindex, follow')
</script>

<template>
  <UApp>
    <div class="flex min-h-screen flex-col">
      <header class="border-b border-default">
        <UContainer class="flex h-16 items-center">
          <a href="/">
            <AppLogo />
          </a>
        </UContainer>
      </header>

      <main
        id="main"
        class="flex flex-1 items-center"
      >
        <UContainer class="max-w-2xl py-10 space-y-6">
          <p class="text-sm font-semibold uppercase tracking-wide text-muted">
            {{ status }}
          </p>
          <h1 class="text-3xl font-bold text-highlighted">
            {{ heading }}
          </h1>
          <p class="text-muted">
            {{ explanation }}
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              to="/"
              external
              icon="i-lucide-route"
              label="Routes"
            />
            <UButton
              to="/segments"
              external
              color="neutral"
              variant="outline"
              icon="i-lucide-mountain"
              label="Segments"
            />
            <UButton
              to="/events"
              external
              color="neutral"
              variant="outline"
              icon="i-lucide-calendar-days"
              label="Events"
            />
          </div>
        </UContainer>
      </main>
    </div>
  </UApp>
</template>
