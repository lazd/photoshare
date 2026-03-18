import { mkdir, copyFile, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllPhotos } from './db.js';
import { processAllPhotos, getConvertedDir } from './photos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'dist');

async function build() {
  console.log('Processing photos...');
  await processAllPhotos();

  const photos = getAllPhotos().map((p) => ({
    id: p.id,
    converted_filename: p.converted_filename,
    latitude: p.latitude,
    longitude: p.longitude,
    taken_at: p.taken_at,
    created_at: p.created_at
  }));

  console.log(`Building static site with ${photos.length} photos...`);

  await rm(OUT_DIR, { recursive: true }).catch(() => {});
  await mkdir(OUT_DIR, { recursive: true });
  const imagesDir = join(OUT_DIR, 'images');
  await mkdir(imagesDir, { recursive: true });

  const convertedDir = getConvertedDir();
  for (const p of photos) {
    await copyFile(
      join(convertedDir, p.converted_filename),
      join(imagesDir, p.converted_filename)
    );
  }

  await writeFile(
    join(OUT_DIR, 'photos.json'),
    JSON.stringify(photos, null, 2)
  );

  const [indexHtml, stylesCss, appJs] = await Promise.all([
    readFile(join(__dirname, 'public', 'index.html'), 'utf-8'),
    readFile(join(__dirname, 'public', 'styles.css'), 'utf-8'),
    readFile(join(__dirname, 'public', 'app.js'), 'utf-8')
  ]);

  const staticAppJs = appJs
    .replace(
      "const API_BASE = '';\nconst PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;\nconst CONVERTED_BASE = `${API_BASE}/converted`;",
      "const CONVERTED_BASE = 'images';"
    )
    .replace(
      `async function fetchPhotos() {
  const res = await fetch(PHOTOS_ENDPOINT);
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
}`,
      `async function fetchPhotos() {
  const res = await fetch('photos.json');
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
}`
    );

  await Promise.all([
    writeFile(join(OUT_DIR, 'index.html'), indexHtml),
    writeFile(join(OUT_DIR, 'styles.css'), stylesCss),
    writeFile(join(OUT_DIR, 'app.js'), staticAppJs)
  ]);

  console.log(`Done! Static site in ${OUT_DIR}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
