<script setup>
// Every nav/footer entry below keeps a real `href` so crawlers can reach the
// page version (an Overlay's content is never server-rendered - see
// `CONTEXT.md`) and so cmd/ctrl-click still opens it in a new tab - but a
// plain left click shows the overlay instead of navigating away. They're
// plain `<a>`s rather than ULinks: vue-router's own click handler would run
// before these, so `.prevent` on a NuxtLink wouldn't reliably stop the
// navigation.
//
// The open state and handlers all live in a composable because their openers
// are shared with links buried elsewhere - "(edit profile)" / "(edit garage)"
// on the route, segment and event pages, and the report link inside the About
// overlay itself.
const { isAboutOpen, isGarageOpen, isProfileOpen, isReportOpen, reportSeed, openAbout, openGarage, openProfile, openReport, isBikeDetailOpen, returnsFocusToMenuToggle, isMenuOpen, closeOverlays } = useOverlays()

// Where focus goes when the about, garage, profile or report overlay
// closes. Reka returns it to the element that had it when the dialog
// mounted, and after a desktop opener that is exactly right. An overlay
// opened from the mobile menu is different: the menu unmounts in the same
// tick the overlay mounts, so the entry the rider pressed is already gone
// and Reka's return would land on `body`. The header's menu toggle is the
// one thing the rider pressed on the way in that is still there, so it gets
// focus instead - only in that case, hence the flag. UHeader stamps its
// toggle `data-slot="toggle"` (Nuxt UI names every slot element that way,
// and the in-menu copy is gone by now), which is the only handle on it
// short of rendering the toggle ourselves. The flag outlives one close
// while another overlay is still up - About's report link opens a second
// overlay in the same chain (`openReportFromAbout`), which should come back
// to the toggle too - and resets once the chain is closed.
//
// Forwarded to the overlays as UModal's `content.onCloseAutoFocus`: a
// `watch` on the open state could not do this, because Reka moves focus in
// a timeout after unmount and would win.
//
// The swipe handlers ride along in the same object: `content` is what Nuxt
// UI binds to the dialog element, so it is where a gesture on the panel is
// heard (#239). The centred overlays go down, the drawer back out of the
// edge it came from, and both dismiss through `closeOverlays` - only one
// overlay is ever open, so no gesture has to say which one it means.
const overlayContent = {
  onCloseAutoFocus(event) {
    if (!returnsFocusToMenuToggle.value) return
    event.preventDefault()
    document.querySelector('header [data-slot="toggle"]')?.focus()
    returnsFocusToMenuToggle.value = isAboutOpen.value || isGarageOpen.value || isProfileOpen.value || isReportOpen.value
  },
  ...useSwipeDismiss('down', closeOverlays)
}

const drawerContent = useSwipeDismiss('right', closeOverlays)

// The section a page belongs to, by path prefix, for the mark on the nav
// entry. Computed by hand because the Routes entry links to `/`, which
// vue-router would only ever match on the homepage itself, while every
// `/routes/*` page is a Routes page. Profile, garage, about and report pages
// belong to no section and mark nothing.
const route = useRoute()
const section = computed(() => {
  const path = route.path
  if (path === '/' || path.startsWith('/routes/')) return 'routes'
  if (path.startsWith('/segments')) return 'segments'
  if (path.startsWith('/events')) return 'events'
  return undefined
})

// Runtime site flags (docs/site-flags.md): fetched once post-mount, so the
// prerendered markup and the first client render agree on the defaults
// (no MOTD, every section visible) and a live flag applies as an update.
// The nav's Events entries hide with the section; direct visits are handled
// by the events pages themselves.
const { load: loadSiteFlags, eventsVisible } = useSiteFlags()
onMounted(loadSiteFlags)

// The three section entries, in the order the header and the mobile menu
// both list them. Events hides with its section.
const sectionEntries = computed(() => [
  { key: 'routes', label: 'Routes', to: '/' },
  { key: 'segments', label: 'Segments', to: '/segments' },
  ...(eventsVisible.value ? [{ key: 'events', label: 'Events', to: '/events' }] : [])
])

