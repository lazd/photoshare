const API_BASE = '';
const PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;
const CONVERTED_BASE = `${API_BASE}/converted`;

let photos = [];
let map = null;
let markers = [];
let selectedPhotoId = null;

async function fetchPhotos() {
  const res = await fetch(PHOTOS_ENDPOINT);
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
}

function selectPhoto(photoId) {
  selectedPhotoId = photoId;
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return;

  document.querySelectorAll('.timeline-cell').forEach((el) => {
    el.classList.toggle('selected', el.dataset.photoId === String(photoId));
  });

  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  const img = document.createElement('img');
  img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
  img.alt = `Photo ${photo.id}`;
  preview.appendChild(img);

  if (photo.latitude != null && photo.longitude != null && map) {
    map.setView([photo.latitude, photo.longitude], 14);
  }

  updateMarkerStyles();

  const cell = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function updateMarkerStyles() {
  markers.forEach((marker) => {
    const el = marker._icon;
    if (el) {
      el.classList.toggle('map-marker-selected', marker.photoId === selectedPhotoId);
    }
  });
}

function navigatePhoto(direction) {
  if (photos.length === 0) return;
  const idx = photos.findIndex((p) => p.id === selectedPhotoId);
  if (idx === -1) return;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= photos.length) return;
  selectPhoto(photos[nextIdx].id);
}

function renderTimeline() {
  const track = document.getElementById('timeline');
  track.innerHTML = '';

  photos.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'timeline-cell';
    cell.dataset.photoId = photo.id;

    const img = document.createElement('img');
    img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';

    cell.appendChild(img);

    cell.addEventListener('click', () => selectPhoto(photo.id));

    track.appendChild(cell);
  });
}

function setupMap() {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);

  const center = photosWithCoords.length
    ? [photosWithCoords[0].latitude, photosWithCoords[0].longitude]
    : [37.7749, -122.4194];

  map = L.map('map').setView(center, 3);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc',
    maxZoom: 19
  }).addTo(map);

  markers = photosWithCoords.map((photo) => {
    const marker = L.marker([photo.latitude, photo.longitude], {
      icon: L.divIcon({
        className: 'map-marker',
        html: '<div class="map-marker-pin"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      })
    }).addTo(map);

    marker.photoId = photo.id;
    marker.on('click', () => selectPhoto(photo.id));

    return marker;
  });

  updateMarkerStyles();

  if (photosWithCoords.length > 1) {
    const bounds = L.latLngBounds(photosWithCoords.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  requestAnimationFrame(() => map.invalidateSize());
}

async function init() {
  photos = await fetchPhotos();
  renderTimeline();
  setupMap();

  if (photos.length > 0) {
    selectPhoto(photos[0].id);
  } else {
    document.getElementById('photoPreview').innerHTML = '<p class="photo-placeholder">No photos yet</p>';
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigatePhoto('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigatePhoto('next');
    }
  });
}

init().catch((err) => {
  console.error(err);
  document.getElementById('timeline').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
