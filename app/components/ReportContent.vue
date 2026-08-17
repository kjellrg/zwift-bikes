<script setup lang="ts">
import type { ReportKind } from '../utils/report'
import { buildReport } from '../utils/report'

// Shared by `ReportModal.vue` (in-app UX) and `pages/report.vue` (the
// linkable copy), exactly like `AboutContent.vue`. Keep this component free
// of modal-specific markup so both hosts can style their own heading.
//
// This form never submits anything - it composes a report and hands it to
// GitHub, a mail client, or the clipboard. That's what keeps the "no
// database, nothing stored" promise on the About page true, and it's why
// there's no endpoint, no secret and no spam surface to defend.

const props = defineProps<{
  /** Seeds the form when opened from a contextual "something look wrong?" link. */
  seedKind?: ReportKind
  seedItem?: string
}>()

const toast = useToast()
const { includeProfile, contextText } = useReportContext()

const kind = ref<ReportKind>(props.seedKind ?? 'bug')
const title = ref('')
const whatHappened = ref('')
const expected = ref('')
const item = ref(props.seedItem ?? '')
const shown = ref('')
const source = ref('')

// The seed arrives via props because the modal is mounted once in app.vue and
// reused; a rider who opens it from a result card, closes it and reopens it
// from the footer should not still be looking at the old bike's name.
watch(() => [props.seedKind, props.seedItem], ([nextKind, nextItem]) => {
  kind.value = (nextKind as ReportKind | undefined) ?? 'bug'
  item.value = nextItem ?? ''
})

const kindOptions = [
  { label: 'Something is broken', value: 'bug' as const },
  { label: 'A number looks wrong', value: 'data' as const }
]

const report = computed(() => buildReport({
  kind: kind.value,
  title: title.value,
  whatHappened: whatHappened.value,
  expected: expected.value,
  item: item.value,
  shown: shown.value,
  source: source.value,
  context: contextText.value
}))

/**
 * Mirrors the `required:` fields in `.github/ISSUE_TEMPLATE/*.yml`. Checked
 * here so a rider finds out before being sent to GitHub, rather than after -
 * GitHub would accept the prefilled URL and then refuse to submit the form.
 */
const missing = computed(() => {
  if (!title.value.trim()) return 'a short summary'
  if (kind.value === 'bug') {
    if (!whatHappened.value.trim()) return 'what happened'
    return undefined
  }
  if (!item.value.trim()) return 'which bike, wheel or route'
  if (!shown.value.trim()) return 'what the site currently shows'
  if (!expected.value.trim()) return 'what it should show'
  if (!source.value.trim()) return 'a source link'
  return undefined
})

const isReady = computed(() => !missing.value)

/**
 * Navigated to on click rather than rendered as an `href`, so the address
 * never sits in the served HTML - `/report` is prerendered, so a `mailto:`
 * link there would be baked into a static file for harvesters to scrape.
 */