// UHeader's mobile menu closes itself when an entry navigates. These
// entries deliberately don't navigate any more, so close it by hand - but
// only when an overlay actually opened: a modifier-click falls through to
// the real href, and the menu going away under a new tab is just noise.
// The menu is not an Overlay (navigation, not content) but follows the same
// rule: it closes as the overlay opens, so only one of them is up at a time,
// and one back press covers the pair (#239) - which is why its open state
// lives in `useOverlays` with the overlays' own. Its entry unmounts with it,
// which is why the overlay's closing focus is sent to the menu toggle
// instead (`overlayContent`).

function openProfileFromMenu(event) {
  openProfile(event)
  if (!event.defaultPrevented) return
  isMenuOpen.value = false
  returnsFocusToMenuToggle.value = true
}

function openGarageFromMenu(event) {
  openGarage(event)
  if (!event.defaultPrevented) return
  isMenuOpen.value = false
  returnsFocusToMenuToggle.value = true
}

function openAboutFromMenu(event) {
  openAbout(event)
  if (!event.defaultPrevented) return
  isMenuOpen.value = false
  returnsFocusToMenuToggle.value = true
}

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
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'ZwiftBikes'
// 150-220 chars: short enough not to be truncated in search results, long
// enough to carry the keywords (Zwift, bike, wheelset, route, finish time).
const description
  = 'Find the fastest bike and wheelset for any Zwift route. ZwiftBikes ranks every frame and wheel combo in the game by predicted finish time for your weight, height and power, built on real ZwiftInsider speed-test data.'

const siteConfig = useSiteConfig()

// Set here in app.vue rather than per-page so no future page can forget it.
// Any page needing a different canonical can still override it with its own
// `link: [{ rel: 'canonical' }]` - unhead dedupes by rel. See
// `useCanonicalUrl` for why this ignores the request URL.
const canonicalUrl = useCanonicalUrl()

// Default social-share image for the pages that set nothing better
// themselves (garage, profile, report). Home/about and the
// route/segment/event pages define generated nuxt-og-image cards (issue
// #59), which emit their own og:image with width/height/alt. Declared as a
// full object because unhead dedupes og:image:width etc. per-tag,
// independently of og:image itself, and declaring dimensions at all is what
// lets scrapers render a card on the very first share of a URL, before the
// image is processed (Facebook's debugger says exactly this when they're
// missing).
const ogImageUrl = `${siteConfig.url.replace(/\/+$/, '')}/og-image.png`
const ogImage = {
  url: ogImageUrl,
  width: 1200,
  height: 630,
  alt: 'ZwiftBikes - find the fastest bike for any Zwift route'
}

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogSiteName: siteConfig.name,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  ogImage,
  twitterCard: 'summary_large_image',
  twitterImage: ogImageUrl
})
useHead({
  link: [{ rel: 'canonical', href: () => canonicalUrl.value }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': siteConfig.name,
        'description': siteConfig.description,
        'url': siteConfig.url
      }).replace(/</g, '\\u003c')
    }
  ]
})
</script>

