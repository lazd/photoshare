import express from 'express';
import { join, dirname, resolve, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { readFile, unlink, access } from 'fs/promises';
import chokidar from 'chokidar';
import { getAllPhotos, getPhotoByPath, getPhotoByFilename, deletePhotoByPath, getAlbums, getAlbumIconThumbnails } from './db.js';
import { processPhoto, processAllPhotos, getPhotosDir, getConvertedDir } from './photos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, 'public');
const app = express();
const PORT = process.env.PORT || 3192;

app.use(express.static(publicDir, { index: false }));
app.get('/', async (req, res) => {
  try {
    const html = await readFile(join(publicDir, 'index.html'), 'utf-8');
    res.type('html').send(html);
  } catch (err) {
    res.status(500).send('index.html not found');
  }
});
app.use('/converted', express.static(getConvertedDir()));

app.get('/api/albums', (req, res) => {
  try {
    const albums = getAlbums();
    const CONVERTED_BASE = '/converted';
    const result = albums.map(a => {
      const thumbs = getAlbumIconThumbnails(a.album, 4);
      return {
        album: a.album,
        count: a.count,
        thumbnails: thumbs.map(t => ({
          thumbnail: t.thumbnail_filename ? `${CONVERTED_BASE}/${t.thumbnail_filename}` : `${CONVERTED_BASE}/${t.converted_filename}`,
          id: t.id
        }))
      };
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

app.get('/api/photos', (req, res) => {
  try {
    const album = req.query.album ?? null;
    const photos = getAllPhotos(album);
    res.json(photos.map(p => ({
      id: p.id,
      converted_filename: p.converted_filename,
      thumbnail_filename: p.thumbnail_filename,
      album: p.album,
      latitude: p.latitude,
      longitude: p.longitude,
      taken_at: p.taken_at,
      created_at: p.created_at
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

async function syncDeletedPhotos() {
  const photos = getAllPhotos();
  let removed = 0;
  for (const photo of photos) {
    try {
      await access(photo.original_path);
    } catch {
      const convertedPath = join(getConvertedDir(), photo.converted_filename);
      try {
        await unlink(convertedPath);
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('Error deleting converted file', convertedPath, err);
      }
      if (photo.thumbnail_filename) {
        const thumbPath = join(getConvertedDir(), photo.thumbnail_filename);
        try {
          await unlink(thumbPath);
        } catch (err) {
          if (err.code !== 'ENOENT') console.error('Error deleting thumbnail', thumbPath, err);
        }
      }
      deletePhotoByPath(photo.original_path);
      removed++;
      console.log('Removed orphaned:', photo.converted_filename);
    }
  }
  return removed;
}

async function start() {
  const photosDir = getPhotosDir();
  console.log('Syncing deleted photos...');
  const removed = await syncDeletedPhotos();
  if (removed > 0) console.log(`Removed ${removed} orphaned photos.`);
  console.log('Processing existing photos...');
  const processed = await processAllPhotos();
  console.log(`Processed ${processed} new photos.`);

  const watcher = chokidar.watch(photosDir, {
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('add', async (filePath) => {
    console.log('New photo detected:', filePath);
    try {
      const relDir = relative(photosDir, dirname(filePath));
      const album = relDir && relDir !== '.' ? relDir : '';
      const result = await processPhoto(filePath, album);
      if (result) console.log('Added:', result.converted_filename);
    } catch (err) {
      console.error('Error processing', filePath, err);
    }
  });

  watcher.on('unlink', async (filePath) => {
    try {
      const resolvedPath = resolve(filePath);
      let photo = getPhotoByPath(resolvedPath) ?? getPhotoByPath(filePath);
      if (!photo) {
        photo = getPhotoByFilename(basename(filePath));
      }
      if (photo) {
        const convertedPath = join(getConvertedDir(), photo.converted_filename);
        try {
          await unlink(convertedPath);
          console.log('Deleted converted:', photo.converted_filename);
        } catch (err) {
          if (err.code !== 'ENOENT') console.error('Error deleting converted file', convertedPath, err);
        }
        if (photo.thumbnail_filename) {
          const thumbPath = join(getConvertedDir(), photo.thumbnail_filename);
          try {
            await unlink(thumbPath);
          } catch (err) {
            if (err.code !== 'ENOENT') console.error('Error deleting thumbnail', thumbPath, err);
          }
        }
        deletePhotoByPath(photo.original_path);
        console.log('Removed from DB:', photo.original_path);
      } else {
        console.log('No DB entry found for deleted file:', filePath);
      }
    } catch (err) {
      console.error('Error removing photo', filePath, err);
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch(console.error);
