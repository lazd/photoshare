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

  const overlay = document.getElementById('fullscreenOverlay');
  if (overlay.classList.contains('visible')) {
    document.getElementById('fullscreenImage').src = img.src;
    document.getElementById('fullscreenImage').alt = img.alt;
  }

  if (photo.latitude != null && photo.longitude != null && map) {
    const zoom = getZoomForPhoto(photo);
    const center = map.getCenter();
    const dist = Math.hypot(
      photo.latitude - center.lat,
      photo.longitude - center.lng
    );
    const duration = Math.min(1.5, Math.max(0.25, 0.25 + (dist / 0.1) * 1.25));
    map.flyTo([photo.latitude, photo.longitude], zoom, { duration });
  }

  updateMarkerStyles();

  const cell = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function toggleFullscreen() {
  const overlay = document.getElementById('fullscreenOverlay');
  const fullscreenImg = document.getElementById('fullscreenImage');
  const previewImg = document.querySelector('#photoPreview img');
  if (!previewImg) return;

  if (overlay.classList.contains('visible')) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  } else {
    fullscreenImg.src = previewImg.src;
    fullscreenImg.alt = previewImg.alt;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
}

function getZoomForPhoto(photo) {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);
  const radius = 0.003;
  const nearby = photosWithCoords.filter(
    (p) =>
      p.id !== photo.id &&
      Math.abs(p.latitude - photo.latitude) < radius &&
      Math.abs(p.longitude - photo.longitude) < radius
  );
  const isMobile = window.innerWidth <= 768;
  const offset = isMobile ? -2 : 0;
  if (nearby.length >= 15) return 19 + offset;
  if (nearby.length >= 8) return 18 + offset;
  if (nearby.length >= 4) return 17 + offset;
  return 14 + offset;
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
    const photoUrl = `${CONVERTED_BASE}/${photo.converted_filename}`;
    const marker = L.marker([photo.latitude, photo.longitude], {
      icon: L.divIcon({
        className: 'map-marker',
        html: `<div class="map-marker-pin"><img src="${photoUrl}" alt=""></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
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
  // Prevent pinch-to-zoom on iOS (viewport meta is often ignored)
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  photos = await fetchPhotos();
  renderTimeline();
  setupMap();

  if (photos.length === 0) {
    document.getElementById('photoPreview').innerHTML = '<p class="photo-placeholder">No photos yet</p>';
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (document.getElementById('fullscreenOverlay').classList.contains('visible') && e.key === 'Escape') {
      toggleFullscreen();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigatePhoto('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigatePhoto('next');
    }
  });

  const photoPreview = document.querySelector('.photo-preview');
  let touchStartX = 0;
  const SWIPE_THRESHOLD = 50;

  photoPreview.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  photoPreview.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchStartX - touchEndX;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) navigatePhoto('next');
      else navigatePhoto('prev');
    }
  }, { passive: true });

  document.querySelector('.photo-preview').addEventListener('click', (e) => {
    if (e.target.closest('#photoPreview img')) {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  document.getElementById('fullscreenOverlay').addEventListener('click', () => {
    if (document.getElementById('fullscreenOverlay').classList.contains('visible')) {
      toggleFullscreen();
    }
  });

  const overlay = document.getElementById('fullscreenOverlay');
  let overlayTouchStartX = 0;
  let overlayTouchStartY = 0;

  overlay.addEventListener('touchstart', (e) => {
    if (!overlay.classList.contains('visible')) return;
    overlayTouchStartX = e.touches[0].clientX;
    overlayTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  overlay.addEventListener('touchend', (e) => {
    if (!overlay.classList.contains('visible')) return;
    const touch = e.changedTouches[0];
    const deltaX = overlayTouchStartX - touch.clientX;
    const deltaY = overlayTouchStartY - touch.clientY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY > SWIPE_THRESHOLD && absY > absX) {
      toggleFullscreen();
    } else if (absX > SWIPE_THRESHOLD) {
      if (deltaX > 0) navigatePhoto('next');
      else navigatePhoto('prev');
    }
  }, { passive: true });

}

init().catch((err) => {
  console.error(err);
  document.getElementById('timeline').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
