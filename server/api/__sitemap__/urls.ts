import { eventsRenderDay } from '../../../shared/utils/events'
import { sitemapUrls } from '../../utils/sitemapUrls'

// What the sitemap holds is `sitemapUrls`, on the day this runs: the build's.
// On the dev server `EVENTS_TODAY` pins it, as it pins the events pages, so a
// pinned server's sitemap leaves out what its pages say has been run.
export default defineSitemapEventHandler(() => sitemapUrls(eventsRenderDay(import.meta.dev ? process.env.EVENTS_TODAY : undefined)))
