const API_BASE = '';
const PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;
const CONVERTED_BASE = `${API_BASE}/converted`;

let photos = [];
let map = null;
let markers = [];

async function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    document.getElementById('mapPlaceholder').classList.add('visible');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    window.initMap = () => {
      resolve();
      setupMap();
    };
    document.head.appendChild(script);
  });
}

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
  map.panTo({ lat: photo.latitude, lng: photo.longitude });
  map.setZoom(14);
}

function setupMap() {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);

  const center = photosWithCoords.length
    ? { lat: photosWithCoords[0].latitude, lng: photosWithCoords[0].longitude }
    : { lat: 37.7749, lng: -122.4194 };

  map = new google.maps.Map(document.getElementById('map'), {
    center,
    zoom: 3,
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
      { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
      { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#64779e' }] },
      { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
      { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
      { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
      { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
      { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
      { featureType: 'road', elementType: 'text.fill', stylers: [{ color: '#98a5be' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
      { featureType: 'water', elementType: 'text.fill', stylers: [{ color: '#4e6d70' }] }
    ]
  });

  markers = photosWithCoords.map((photo) => {
    const marker = new google.maps.Marker({
      position: { lat: photo.latitude, lng: photo.longitude },
      map,
      title: `Photo ${photo.id}`
    });

    marker.addListener('click', () => {
      highlightPhoto(photo.id);
      const cell = document.querySelector(`[data-photo-id="${photo.id}"]`);
      if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    return marker;
  });

  if (photosWithCoords.length > 1) {
    const bounds = new google.maps.LatLngBounds();
    photosWithCoords.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    map.fitBounds(bounds, { padding: 40 });
  }
}

async function init() {
  const [config, photosData] = await Promise.all([
    fetch(`${API_BASE}/api/config`).then((r) => r.json()),
    fetchPhotos()
  ]);
  photos = photosData;
  renderPhotoGrid();
  if (config.googleMapsApiKey) {
    await loadGoogleMaps(config.googleMapsApiKey);
  } else {
    document.getElementById('mapPlaceholder').classList.add('visible');
  }
}

init().catch((err) => {
  console.error(err);
  document.getElementById('photoGrid').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
