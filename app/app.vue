<script setup>
const isAboutOpen = ref(false);

// The footer entry keeps a real `href="/about"` so crawlers can reach the
// page version (the modal's content is never server-rendered) and so
// cmd/ctrl-click still opens it in a new tab - but a plain left click shows
// the modal instead of navigating away. A plain `<a>` rather than ULink:
// vue-router's own click handler would run before this one, so `.prevent`
// on a NuxtLink wouldn't reliably stop the navigation.
function openAbout(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  isAboutOpen.value = true;
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

const title = "Zwift Best Bike";
const description =
  "Find the best bike and wheel combination for any Zwift route, based on distance, elevation and surface.";

const siteConfig = useSiteConfig();

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogSiteName: siteConfig.name,
  twitterCard: "summary_large_image",
});
useHead({
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

    <UHeader>
      <template #left>
        <NuxtLink to="/">
          <AppLogo />
        </NuxtLink>
      </template>

      <template #right>
        <div class="hidden items-center gap-1.5 lg:flex">
          <UButton
            to="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
          />

          <UButton
            to="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
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
            to="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            to="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            icon="i-lucide-info"
            label="About"
            color="neutral"
            variant="ghost"
            block
            @click="isAboutOpen = true"
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
