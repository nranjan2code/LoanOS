import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const siteRoot = 'https://demo.aitailorworkshop.in';
const contactEmail = 'hello@aitailorworkshop.in';
const stylesheetVersion = 14;
const errors = [];
const warnings = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function requireMatch(source, pattern, message) {
  const match = source.match(pattern);
  if (!match) errors.push(message);
  return match;
}

const pages = walk(webRoot).filter(file => file.endsWith('.html'));
const sitemap = read(path.join(webRoot, 'sitemap.xml'));
const robots = read(path.join(webRoot, 'robots.txt'));
const stylesheet = read(path.join(webRoot, 'assets', 'site.css'));
const canonicalUrls = [];
const heroImages = new Map();

const requiredDesignTokens = [
  '--display',
  '--sans',
  '--type-display-xl',
  '--type-display-lg',
  '--type-display-md',
  '--type-title-lg',
  '--type-title-md',
  '--type-body-lg',
  '--type-body',
  '--type-body-sm',
  '--type-label',
  '--type-meta',
  '--leading-display',
  '--leading-title',
  '--leading-body',
  '--tracking-display',
  '--tracking-title',
  '--tracking-label',
  '--radius-sm',
  '--radius-md',
  '--radius-pill'
];

for (const token of requiredDesignTokens) {
  if (!stylesheet.includes(`${token}:`)) errors.push(`site.css: missing design token ${token}`);
}

for (const declaration of stylesheet.matchAll(/font-size\s*:\s*([^;}]*)/g)) {
  if (!declaration[1].trim().startsWith('var(--type-')) {
    errors.push(`site.css: font-size must use a semantic type token (${declaration[1].trim()})`);
  }
}

for (const declaration of stylesheet.matchAll(/border-radius\s*:\s*([^;}]*)/g)) {
  const value = declaration[1].trim();
  if (!['0', '50%'].includes(value) && !value.startsWith('var(--radius-')) {
    errors.push(`site.css: border-radius must use the shared radius scale (${value})`);
  }
}

if (!stylesheet.includes('--type-meta: .75rem;')) errors.push('site.css: metadata text must remain at least 12px');
if ((stylesheet.match(/:root\s*{/g) || []).length !== 1) errors.push('site.css: design tokens must have one :root source of truth');
if (/var\(--[^)]+\)[A-Za-z0-9.]+/.test(stylesheet)) errors.push('site.css: malformed custom property value');

for (const page of pages) {
  const source = read(page);
  const relative = path.relative(webRoot, page);
  const canonical = requireMatch(source, /<link rel="canonical" href="([^"]+)">/, `${relative}: missing canonical URL`);
  requireMatch(source, /<meta name="description" content="[^"]+">/, `${relative}: missing description`);
  requireMatch(source, /loanos-logo-mark\.png/, `${relative}: missing approved logo image`);
  requireMatch(source, new RegExp(`site\\.css\\?v=${stylesheetVersion}`), `${relative}: stylesheet must use version ${stylesheetVersion}`);
  requireMatch(source, /site\.js\?v=\d+/, `${relative}: missing versioned script`);
  requireMatch(source, /family=DM\+Sans:wght@400;500;600;700&family=DM\+Serif\+Display/, `${relative}: missing approved font pair`);
  if (/style="[^"]*(?:font-|color:)/.test(source)) errors.push(`${relative}: typography and colour must come from the shared design system`);

  if (canonical) {
    canonicalUrls.push(canonical[1]);
    if (!sitemap.includes(`<loc>${canonical[1]}</loc>`)) errors.push(`${relative}: canonical URL absent from sitemap`);
  }

  for (const email of source.matchAll(/mailto:([^?"'\s]+)/g)) {
    if (email[1] !== contactEmail) errors.push(`${relative}: contact address must be ${contactEmail}`);
  }

  if (relative.startsWith('loan-types/') && relative !== 'loan-types/index.html') {
    const image = requireMatch(source, /<figure class="product-hero-image"><img src="([^"]+)"/, `${relative}: missing product hero image`);
    const journey = requireMatch(source, /<section class="section sand" id="journey">([\s\S]*?)<\/section>/, `${relative}: missing journey section`);
    requireMatch(source, /<script type="application\/ld\+json">/, `${relative}: missing structured data`);
    if (image) {
      const imagePath = path.join(webRoot, image[1]);
      if (!fs.existsSync(imagePath)) errors.push(`${relative}: hero image file is missing`);
      const current = heroImages.get(image[1]) || [];
      current.push(relative);
      heroImages.set(image[1], current);
    }
    if (journey) {
      const stageTitles = [...journey[1].matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]);
      if (stageTitles.length !== 5) errors.push(`${relative}: journey must have exactly five stages`);
      if (new Set(stageTitles).size !== stageTitles.length) errors.push(`${relative}: journey repeats a stage title`);
    }
  }
}

const productPages = pages.filter(page => {
  const relative = path.relative(webRoot, page);
  return relative.startsWith('loan-types/') && relative !== 'loan-types/index.html';
});

if (productPages.length !== 21) errors.push(`expected 21 product pages, found ${productPages.length}`);
for (const [image, users] of heroImages) {
  if (users.length > 1) errors.push(`product hero image is reused: ${image}`);
}

const duplicateCanonical = canonicalUrls.filter((url, index) => canonicalUrls.indexOf(url) !== index);
if (duplicateCanonical.length) errors.push(`duplicate canonical URL: ${duplicateCanonical[0]}`);
if (!fs.existsSync(path.join(webRoot, 'assets', 'loanos-logo-mark.png'))) errors.push('approved logo image is missing');
if (!sitemap.includes(siteRoot)) errors.push('sitemap does not identify the public site');
if (!robots.includes(`Sitemap: ${siteRoot}/sitemap.xml`)) errors.push('robots.txt does not identify the canonical sitemap');
if (canonicalUrls.some(url => !url.startsWith(siteRoot))) warnings.push('one or more canonical URLs do not use the public site origin');

if (warnings.length) console.warn(`Website validation warnings:\n${warnings.map(item => `- ${item}`).join('\n')}`);
if (errors.length) {
  console.error(`Website validation failed:\n${errors.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log(`Website validation passed: ${pages.length} pages, ${productPages.length} product journeys, ${heroImages.size} unique product images.`);
