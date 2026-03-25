// ===== State =====
let map;
let shuttleData = {};
let currentMarkers = [];
let currentPolylines = [];
let centerMarkers = [];
let routeLayerGroups = []; 
let activeRouteIndex = -1;
window.activeFCs = [];

const ROUTE_COLORS = [
    '#4F46E5', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1'
];

const ALL_VALUE = '__ALL__';

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await loadData();
    populateFCs();
    setupEventListeners();
    
    // 첫 화면 버벅임 해소
    setTimeout(() => {
        showAllCenters();
    }, 500);
});

// ===== Map Initialization =====
function initMap() {
    map = L.map('map', {
        center: [36.5, 127.5],
        zoom: 7,
        zoomControl: false,
        preferCanvas: true 
    });

    L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://map.vworld.kr/">Vworld</a>',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
}

// ===== Load Data =====
async function loadData() {
    try {
        const response = await fetch('./data/shuttle_data.json');
        shuttleData = await response.json();
        const subtitle = document.getElementById('subtitle');
        if (subtitle) {
            subtitle.textContent = `전국 ${Object.keys(shuttleData).length}개 물류센터 셔틀버스 노선 안내`;
        }
    } catch (error) {
        console.error('데이터 로드 실패:', error);
    }
}

// ===== Populate UI =====
function populateFCs() {
    const fcSelect = document.getElementById('fc-select');
    if (!fcSelect) return;

    Object.keys(shuttleData).sort().forEach(fc => {
        const option = document.createElement('option');
        option.value = fc;
        const centerName = shuttleData[fc].center?.name || fc;
        option.textContent = `${centerName} [${fc}]`;
        fcSelect.appendChild(option);
    });
}

function setupEventListeners() {
    const fcSelect = document.getElementById('fc-select');
    const shiftSelect = document.getElementById('shift-select');
    const routeSelect = document.getElementById('route-select');

    if (fcSelect) {
        fcSelect.addEventListener('change', (e) => {
            const fc = e.target.value;
            shiftSelect.innerHTML = '<option value="">근무조를 선택하세요</option>';
            shiftSelect.disabled = !fc;
            routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
            routeSelect.disabled = true;

            if (fc && shuttleData[fc]?.shifts) {
                Object.keys(shuttleData[fc].shifts).sort().forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s; opt.textContent = s;
                    shiftSelect.appendChild(opt);
                });
            }
        });
    }

    if (shiftSelect) {
        shiftSelect.addEventListener('change', (e) => {
            const fc = fcSelect.value;
            const shift = e.target.value;
            routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
            routeSelect.disabled = !shift;

            if (fc && shift && shuttleData[fc]?.shifts[shift]) {
                Object.keys(shuttleData[fc].shifts[shift]).sort().forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r; opt.textContent = r;
                    routeSelect.appendChild(opt);
                });
            }
        });
    }

    if (routeSelect) {
        routeSelect.addEventListener('change', (e) => {
            const fc = fcSelect.value;
            const shift = shiftSelect.value;
            const route = e.target.value;

            if (fc && shift && route) {
                const stops = shuttleData[fc].shifts[shift][route];
                const center = shuttleData[fc].center;
                renderSingleRoute(stops, center, route, '#4F46E5', fc);
            }
        });
    }

    // Sidebar Toggle
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('collapsed');
        };
    }
}

// ===== Rendering =====
function renderSingleRoute(stops, center, routeName, color, fcCode) {
    clearRoute();
    const bounds = L.latLngBounds();
    const path = [];
    const stopListEl = document.getElementById('stop-list');
    const routeDetailsEl = document.getElementById('route-details');

    if (stopListEl) stopListEl.innerHTML = '';
    if (routeDetailsEl) routeDetailsEl.style.display = 'block';

    if (center) bounds.extend([center.lat, center.lng]);

    stops.forEach((stop, index) => {
        const latlng = [stop.Latitude, stop.Longitude];
        path.push(latlng);
        bounds.extend(latlng);

        const icon = L.divIcon({
            className: 'stop-icon',
            html: `<div class="stop-marker-inner" style="background:${color};">${index + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
        });

        const marker = L.marker(latlng, { icon }).addTo(map).bindPopup(`
            <div class="popup-route">🚌 ${routeName}</div>
            <div class="popup-time">🕐 ${stop.Time} 출발</div>
            <div class="popup-title">${index + 1}. ${stop.Name}</div>
            <div class="popup-addr">${stop.Address}</div>
        `);
        currentMarkers.push(marker);

        if (stopListEl) {
            const item = document.createElement('div');
            item.className = 'stop-item';
            item.innerHTML = `
                <div class="stop-number">${index + 1}</div>
                <div class="stop-content">
                    <div class="stop-time">🕐 ${stop.Time}</div>
                    <div class="stop-name">${stop.Name}</div>
                </div>
            `;
            item.onclick = () => {
                map.flyTo(latlng, 16);
                marker.openPopup();
            };
            stopListEl.appendChild(item);
        }
    });

    const line = L.polyline(path, {
        color, weight: 4, opacity: 0.7, dashArray: '10, 8'
    }).addTo(map);
    currentPolylines.push(line);

    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50] });
}

function clearRoute() {
    currentMarkers.forEach(m => map.removeLayer(m));
    currentPolylines.forEach(l => map.removeLayer(l));
    currentMarkers = [];
    currentPolylines = [];
    const details = document.getElementById('route-details');
    if (details) details.style.display = 'none';
}

function showAllCenters() {
    centerMarkers.forEach(m => map.removeLayer(m));
    centerMarkers = [];
    const bounds = L.latLngBounds();

    Object.keys(shuttleData).forEach(fcCode => {
        const center = shuttleData[fcCode].center;
        if (!center) return;
        bounds.extend([center.lat, center.lng]);

        const marker = L.marker([center.lat, center.lng]).addTo(map)
            .bindPopup(`<b>${center.name}</b><br>${center.address || ''}`);
        centerMarkers.push(marker);
    });

    if (bounds.isValid() && centerMarkers.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}