function emailReport() {
  if (!isReady.value) return
  window.location.href = report.value.mailtoUrl
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(report.value.plainText)
    toast.add({ title: 'Report copied', description: 'Paste it into an issue, an email, or anywhere else.', color: 'success', icon: 'i-lucide-check' })
  } catch {
    // Clipboard access can be refused outright (permissions, insecure
    // context, older mobile browsers). "Show exactly what gets sent" below
    // holds the same text and is selectable, so point at it rather than
    // failing silently.
    toast.add({ title: 'Couldn\'t copy automatically', description: 'Open "Show exactly what gets sent" below and copy the text by hand.', color: 'warning', icon: 'i-lucide-clipboard-x' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 text-sm">
    <p class="text-muted">
      Found a bug, or a number that looks wrong? This form fills in the report
      for you - including the page you were on, your filters and your browser -
      then opens it as either a GitHub issue or an email. Nothing goes anywhere
      until you press send.
    </p>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Security issues go somewhere else"
    >
      <template #description>
        Please don't report a security vulnerability here - posting it here
        would make it public immediately. Use
        <ULink
          to="https://github.com/kjellrg/zwift-bikes/security/advisories/new"
          target="_blank"
          class="underline"
        >private vulnerability reporting</ULink> instead.
      </template>
    </UAlert>

    <div class="max-w-md">
      <label class="block text-xs font-medium text-muted mb-1">What kind of report is this?</label>
      <USelectMenu
        v-model="kind"
        value-key="value"
        :items="kindOptions"
        :search-input="false"
      />
    </div>

    <UFormField
      label="Short summary"
      required
    >
      <UInput
        v-model="title"
        placeholder="Gravel filter shows no results on Alpe du Zwift"
        class="w-full"
      />
    </UFormField>

    <template v-if="kind === 'bug'">
      <UFormField
        label="What happened?"
        required
      >
        <UTextarea
          v-model="whatHappened"
          :rows="4"
          placeholder="What you did, and what the site did."
          class="w-full"
        />
      </UFormField>

      <UFormField label="What did you expect instead?">
        <UTextarea
          v-model="expected"
          :rows="2"
          class="w-full"
        />
      </UFormField>
    </template>

    <template v-else>
      <UFormField
        label="Which bike, wheel or route?"
        required
      >
        <UInput
          v-model="item"
          placeholder="Zwift Concept Z1 (Tron)"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="What the site currently shows"
        required
      >
        <UTextarea
          v-model="shown"
          :rows="2"
          placeholder="Ranked 40th on Alpe du Zwift"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="What it should show, and why"
        required
      >
        <UTextarea
          v-model="expected"
          :rows="3"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Source"
        required
        description="A ZwiftInsider speed test, an official Zwift changelog, another published test - the site's numbers come from controlled tests, so a correction needs one too."
      >
        <UInput
          v-model="source"
          type="url"
          placeholder="https://zwiftinsider.com/..."
          class="w-full"
        />
      </UFormField>
    </template>

    <div class="rounded-lg border border-default p-4 flex flex-col gap-3">
      <UCheckbox
        v-model="includeProfile"
        label="Include my rider profile and garage size"
        description="Your weight, height, FTP and how many bikes you own. These change the ranking, so they're usually what explains a surprising result - but they're yours, so this is off unless you say so."
      />

      <!--
        The whole report verbatim, not just the auto-captured part: it's the
        same disclosure the About page makes about what leaves the browser,
        and it doubles as the manual path when `copyReport` can't reach the
        clipboard (permissions, insecure context, older mobile browsers).
      -->
      <details class="text-xs">
        <summary class="cursor-pointer text-muted hover:text-default">
          Show exactly what gets sent
        </summary>
        <pre class="mt-2 max-h-64 overflow-auto rounded bg-elevated p-3 text-xs whitespace-pre-wrap break-words select-all">{{ report.plainText }}</pre>
      </details>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-2">
        <UButton
          :to="isReady ? report.githubUrl : undefined"
          :disabled="!isReady"
          target="_blank"
          rel="noopener"
          icon="i-simple-icons-github"
          label="Open on GitHub"
          color="primary"
        />
        <UButton
          :disabled="!isReady"
          icon="i-lucide-mail"
          label="Email it instead"
          color="neutral"
          variant="subtle"
          @click="emailReport"
        />
        <UButton
          icon="i-lucide-clipboard"
          label="Copy report"
          color="neutral"
          variant="ghost"
          @click="copyReport"
        />
      </div>

      <p
        v-if="missing"
        class="text-xs text-muted"
      >
        Add {{ missing }} to enable the report buttons.
      </p>
      <p
        v-else-if="report.truncated"
        class="text-xs text-warning"
      >
        This report is too long to fit in a link, so some of it was left out.
        Use <strong>Copy report</strong> and paste the full version instead.
      </p>
      <p
        v-else
        class="text-xs text-muted"
      >
        GitHub issues are public - anyone can read them - but they're the
        easiest to follow up on, and they need an account. Email is private and
        needs no account. Copy puts the report on your clipboard to paste
        wherever you like.
      </p>
    </div>
  </div>
</template>
