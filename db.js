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
    album TEXT,
    latitude REAL,
    longitude REAL,
    taken_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
  CREATE INDEX IF NOT EXISTS idx_photos_coords ON photos(latitude, longitude);
  CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album);
`);

try {
  db.prepare('ALTER TABLE photos ADD COLUMN thumbnail_filename TEXT').run();
} catch (_) {}
try {
  db.prepare('ALTER TABLE photos ADD COLUMN album TEXT').run();
} catch (_) {}

export function insertPhoto(photo) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO photos (original_path, converted_filename, thumbnail_filename, album, latitude, longitude, taken_at)
    VALUES (@original_path, @converted_filename, @thumbnail_filename, @album, @latitude, @longitude, @taken_at)
  `);
  stmt.run(photo);
}

export function getAllPhotos(album = null) {
  const cols = 'id, original_path, converted_filename, thumbnail_filename, album, latitude, longitude, taken_at, created_at';
  if (album != null && album !== '') {
    const stmt = db.prepare(`
      SELECT ${cols} FROM photos WHERE COALESCE(album, '') = ?
      ORDER BY COALESCE(taken_at, created_at) ASC
    `);
    return stmt.all(album);
  }
  const stmt = db.prepare(`
    SELECT ${cols} FROM photos
    WHERE COALESCE(album, '') = ''
    ORDER BY COALESCE(taken_at, created_at) ASC
  `);
  return stmt.all();
}

export function getAlbums() {
  const stmt = db.prepare(`
    SELECT COALESCE(album, '') as album, COUNT(*) as count
    FROM photos
    GROUP BY COALESCE(album, '')
    ORDER BY album ASC
  `);
  return stmt.all();
}

export function getAlbumIconThumbnails(album, limit = 4) {
  const albumVal = album === '' || album == null ? '' : album;
  const stmt = db.prepare(`
    SELECT id, thumbnail_filename, converted_filename
    FROM photos
    WHERE COALESCE(album, '') = ?
      AND (thumbnail_filename IS NOT NULL OR converted_filename IS NOT NULL)
    ORDER BY COALESCE(taken_at, created_at) ASC
    LIMIT ?
  `);
  return stmt.all(albumVal, limit);
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

export function updatePhotoAlbum(originalPath, album) {
  const stmt = db.prepare('UPDATE photos SET album = ? WHERE original_path = ?');
  return stmt.run(album ?? '', originalPath);
}

export default db;
