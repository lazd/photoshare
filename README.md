# Photo Share

A photo sharing webpage with a map view. Automatically converts photos to JPG, extracts EXIF metadata (including GPS), and displays them in a mosaic grid with map pins.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your photos to the `photos/` folder. Supported formats: JPG, PNG, HEIC, HEIF, TIFF, WebP, GIF. HEIC/HEIF conversion uses `heic-convert` (no system libheif required).

3. (Optional) For the map, set your Google Maps API key:

   ```bash
   export GOOGLE_MAPS_API_KEY=your_api_key_here
   ```

   Get a key at [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials. Enable the Maps JavaScript API.

## Run

```bash
npm start
```

Open http://localhost:3192

## Features

- **Auto-conversion**: Photos in `photos/` are converted to JPG and stored in `converted/`
- **Metadata**: EXIF lat/long and capture date are extracted and stored in SQLite
- **Folder watch**: New photos added to `photos/` are processed automatically
- **Grid**: Mosaic of all photos in chronological order (left sidebar)
- **Map**: Pins for each photo with GPS data; clicking a pin highlights the photo in the grid
