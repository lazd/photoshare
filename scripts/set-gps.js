import { exiftool } from 'exiftool-vendored';
import exifr from 'exifr';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const photosDir = join(__dirname, '..', 'photos');

const source = join(photosDir, 'IMG_0998.HEIC');
const target = join(photosDir, 'IMG_2795.HEIC');

const gps = await exifr.gps(source);
console.log('Source GPS:', gps);

await exiftool.write(target, {
  GPSLatitude: gps.latitude,
  GPSLongitude: gps.longitude
});

console.log('Written to IMG_2795.HEIC');
await exiftool.end();
