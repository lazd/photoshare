import { mkdir, copyFile, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllPhotosForStatic, getAlbums, getAlbumIconThumbnails } from './db.js';
import { processAllPhotos, getConvertedDir } from './photos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'dist');

async function build() {
  console.log('Processing photos...');
  await processAllPhotos();

  const photos = getAllPhotosForStatic().map((p) => ({
    id: p.id,
    converted_filename: p.converted_filename,
    thumbnail_filename: p.thumbnail_filename,
    album: p.album ?? '',
    latitude: p.latitude,
    longitude: p.longitude,
    taken_at: p.taken_at,
    created_at: p.created_at
  }));

  const albums = getAlbums().map((a) => {
    const thumbs = getAlbumIconThumbnails(a.album, 4);
    return {
      album: a.album,
      count: a.count,
      thumbnails: thumbs.map((t) => ({
        thumbnail: `images/${t.thumbnail_filename || t.converted_filename}`,
        id: t.id
      }))
    };
  });

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
    if (p.thumbnail_filename) {
      await copyFile(
        join(convertedDir, p.thumbnail_filename),
        join(imagesDir, p.thumbnail_filename)
      );
    }
  }

  await Promise.all([
    writeFile(join(OUT_DIR, 'photos.json'), JSON.stringify(photos, null, 2)),
    writeFile(join(OUT_DIR, 'albums.json'), JSON.stringify(albums, null, 2))
  ]);

  const [indexHtml, stylesCss, appJs] = await Promise.all([
    readFile(join(__dirname, 'public', 'index.html'), 'utf-8'),
    readFile(join(__dirname, 'public', 'styles.css'), 'utf-8'),
    readFile(join(__dirname, 'public', 'app.js'), 'utf-8')
  ]);

  const staticAppJs = appJs
    .replace(
      "const API_BASE = '';\nconst PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;\nconst ALBUMS_ENDPOINT = `${API_BASE}/api/albums`;\nconst CONVERTED_BASE = `${API_BASE}/converted`;",
      "const CONVERTED_BASE = 'images';"
    )
    .replace(
      `async function fetchAlbums() {
  const res = await fetch(ALBUMS_ENDPOINT);
  if (!res.ok) throw new Error('Failed to fetch albums');
  return res.json();
}`,
      `async function fetchAlbums() {
  const res = await fetch('albums.json');
  if (!res.ok) throw new Error('Failed to fetch albums');
  return res.json();
}`
    )
    .replace(
      `async function fetchPhotos(album = null) {
  const url = album != null && album !== ''
    ? \`\${PHOTOS_ENDPOINT}?album=\${encodeURIComponent(album)}\`
    : PHOTOS_ENDPOINT;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
}`,
      `let _allPhotos = null;
async function fetchPhotos(album = null) {
  if (!_allPhotos) {
    const res = await fetch('photos.json');
    if (!res.ok) throw new Error('Failed to fetch photos');
    _allPhotos = await res.json();
  }
  if (album == null || album === '') {
    return _allPhotos.filter((p) => !(p.album || ''));
  }
  return _allPhotos.filter((p) => (p.album || '') === album);
}`
    );

  await Promise.all([
    writeFile(join(OUT_DIR, 'index.html'), indexHtml),
    writeFile(join(OUT_DIR, 'styles.css'), stylesCss),
    writeFile(join(OUT_DIR, 'app.js'), staticAppJs),
    writeFile(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
  ]);

  console.log(`Done! Static site in ${OUT_DIR}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
