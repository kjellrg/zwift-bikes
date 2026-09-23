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
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    // The one font file, fetched before the stylesheet that names it is
    // parsed, so the first paint is already in Archivo rather than a
    // fallback that reflows when it swaps.
    { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/archivo-variable.woff2', crossorigin: 'anonymous' }
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
      <!-- The shell's own header, minus what needs the app's overlays: the
           wordmark, the three sections and the Colour mode toggle. -->
      <header class="border-b border-default bg-default/90">
        <UContainer class="flex h-(--ui-header-height) items-center gap-6">
          <a
            href="/"
            aria-label="ZwiftBikes home"
          >
            <AppLogo />
          </a>
          <nav
            aria-label="Sections"
            class="hidden items-center gap-1 sm:flex"
          >
            <a
              href="/"
              class="px-3 py-2 text-md text-toned hover:text-highlighted"
            >Routes</a>
            <a
              href="/segments"
              class="px-3 py-2 text-md text-toned hover:text-highlighted"
            >Segments</a>
            <a
              href="/events"
              class="px-3 py-2 text-md text-toned hover:text-highlighted"
            >Events</a>
          </nav>
          <UColorModeButton
            color="neutral"
            variant="outline"
            class="ml-auto"
          />
        </UContainer>
      </header>

      <main
        id="main"
        class="flex flex-1 items-center"
      >
        <UContainer class="max-w-2xl py-10 space-y-5">
          <p class="text-sm text-muted">
            Error {{ status }}
          </p>
          <h1 class="text-3xl font-bold font-display text-highlighted">
            {{ heading }}
          </h1>
          <p class="text-toned">
            {{ explanation }}
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              to="/"
              external
              label="Browse routes"
            />
            <UButton
              to="/segments"
              external
              color="neutral"
              variant="outline"
              label="Segments"
            />
            <UButton
              to="/events"
              external
              color="neutral"
              variant="outline"
              label="Events"
            />
          </div>
        </UContainer>
      </main>
    </div>
  </UApp>
</template>
