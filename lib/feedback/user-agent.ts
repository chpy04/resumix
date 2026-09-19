/**
 * Turns a user-agent string into the one line a reader actually wants —
 * `Chrome 142 on macOS` — for the issue's Environment block.
 *
 * Deliberately not a dependency: UA-parsing libraries carry hundreds of
 * regexes for crawlers, set-top boxes and feature phones, and this has one
 * caller whose reports come from a desktop browser. The raw string is still
 * emitted next to it, so anything this gets wrong stays recoverable.
 */

/** Most specific first: every Chromium browser also claims `Chrome`, and
 *  Chrome claims `Safari`, so the order here is the whole algorithm. */
const BROWSERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Edge', pattern: /\bEdg(?:iOS|A)?\/(\d+)/ },
  { name: 'Opera', pattern: /\bOPR\/(\d+)/ },
  { name: 'Samsung Internet', pattern: /\bSamsungBrowser\/(\d+)/ },
  { name: 'Firefox', pattern: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /\b(?:Chrome|CriOS)\/(\d+)/ },
  // Safari puts its own version in `Version/`; the `Safari/` build number
  // that follows is shared with every Chromium browser and means nothing.
  { name: 'Safari', pattern: /\bVersion\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari\// },
];

/** Also order-sensitive: an Android UA says `Linux`, an iPad says `Mac OS X`
 *  in desktop-site mode, so the mobile platforms have to be tested first. */
const PLATFORMS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'iOS', pattern: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: 'Android', pattern: /\bAndroid\b/ },
  { name: 'ChromeOS', pattern: /\bCrOS\b/ },
  { name: 'macOS', pattern: /\bMac OS X\b|\bMacintosh\b/ },
  { name: 'Windows', pattern: /\bWindows NT\b/ },
  { name: 'Linux', pattern: /\bLinux\b/ },
];

/** `'unknown'` rather than `null`, because the caller renders it either way. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent || userAgent.trim().length === 0) return 'unknown';

  const browser = BROWSERS.find((candidate) => candidate.pattern.test(userAgent));
  const platform = PLATFORMS.find((candidate) => candidate.pattern.test(userAgent));

  if (!browser) return platform ? platform.name : 'unknown';

  const version = browser.pattern.exec(userAgent)?.[1];
  const named = version ? `${browser.name} ${version}` : browser.name;
  return platform ? `${named} on ${platform.name}` : named;
}
