import { v } from "convex/values";
import { deviceAction } from "./fluent";

const WORLD_NEWS_FEED = "https://feeds.bbci.co.uk/news/world/rss.xml";

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export const world = deviceAction
  .input({})
  .returns(v.array(v.object({ title: v.string(), url: v.string() })))
  .handler(async () => {
    const response = await fetch(WORLD_NEWS_FEED);
    if (!response.ok) throw new Error(`News feed returned ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 4)
      .map(([, item]) => ({
        title: decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
        url: decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""),
      }))
      .filter(({ title, url }) => title.length > 0 && url.startsWith("http"));
  })
  .public();