<template>
  <UApp>
    <!-- First focusable element in the document; visible only while focused.
         Targets the main region, never the results: the Rider card beside
         them is what explains the numbers. -->
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-highlighted focus:ring-2 focus:ring-primary focus:outline-none"
    >Skip to content</a>

    <NuxtLoadingIndicator color="var(--ui-primary)" />

    <!-- Quiet on purpose: section entries in the secondary ink, the current
         one in the ink with the primary underline - the one place in the
         shell the primary is spent. -->
    <UHeader
      v-model:open="isMenuOpen"
      :ui="{ root: 'bg-default/90 backdrop-blur', left: 'gap-6' }"
    >
      <template #left>
        <NuxtLink
          to="/"
          aria-label="ZwiftBikes home"
        >
          <AppLogo />
        </NuxtLink>
        <nav
          aria-label="Sections"
          class="hidden items-center gap-1 lg:flex"
        >
          <NuxtLink
            v-for="entry in sectionEntries"
            :key="entry.key"
            :to="entry.to"
            class="px-3 py-2 text-md transition-colors"
            :class="section === entry.key ? 'text-highlighted shadow-[inset_0_-2px_0_var(--ui-primary)]' : 'text-toned hover:text-highlighted'"
            :aria-current="section === entry.key ? 'page' : undefined"
          >
            {{ entry.label }}
          </NuxtLink>
        </nav>
      </template>

      <template #right>
        <nav
          aria-label="Your data"
          class="hidden items-center gap-1 lg:flex"
        >
          <a
            href="/garage"
            aria-haspopup="dialog"
            class="rounded-md px-3 py-2 text-md text-toned transition-colors hover:text-highlighted"
            @click="openGarage"
          >Garage</a>
          <a
            href="/profile"
            aria-haspopup="dialog"
            class="rounded-md px-3 py-2 text-md text-toned transition-colors hover:text-highlighted"
            @click="openProfile"
          >Profile</a>
          <UButton
            to="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            icon="i-simple-icons-github"
            aria-label="zwift-bikes on GitHub"
            color="neutral"
            variant="ghost"
          />
        </nav>

        <UColorModeButton
          color="neutral"
          variant="outline"
        />
      </template>

      <template #body>
        <nav
          aria-label="Sections"
          class="flex flex-col"
        >
          <NuxtLink
            v-for="entry in sectionEntries"
            :key="entry.key"
            :to="entry.to"
            class="border-b border-default py-3 text-lg font-semibold font-heading"
            :class="section === entry.key ? 'text-highlighted underline decoration-primary decoration-2 underline-offset-8' : 'text-toned'"
            :aria-current="section === entry.key ? 'page' : undefined"
          >
            {{ entry.label }}
          </NuxtLink>
        </nav>
        <nav
          aria-label="Your data"
          class="mt-6 flex flex-col gap-1"
        >
          <a
            href="/garage"
            aria-haspopup="dialog"
            class="py-2 text-md text-toned"
            @click="openGarageFromMenu"
          >Garage</a>
          <a
            href="/profile"
            aria-haspopup="dialog"
            class="py-2 text-md text-toned"
            @click="openProfileFromMenu"
          >Profile</a>
          <a
            href="/about"
            aria-haspopup="dialog"
            class="py-2 text-md text-toned"
            @click="openAboutFromMenu"
          >About</a>
          <a
            href="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            rel="noopener"
            class="py-2 text-md text-toned"
          >zwift-bikes on GitHub</a>
        </nav>
      </template>
    </UHeader>

    <AboutModal
      v-model:open="isAboutOpen"
      :content="overlayContent"
    />
    <GarageModal
      v-model:open="isGarageOpen"
      :content="overlayContent"
    />
    <ProfileModal
      v-model:open="isProfileOpen"
      :content="overlayContent"
    />
    <BikeDetailSlideover
      v-model:open="isBikeDetailOpen"
      :content="drawerContent"
    />
    <ReportModal
      v-model:open="isReportOpen"
      :content="overlayContent"
      :seed-kind="reportSeed?.kind"
      :seed-item="reportSeed?.item"
      :seed-ride="reportSeed?.ride"
    />

    <SiteMotdBanner />

    <UMain
      id="main"
      tabindex="-1"
      class="focus:outline-none"
    >
      <NuxtPage />
    </UMain>

    <!-- One quiet line: where the data comes from, the two pages about the
         site itself, and the disclaimer. -->
    <footer class="mt-16 border-t border-default">
      <UContainer class="flex flex-wrap justify-between gap-x-6 gap-y-2 pt-6 pb-10 text-sm text-muted">
        <p>
          Data from
          <a
            href="https://zwiftinsider.com/"
            target="_blank"
            rel="noopener"
            class="underline decoration-rule-strong hover:text-highlighted"
          >ZwiftInsider</a>,
          <a
            href="https://www.npmjs.com/package/zwift-data"
            target="_blank"
            rel="noopener"
            class="underline decoration-rule-strong hover:text-highlighted"
          >zwift-data</a>
          and
          <a
            href="https://zwiftmap.com"
            target="_blank"
            rel="noopener"
            class="underline decoration-rule-strong hover:text-highlighted"
          >zwiftmap</a>.
          <a
            href="/about"
            aria-haspopup="dialog"
            class="underline decoration-rule-strong hover:text-highlighted"
            @click="openAbout"
          >About this project</a>
          <span aria-hidden="true"> · </span>
          <a
            href="/report"
            aria-haspopup="dialog"
            class="underline decoration-rule-strong hover:text-highlighted"
            @click="openReport"
          >Report an issue</a>
        </p>
        <p>Unofficial fan project, not affiliated with Zwift.</p>
      </UContainer>
    </footer>
  </UApp>
</template>
