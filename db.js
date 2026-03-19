import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'photos.db');

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT UNIQUE NOT NULL,
    converted_filename TEXT NOT NULL,
    thumbnail_filename TEXT,
    latitude REAL,
    longitude REAL,
    taken_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
  CREATE INDEX IF NOT EXISTS idx_photos_coords ON photos(latitude, longitude);
`);

try {
  db.prepare('ALTER TABLE photos ADD COLUMN thumbnail_filename TEXT').run();
} catch (_) {}

export function insertPhoto(photo) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO photos (original_path, converted_filename, thumbnail_filename, latitude, longitude, taken_at)
    VALUES (@original_path, @converted_filename, @thumbnail_filename, @latitude, @longitude, @taken_at)
  `);
  stmt.run(photo);
}

export function getAllPhotos() {
  const stmt = db.prepare(`
    SELECT id, original_path, converted_filename, thumbnail_filename, latitude, longitude, taken_at, created_at
    FROM photos
    ORDER BY COALESCE(taken_at, created_at) ASC
  `);
  return stmt.all();
}

export function getPhotoById(id) {
  const stmt = db.prepare('SELECT * FROM photos WHERE id = ?');
  return stmt.get(id);
}

export function photoExistsByPath(originalPath) {
  const stmt = db.prepare('SELECT 1 FROM photos WHERE original_path = ?');
  return stmt.get(originalPath) != null;
}

export function getPhotoByPath(originalPath) {
  const stmt = db.prepare('SELECT * FROM photos WHERE original_path = ?');
  return stmt.get(originalPath);
}

export function getPhotoByFilename(filename) {
  const stmt = db.prepare('SELECT * FROM photos WHERE original_path LIKE ?');
  return stmt.get('%/' + filename);
}

export function deletePhotoByPath(originalPath) {
  const stmt = db.prepare('DELETE FROM photos WHERE original_path = ?');
  return stmt.run(originalPath);
}

export function updatePhotoThumbnail(id, thumbnailFilename) {
  const stmt = db.prepare('UPDATE photos SET thumbnail_filename = ? WHERE id = ?');
  return stmt.run(thumbnailFilename, id);
}

export default db;
