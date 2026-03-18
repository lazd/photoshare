const API_BASE = '';
const PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;
const CONVERTED_BASE = `${API_BASE}/converted`;

let photos = [];
let map = null;
let markers = [];

async function fetchPhotos() {
  const res = await fetch(PHOTOS_ENDPOINT);
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
}

function renderPhotoGrid() {
  const grid = document.getElementById('photoGrid');
  grid.innerHTML = '';

  photos.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.dataset.photoId = photo.id;

    const img = document.createElement('img');
    img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';

    cell.appendChild(img);

    cell.addEventListener('click', () => {
      highlightPhoto(photo.id);
      if (photo.latitude != null && photo.longitude != null) {
        panToPhoto(photo);
      }
    });

    grid.appendChild(cell);
  });
}

function highlightPhoto(photoId) {
  document.querySelectorAll('.photo-cell').forEach((el) => {
    el.classList.toggle('highlighted', el.dataset.photoId === String(photoId));
  });
}

function panToPhoto(photo) {
  if (!map) return;
  map.setView([photo.latitude, photo.longitude], 14);
}

function setupMap() {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);

  const center = photosWithCoords.length
    ? [photosWithCoords[0].latitude, photosWithCoords[0].longitude]
    : [37.7749, -122.4194];

  map = L.map('map').setView(center, 3);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  markers = photosWithCoords.map((photo) => {
    const marker = L.marker([photo.latitude, photo.longitude]).addTo(map);

    marker.on('click', () => {
      highlightPhoto(photo.id);
      const cell = document.querySelector(`[data-photo-id="${photo.id}"]`);
      if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    return marker;
  });

  if (photosWithCoords.length > 1) {
    const bounds = L.latLngBounds(photosWithCoords.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

async function init() {
  photos = await fetchPhotos();
  renderPhotoGrid();
  setupMap();
}

init().catch((err) => {
  console.error(err);
  document.getElementById('photoGrid').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
