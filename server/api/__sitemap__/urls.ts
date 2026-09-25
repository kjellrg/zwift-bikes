import { isoDay } from '../../../shared/utils/events'
import { sitemapUrls } from '../../utils/sitemapUrls'

// What the sitemap holds is `sitemapUrls`, on the day this runs: the build's.
export default defineSitemapEventHandler(() => sitemapUrls(isoDay(new Date())))
