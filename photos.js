import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join, extname, resolve } from 'path';
import exifr from 'exifr';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { createHash } from 'crypto';
import { insertPhoto, photoExistsByPath } from './db.js';

const PHOTOS_DIR = join(process.cwd(), 'photos');
const CONVERTED_DIR = join(process.cwd(), 'converted');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tiff', '.tif', '.webp', '.gif'
]);

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

export async function processPhoto(originalPath) {
  const resolvedPath = resolve(originalPath);
  const ext = extname(resolvedPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;

  await ensureDir(CONVERTED_DIR);
  const convertedFilename = getConvertedFilename(resolvedPath);
  const outputPath = join(CONVERTED_DIR, convertedFilename);

  let metadata = {};
  try {
    metadata = await exifr.parse(resolvedPath, { pick: ['GPSLatitude', 'GPSLongitude', 'DateTimeOriginal', 'CreateDate'] })
      .catch(() => ({}));
  } catch (_) {}

  let gps = null;
  try {
    gps = await exifr.gps(resolvedPath);
  } catch (_) {}

  const latitude = gps?.latitude ?? metadata?.GPSLatitude ?? null;
  const longitude = gps?.longitude ?? metadata?.GPSLongitude ?? null;
  const takenAt = (metadata?.DateTimeOriginal ?? metadata?.CreateDate)?.toISOString?.() ?? null;

  const isHeic = ['.heic', '.heif'].includes(ext);
  try {
    if (isHeic) {
      const inputBuffer = await readFile(resolvedPath);
      const outputBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.9
      });
      await writeFile(outputPath, outputBuffer);
    } else {
      await sharp(resolvedPath)
        .rotate()
        .jpeg({ quality: 90 })
        .toFile(outputPath);
    }
  } catch (err) {
    console.error(`Failed to convert ${resolvedPath}:`, err.message);
    return null;
  }

  const photo = {
    original_path: resolvedPath,
    converted_filename: convertedFilename,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    taken_at: takenAt
  };

  insertPhoto(photo);
  return photo;
}

export async function processAllPhotos() {
  await ensureDir(PHOTOS_DIR);
  await ensureDir(CONVERTED_DIR);

  const entries = await readdir(PHOTOS_DIR, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => join(PHOTOS_DIR, e.name));

  let processed = 0;
  for (const filePath of files) {
    if (photoExistsByPath(resolve(filePath))) continue;
    const result = await processPhoto(filePath);
    if (result) processed++;
  }
  return processed;
}

export function getPhotosDir() {
  return PHOTOS_DIR;
}

export function getConvertedDir() {
  return CONVERTED_DIR;
}
