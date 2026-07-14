import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const siteRoot = 'https://loanos.in';
const contactEmail = 'hello@aitailorworkshop.in';
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
const canonicalUrls = [];
const heroImages = new Map();

for (const page of pages) {
  const source = read(page);
  const relative = path.relative(webRoot, page);
  const canonical = requireMatch(source, /<link rel="canonical" href="([^"]+)">/, `${relative}: missing canonical URL`);
  requireMatch(source, /<meta name="description" content="[^"]+">/, `${relative}: missing description`);
  requireMatch(source, /loanos-logo-mark\.png/, `${relative}: missing approved logo image`);
  requireMatch(source, /site\.css\?v=\d+/, `${relative}: missing versioned stylesheet`);
  requireMatch(source, /site\.js\?v=\d+/, `${relative}: missing versioned script`);

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
if (canonicalUrls.some(url => !url.startsWith(siteRoot))) warnings.push('one or more canonical URLs do not use the public site origin');

if (warnings.length) console.warn(`Website validation warnings:\n${warnings.map(item => `- ${item}`).join('\n')}`);
if (errors.length) {
  console.error(`Website validation failed:\n${errors.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log(`Website validation passed: ${pages.length} pages, ${productPages.length} product journeys, ${heroImages.size} unique product images.`);
