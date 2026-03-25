// ===== State =====
let map;
let shuttleData = {};
let currentMarkers = [];
let currentPolylines = [];
let centerMarkers = [];
let nationalLayerGroup = null; // 전국 노선 레이어 그룹
window.activeFCs = [];

const ROUTE_COLORS = [
    '#4F46E5', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1'
];

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await loadData();
    populateFCs();
    setupEventListeners();
    
    // 초기 로딩 시 센터 마커 표시
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
        preferCanvas: true // 성능을 위해 Canvas 모드 활성화
    });

    L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://map.vworld.kr/">Vworld</a>',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    
    nationalLayerGroup = L.layerGroup().addTo(map);
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
    const compareAllBtn = document.getElementById('compare-all-btn');

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
            
            // 센터 변경 시 해당 센터 데이터 보여주기 위해 선택 초기화
            if (nationalLayerGroup) nationalLayerGroup.clearLayers();
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
                if (nationalLayerGroup) nationalLayerGroup.clearLayers(); // 전국 보기 중일 때 단일 노선 선택 시 클리어
                const stops = shuttleData[fc].shifts[shift][route];
                const center = shuttleData[fc].center;
                renderSingleRoute(stops, center, route, '#4F46E5', fc);
            }
        });
    }

    // 전국 노선 비교 버튼 클릭 이벤트
    if (compareAllBtn) {
        compareAllBtn.addEventListener('click', () => {
            showNationalRoutes();
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

/**
 * 전국 모든 노선의 모든 정류장을 표시
 */
function showNationalRoutes() {
    clearRoute();
    if (nationalLayerGroup) nationalLayerGroup.clearLayers();
    
    const bounds = L.latLngBounds();
    let colorIdx = 0;
    
    // 사이드바 닫기 (지도를 넓게 보기 위해)
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
        // 모바일 최적화: 모바일에서만 닫거나 데스크탑에서도 닫을지 선택 (여기서는 사용자 편의를 위해 유지)
    }

    Object.keys(shuttleData).forEach(fcCode => {
        const center = shuttleData[fcCode].center;
        const shifts = shuttleData[fcCode].shifts;
        if (!shifts) return;

        Object.keys(shifts).forEach(shiftName => {
            const routes = shifts[shiftName];
            Object.keys(routes).forEach(routeName => {
                const stops = routes[routeName];
                const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
                colorIdx++;

                const path = [];
                stops.forEach((stop, idx) => {
                    const latlng = [stop.Latitude, stop.Longitude];
                    path.push(latlng);
                    bounds.extend(latlng);

                    // 성능을 위해 대량 데이터 모드에서는 CircleMarker 사용 (더 빠름)
                    const dotMarker = L.circleMarker(latlng, {
                        radius: 5,
                        fillColor: color,
                        color: "#fff",
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).bindPopup(`
                        <div class="popup-route">🏢 [${fcCode}] ${routeName}</div>
                        <div class="popup-time">🕐 ${stop.Time}</div>
                        <div class="popup-title">${idx + 1}. ${stop.Name}</div>
                    `);
                    
                    nationalLayerGroup.addLayer(dotMarker);
                });

                // 노선 선 그리기
                const line = L.polyline(path, {
                    color, weight: 2, opacity: 0.5, smoothFactor: 2
                });
                nationalLayerGroup.addLayer(line);
            });
        });
    });

    if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [30, 30], duration: 1.5 });
    }
    
    // 통계 정보 업데이트 (UI가 있다면)
    updateStatsNational();
}

function renderSingleRoute(stops, center, routeName, color, fcCode) {
    clearRoute();
    if (nationalLayerGroup) nationalLayerGroup.clearLayers();
    
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

function updateStatsNational() {
    const statsPanel = document.getElementById('route-stats-panel');
    if (!statsPanel) return;

    statsPanel.style.display = 'flex';
    const statCenters = document.getElementById('stat-centers');
    const statRoutes = document.getElementById('stat-routes');
    const statStops = document.getElementById('stat-stops');

    let totalRoutes = 0;
    let totalStops = 0;

    Object.keys(shuttleData).forEach(fcCode => {
        const fc = shuttleData[fcCode];
        if (fc && fc.shifts) {
            Object.values(fc.shifts).forEach(routes => {
                totalRoutes += Object.keys(routes).length;
                Object.values(routes).forEach(stops => {
                    totalStops += stops.length;
                });
            });
        }
    });

    if (statCenters) statCenters.textContent = Object.keys(shuttleData).length;
    if (statRoutes) statRoutes.textContent = totalRoutes.toLocaleString();
    if (statStops) statStops.textContent = totalStops.toLocaleString();
}
