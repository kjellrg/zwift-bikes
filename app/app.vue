<script setup>
// Every nav/footer entry below keeps a real `href` so crawlers can reach the
// page version (a modal's content is never server-rendered) and so
// cmd/ctrl-click still opens it in a new tab - but a plain left click shows
// the modal instead of navigating away. They're plain `<a>`s rather than
// ULinks: vue-router's own click handler would run before these, so
// `.prevent` on a NuxtLink wouldn't reliably stop the navigation.
//
// The open state and handlers all live in a composable because their openers
// are shared with links buried elsewhere - "(edit profile)" / "(edit garage)"
// on the route, segment and event pages, and the report link inside the About
// modal itself.
const { isAboutOpen, isGarageOpen, isProfileOpen, isReportOpen, reportSeed, openAbout, openGarage, openProfile, openReport } = useOverlays()

// UHeader's mobile panel closes itself when an entry navigates. These
// entries deliberately don't navigate any more, so close it by hand - but
// only when a modal actually opened: a modifier-click falls through to the
// real href, and the panel going away under a new tab is just noise.
const isMenuOpen = ref(false);

function openProfileFromMenu(event) {
  openProfile(event);
  if (event.defaultPrevented) isMenuOpen.value = false;
}

function openGarageFromMenu(event) {
  openGarage(event);
  if (event.defaultPrevented) isMenuOpen.value = false;
}

function openAboutFromMenu() {
  isAboutOpen.value = true;
  isMenuOpen.value = false;
}

useHead({
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  link: [
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  ],
  htmlAttrs: {
    lang: "en",
  },
});

const title = "ZwiftBikes";
// 150-220 chars: short enough not to be truncated in search results, long
// enough to carry the keywords (Zwift, bike, wheelset, route, finish time).
const description =
  "Find the fastest bike and wheelset for any Zwift route. ZwiftBikes ranks every frame and wheel combo in the game by predicted finish time for your weight, height and power, built on real ZwiftInsider speed-test data.";

const siteConfig = useSiteConfig();

// Set here in app.vue rather than per-page so no future page can forget it.
// Any page needing a different canonical can still override it with its own
// `link: [{ rel: 'canonical' }]` - unhead dedupes by rel. See
// `useCanonicalUrl` for why this ignores the request URL.
const canonicalUrl = useCanonicalUrl();

// Default social-share image for pages that don't set their own (home,
// about, garage, profile). Route/segment pages override it with their
// world's artwork - as full objects with their own width/height/alt,
// because unhead dedupes og:image:width etc. per-tag, independently of
// og:image itself, so a page that replaced only the URL would inherit
// these dimensions and misstate its image's size. Declaring dimensions at
// all is what lets scrapers render a card on the very first share of a
// URL, before the image is processed (Facebook's debugger says exactly
// this when they're missing).
const ogImageUrl = `${siteConfig.url.replace(/\/+$/, "")}/og-image.png`;
const ogImage = {
  url: ogImageUrl,
  width: 1200,
  height: 630,
  alt: "ZwiftBikes - find the fastest bike for any Zwift route",
};

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogSiteName: siteConfig.name,
  ogType: "website",
  ogUrl: () => canonicalUrl.value,
  ogImage,
  twitterCard: "summary_large_image",
  twitterImage: ogImageUrl,
});
useHead({
  link: [{ rel: "canonical", href: () => canonicalUrl.value }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": siteConfig.name,
        "description": siteConfig.description,
        "url": siteConfig.url,
      }).replace(/</g, "\\u003c"),
    },
  ],
});
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--ui-primary)" />

    <UHeader v-model:open="isMenuOpen">
      <template #left>
        <NuxtLink to="/">
          <AppLogo />
        </NuxtLink>
      </template>

      <template #right>
        <div class="hidden items-center gap-1.5 lg:flex">
          <UButton
            to="/events"
            icon="i-lucide-calendar-days"
            label="Events"
            color="neutral"
            variant="ghost"
          />

          <UButton
            as="a"
            href="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
            @click="openProfile"
          />

          <UButton
            as="a"
            href="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
            @click="openGarage"
          />

          <UButton
            icon="i-lucide-info"
            label="About"
            color="neutral"
            variant="ghost"
            @click="isAboutOpen = true"
          />

          <UButton
            to="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            icon="i-simple-icons-github"
            aria-label="zwift-bikes on GitHub"
            color="neutral"
            variant="ghost"
          />
        </div>

        <UColorModeButton />
      </template>

      <template #body>
        <div class="flex flex-col gap-1.5">
          <UButton
            to="/events"
            icon="i-lucide-calendar-days"
            label="Events"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            as="a"
            href="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
            block
            @click="openProfileFromMenu"
          />

          <UButton
            as="a"
            href="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
            block
            @click="openGarageFromMenu"
          />

          <UButton
            icon="i-lucide-info"
            label="About"
            color="neutral"
            variant="ghost"
            block
            @click="openAboutFromMenu"
          />

          <UButton
            to="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            icon="i-simple-icons-github"
            label="zwift-bikes on GitHub"
            aria-label="zwift-bikes on GitHub"
            color="neutral"
            variant="ghost"
            block
          />
        </div>
      </template>
    </UHeader>

    <AboutModal v-model:open="isAboutOpen" />
    <GarageModal v-model:open="isGarageOpen" />
    <ProfileModal v-model:open="isProfileOpen" />
    <ReportModal
      v-model:open="isReportOpen"
      :seed-kind="reportSeed?.kind"
      :seed-item="reportSeed?.item"
    />

    <UMain>
      <NuxtPage />
    </UMain>

    <USeparator icon="i-lucide-bike" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Data from
          <ULink
            to="https://www.npmjs.com/package/zwift-data"
            target="_blank"
            class="underline"
            >zwift-data</ULink
          >,
          <ULink
            to="https://zwiftinsider.com/"
            target="_blank"
            class="underline"
            >ZwiftInsider</ULink
          >
          and
          <ULink
            to="https://zwiftmap.com"
            target="_blank"
            class="underline"
            >zwiftmap</ULink
          >.
          <a
            href="/about"
            class="underline transition-colors hover:text-default"
            @click="openAbout"
            >About this project</a
          >
          <span aria-hidden="true"> • </span>
          <a
            href="/report"
            class="underline transition-colors hover:text-default"
            @click="openReport"
          >Report an issue</a>
        </p>
      </template>

      <template #right>
        <p class="text-sm text-muted">
          Unofficial fan project • not affiliated with Zwift
        </p>
      </template>
    </UFooter>
  </UApp>
</template>
