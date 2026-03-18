import express from 'express';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import chokidar from 'chokidar';
import { getAllPhotos } from './db.js';
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

app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
});

app.get('/api/photos', (req, res) => {
  try {
    const photos = getAllPhotos();
    res.json(photos.map(p => ({
      id: p.id,
      converted_filename: p.converted_filename,
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

async function start() {
  const photosDir = getPhotosDir();
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
      const result = await processPhoto(filePath);
      if (result) console.log('Added:', result.converted_filename);
    } catch (err) {
      console.error('Error processing', filePath, err);
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch(console.error);
