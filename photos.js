import { readdir, readFile, mkdir, stat } from 'fs/promises';
import { join, extname, resolve, relative } from 'path';
import exifr from 'exifr';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { createHash } from 'crypto';
import { insertPhoto, photoExistsByPath, getAllPhotos, updatePhotoThumbnail, updatePhotoAlbum, updatePhotoTakenAt, getPhotosWithUtcTakenAt, replaceJournalEntries } from './db.js';
import { parseJournal } from './journal.js';

const PHOTOS_DIR = join(process.cwd(), 'photos');
const CONVERTED_DIR = join(process.cwd(), 'converted');
const FULL_SIZE = 1440;
const FULL_SIZE_QUALITY = 80;
const THUMBNAIL_SIZE = 320;
const THUMBNAIL_SIZE_QUALITY = 70;

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tiff', '.tif', '.webp', '.gif'
]);

// EXIF DateTimeOriginal is recorded as the local wall-clock time in the photo's
// own timezone ("YYYY:MM:DD HH:MM:SS"). We keep it as a naive local timestamp so
// dates group by the day the photo was actually taken, rather than shifting a UTC
// conversion into an adjacent day.
function exifDateToLocalIso(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    // Fallback for revived values: format in local components, not UTC.
    if (isNaN(raw)) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${raw.getFullYear()}-${p(raw.getMonth() + 1)}-${p(raw.getDate())}T${p(raw.getHours())}:${p(raw.getMinutes())}:${p(raw.getSeconds())}`;
  }
  const m = String(raw).match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

// Reads the raw (non-revived) EXIF capture date so no timezone conversion is
// applied. Returns a local ISO string or null.
async function readTakenAtLocal(resolvedPath) {
  try {
    const raw = await exifr.parse(resolvedPath, {
      pick: ['DateTimeOriginal', 'CreateDate'],
      reviveValues: false
    }).catch(() => ({}));
    return exifDateToLocalIso(raw?.DateTimeOriginal ?? raw?.CreateDate);
  } catch (_) {
    return null;
  }
}

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function getConvertedFilename(originalPath) {
  const hash = createHash('sha256').update(originalPath).digest('hex').slice(0, 12);
  const base = `photo_${hash}`;
  return `${base}.jpg`;
}

function getThumbnailFilename(originalPath) {
  const hash = createHash('sha256').update(originalPath).digest('hex').slice(0, 12);
  return `thumb_${hash}.jpg`;
}

export async function processPhoto(originalPath, album = '') {
  const resolvedPath = resolve(originalPath);
  const ext = extname(resolvedPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;

  await ensureDir(CONVERTED_DIR);
  const convertedFilename = getConvertedFilename(resolvedPath);
  const outputPath = join(CONVERTED_DIR, convertedFilename);

  let metadata = {};
  try {
    metadata = await exifr.parse(resolvedPath, { pick: ['GPSLatitude', 'GPSLongitude'] })
      .catch(() => ({}));
  } catch (_) {}

  let gps = null;
  try {
    gps = await exifr.gps(resolvedPath);
  } catch (_) {}

  const latitude = gps?.latitude ?? metadata?.GPSLatitude ?? null;
  const longitude = gps?.longitude ?? metadata?.GPSLongitude ?? null;
  const takenAt = await readTakenAtLocal(resolvedPath);

  const isHeic = ['.heic', '.heif'].includes(ext);
  const resizeOptions = { fit: 'inside', withoutEnlargement: true };
  const thumbnailFilename = getThumbnailFilename(resolvedPath);
  const thumbnailPath = join(CONVERTED_DIR, thumbnailFilename);

  try {
    let input;
    if (isHeic) {
      const inputBuffer = await readFile(resolvedPath);
      const outputBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.9
      });
      input = sharp(outputBuffer).rotate();
    } else {
      input = sharp(resolvedPath).rotate();
    }

    await Promise.all([
      input.clone().resize(FULL_SIZE, FULL_SIZE, resizeOptions).jpeg({ quality: FULL_SIZE_QUALITY }).toFile(outputPath),
      input.clone().resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, resizeOptions).jpeg({ quality: THUMBNAIL_SIZE_QUALITY }).toFile(thumbnailPath)
    ]);
  } catch (err) {
    console.error(`Failed to convert ${resolvedPath}:`, err.message);
    return null;
  }

  const photo = {
    original_path: resolvedPath,
    converted_filename: convertedFilename,
    thumbnail_filename: thumbnailFilename,
    album: album ?? '',
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    taken_at: takenAt
  };

  insertPhoto(photo);
  return photo;
}

export async function syncThumbnails() {
  const resizeOptions = { fit: 'inside', withoutEnlargement: true };
  const photosWithoutThumb = getAllPhotos().filter(p => !p.thumbnail_filename);
  let generated = 0;
  for (const photo of photosWithoutThumb) {
    try {
      const thumbnailFilename = getThumbnailFilename(photo.original_path);
      const convertedPath = join(CONVERTED_DIR, photo.converted_filename);
      const thumbnailPath = join(CONVERTED_DIR, thumbnailFilename);
      await sharp(convertedPath)
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, resizeOptions)
        .jpeg({ quality: THUMBNAIL_SIZE_QUALITY })
        .toFile(thumbnailPath);
      updatePhotoThumbnail(photo.id, thumbnailFilename);
      generated++;
    } catch (err) {
      console.error(`Failed to generate thumbnail for ${photo.converted_filename}:`, err.message);
    }
  }
  return generated;
}

async function walkPhotos(dir, baseDir = PHOTOS_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    const fullPath = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await walkPhotos(fullPath, baseDir));
    } else if (e.isFile()) {
      const rel = relative(baseDir, dir);
      const album = rel && rel !== '.' ? rel : '';
      results.push({ path: fullPath, album });
    }
  }
  return results;
}

export async function processAllPhotos() {
  await ensureDir(PHOTOS_DIR);
  await ensureDir(CONVERTED_DIR);

  const filesWithAlbums = await walkPhotos(PHOTOS_DIR);
  let processed = 0;
  for (const { path: filePath, album } of filesWithAlbums) {
    const resolved = resolve(filePath);
    if (photoExistsByPath(resolved)) {
      updatePhotoAlbum(resolved, album);
      continue;
    }
    const result = await processPhoto(filePath, album);
    if (result) processed++;
  }

  const thumbGenerated = await syncThumbnails();
  await resyncTakenAtTimezone();
  await syncJournals();
  return processed + thumbGenerated;
}

// One-time migration: re-derive taken_at for photos previously stored as a UTC
// instant so they group by their local capture date. Skips files that are gone.
export async function resyncTakenAtTimezone() {
  const stale = getPhotosWithUtcTakenAt();
  let updated = 0;
  for (const { id, original_path } of stale) {
    const local = await readTakenAtLocal(original_path);
    if (local) {
      updatePhotoTakenAt(id, local);
      updated++;
    }
  }
  if (updated > 0) console.log(`Re-derived local capture dates for ${updated} photos.`);
  return updated;
}

const JOURNAL_FILENAME = 'journal.txt';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Resolves a concrete YYYY-MM-DD for an entry: uses the header's explicit year
// when present, otherwise borrows the year from an album photo taken on the
// same month/day. Returns null when no year can be determined.
function resolveEntryDate(entry, albumPhotos) {
  let year = entry.year;
  if (year == null) {
    const match = albumPhotos.find((p) => {
      const d = (p.taken_at || '').slice(0, 10);
      if (!d) return false;
      const [, mm, dd] = d.split('-').map(Number);
      return mm === entry.month && dd === entry.day;
    });
    if (match) year = Number(match.taken_at.slice(0, 4));
  }
  if (year == null) return null;
  return `${year}-${pad2(entry.month)}-${pad2(entry.day)}`;
}

// Finds every journal.txt under the photos directory and syncs its entries
// into the database, associating each entry with a resolved date.
export async function syncJournals() {
  await ensureDir(PHOTOS_DIR);
  const files = (await walkPhotos(PHOTOS_DIR)).filter(
    (f) => f.path.toLowerCase().endsWith('/' + JOURNAL_FILENAME) ||
      f.path.toLowerCase().endsWith('\\' + JOURNAL_FILENAME)
  );

  const seenAlbums = new Set();
  for (const { path: filePath, album } of files) {
    seenAlbums.add(album);
    try {
      const text = await readFile(filePath, 'utf-8');
      const entries = parseJournal(text);
      const albumPhotos = getAllPhotos(album);
      const withDates = entries.map((e) => ({
        ...e,
        entry_date: resolveEntryDate(e, albumPhotos)
      }));
      replaceJournalEntries(album, withDates);
    } catch (err) {
      console.error(`Failed to parse journal ${filePath}:`, err.message);
    }
  }
  return seenAlbums.size;
}

export function getPhotosDir() {
  return PHOTOS_DIR;
}

export function getConvertedDir() {
  return CONVERTED_DIR;
}
