(function () {
    'use strict';

    const root = document.querySelector('[data-forage-app]');
    if (!root) return;

    const STORAGE_KEY = 'zubr.foragewatch.project.v1';
    const ACRE_SQUARE_METERS = 4046.8564224;
    const DEFAULT_STATE = {
        mode: 'public',
        projectName: 'Untitled forage project',
        source: 'hls',
        fieldSeason: 'peak',
        metrics: ['biomass'],
        geometry: null,
        uavMetadata: null,
        herd: {
            animalType: 'cow',
            count: 100,
            weight: 1200,
            grazingDays: 30,
            allowableUse: 25
        }
    };

    const select = (selector) => root.querySelector(selector);
    const selectAll = (selector) => Array.from(root.querySelectorAll(selector));
    const state = loadState();
    let map = null;
    let drawnItems = null;
    let baseLayers = null;
    let activeBaseLayer = null;
    let locationMarker = null;
    let runtimeUavFile = null;
    let toastTimer = null;
    let runTimer = null;

    const elements = {
        projectName: select('[data-project-name]'),
        acreCount: select('[data-acre-count]'),
        featureCount: select('[data-feature-count]'),
        pastureList: select('[data-pasture-list]'),
        boundaryFile: select('[data-boundary-file]'),
        exportBoundary: select('[data-export-boundary]'),
        clearBoundary: select('[data-clear-boundary]'),
        publicSource: select('[data-public-source]'),
        uavSource: select('[data-uav-source]'),
        source: select('[data-source]'),
        fieldSeason: select('[data-field-season]'),
        uavFile: select('[data-uav-file]'),
        uavFileStatus: select('[data-uav-file-status]'),
        uavFileName: select('[data-uav-file-name]'),
        uavFileMeta: select('[data-uav-file-meta]'),
        runButton: select('[data-run-estimate]'),
        mapPrompt: select('[data-map-prompt]'),
        mapError: select('[data-map-error]'),
        mapHeading: select('[data-map-heading]'),
        mapArea: select('[data-map-area]'),
        basemap: select('[data-basemap]'),
        basemapStatus: select('[data-basemap-status]'),
        boundaryLayerStatus: select('[data-boundary-layer-status]'),
        statusCard: select('.forage-status-card'),
        statusTitle: select('[data-status-title]'),
        statusTime: select('[data-status-time]'),
        statusMessage: select('[data-status-message]'),
        privateDialog: select('[data-private-dialog]'),
        toast: select('[data-toast]'),
        animalType: select('[data-animal-type]'),
        animalCount: select('[data-animal-count]'),
        animalWeight: select('[data-animal-weight]'),
        grazingDays: select('[data-grazing-days]'),
        allowableUse: select('[data-allowable-use]'),
        allowableUseOutput: select('[data-allowable-use-output]'),
        herdAum: select('[data-herd-aum]')
    };

    function loadState() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!stored || typeof stored !== 'object') return { ...DEFAULT_STATE };
            return {
                ...DEFAULT_STATE,
                ...stored,
                metrics: Array.isArray(stored.metrics) ? stored.metrics : [...DEFAULT_STATE.metrics],
                herd: {
                    ...DEFAULT_STATE.herd,
                    ...(stored.herd && typeof stored.herd === 'object' ? stored.herd : {})
                }
            };
        } catch (error) {
            return { ...DEFAULT_STATE };
        }
    }

    function saveState() {
        try {
            state.geometry = drawnItems && drawnItems.getLayers().length ? drawnItems.toGeoJSON() : state.geometry;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            showToast('This browser could not save the project locally.');
        }
    }

    function showToast(message) {
        if (!elements.toast) return;
        window.clearTimeout(toastTimer);
        elements.toast.textContent = message;
        elements.toast.hidden = false;
        toastTimer = window.setTimeout(() => {
            elements.toast.hidden = true;
        }, 4200);
    }

    function formatAcres(value) {
        if (!Number.isFinite(value) || value <= 0) return '0';
        if (value < 10) return value.toFixed(2);
        if (value < 1000) return value.toFixed(1);
        return Math.round(value).toLocaleString();
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = bytes / Math.pow(1024, unit);
        return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
    }

    function getPolygonArea(latlngs) {
        if (!window.L || !L.GeometryUtil || !Array.isArray(latlngs) || !latlngs.length) return 0;

        if (latlngs[0] instanceof L.LatLng) {
            return Math.abs(L.GeometryUtil.geodesicArea(latlngs));
        }

        if (Array.isArray(latlngs[0]) && latlngs[0][0] instanceof L.LatLng) {
            const outer = Math.abs(L.GeometryUtil.geodesicArea(latlngs[0]));
            const holes = latlngs.slice(1).reduce((sum, ring) => {
                return sum + Math.abs(L.GeometryUtil.geodesicArea(ring));
            }, 0);
            return Math.max(0, outer - holes);
        }

        return latlngs.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
    }

    function getBoundarySummary() {
        if (!drawnItems) return { count: 0, acres: 0 };
        let squareMeters = 0;
        const layers = drawnItems.getLayers();

        layers.forEach((layer) => {
            if (typeof layer.getLatLngs === 'function') {
                squareMeters += getPolygonArea(layer.getLatLngs());
            }
        });

        return {
            count: layers.length,
            acres: squareMeters / ACRE_SQUARE_METERS
        };
    }

    function getLayerAcres(layer) {
        if (!layer || typeof layer.getLatLngs !== 'function') return 0;
        return getPolygonArea(layer.getLatLngs()) / ACRE_SQUARE_METERS;
    }

    function ensurePastureProperties(layer, fallbackName) {
        if (!layer.feature || layer.feature.type !== 'Feature') {
            layer.feature = { type: 'Feature', properties: {} };
        }
        if (!layer.feature.properties || typeof layer.feature.properties !== 'object') {
            layer.feature.properties = {};
        }
        const currentName = String(layer.feature.properties.name || '').trim();
        layer.feature.properties.name = currentName || fallbackName;
        return layer.feature.properties;
    }

    function nextPastureName() {
        const used = new Set();
        if (drawnItems) {
            drawnItems.getLayers().forEach((layer) => {
                const name = layer.feature && layer.feature.properties && layer.feature.properties.name;
                if (name) used.add(String(name).toLowerCase());
            });
        }
        let index = 1;
        while (used.has(`pasture ${index}`)) index += 1;
        return `Pasture ${index}`;
    }

    function renderPastureList() {
        if (!elements.pastureList || !drawnItems) return;
        const layers = drawnItems.getLayers();
        elements.pastureList.textContent = '';
        elements.pastureList.hidden = layers.length === 0;

        layers.forEach((layer, index) => {
            const properties = ensurePastureProperties(layer, `Pasture ${index + 1}`);
            const row = document.createElement('div');
            row.className = 'forage-pasture-row';

            const swatch = document.createElement('i');
            swatch.setAttribute('aria-hidden', 'true');

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.maxLength = 60;
            nameInput.value = properties.name;
            nameInput.setAttribute('aria-label', `Name for pasture ${index + 1}`);
            nameInput.addEventListener('change', () => {
                const name = nameInput.value.trim() || `Pasture ${index + 1}`;
                properties.name = name;
                nameInput.value = name;
                state.geometry = drawnItems.toGeoJSON();
                saveState();
                showToast(`${name} saved.`);
            });

            const acreage = document.createElement('span');
            acreage.textContent = `${formatAcres(getLayerAcres(layer))} ac`;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove ${properties.name}`);
            remove.addEventListener('click', () => {
                if (!window.confirm(`Remove ${properties.name} from this project?`)) return;
                drawnItems.removeLayer(layer);
                updateBoundaryUi();
                resetAnalysisStatus();
                showToast(`${properties.name} removed.`);
            });

            row.addEventListener('dblclick', (event) => {
                if (event.target === nameInput || event.target === remove) return;
                if (typeof layer.getBounds === 'function' && layer.getBounds().isValid()) {
                    map.fitBounds(layer.getBounds().pad(0.2), { maxZoom: 17 });
                }
            });
            row.title = 'Double-click to zoom to this pasture';
            row.append(swatch, nameInput, acreage, remove);
            elements.pastureList.appendChild(row);
        });
    }

    function updateBoundaryUi(options) {
        const settings = options || {};
        const summary = getBoundarySummary();
        const hasGeometry = summary.count > 0;
        elements.acreCount.textContent = formatAcres(summary.acres);
        elements.featureCount.textContent = String(summary.count);
        elements.mapArea.textContent = `${formatAcres(summary.acres)} acres`;
        elements.boundaryLayerStatus.textContent = hasGeometry ? `${summary.count} active` : 'Empty';
        elements.exportBoundary.disabled = !hasGeometry;
        elements.clearBoundary.disabled = !hasGeometry;
        elements.mapPrompt.hidden = hasGeometry;
        elements.mapHeading.textContent = hasGeometry ? `${state.projectName || 'Project'} · ${formatAcres(summary.acres)} acres` : 'Define an analysis area';
        renderPastureList();
        state.geometry = hasGeometry ? drawnItems.toGeoJSON() : null;
        saveState();

        if (settings.fit && hasGeometry) {
            const bounds = drawnItems.getBounds();
            if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
        }
    }

    function polygonFeaturesFromGeoJson(input) {
        const features = [];

        function visit(item, inheritedProperties) {
            if (!item || typeof item !== 'object') return;
            if (item.type === 'FeatureCollection' && Array.isArray(item.features)) {
                item.features.forEach((feature) => visit(feature));
                return;
            }
            if (item.type === 'Feature') {
                visit(item.geometry, item.properties || {});
                return;
            }
            if (item.type === 'GeometryCollection' && Array.isArray(item.geometries)) {
                item.geometries.forEach((geometry) => visit(geometry, inheritedProperties));
                return;
            }
            if (item.type === 'Polygon' && Array.isArray(item.coordinates)) {
                features.push({
                    type: 'Feature',
                    properties: { ...(inheritedProperties || {}) },
                    geometry: { type: 'Polygon', coordinates: item.coordinates }
                });
                return;
            }
            if (item.type === 'MultiPolygon' && Array.isArray(item.coordinates)) {
                item.coordinates.forEach((coordinates, index) => {
                    features.push({
                        type: 'Feature',
                        properties: { ...(inheritedProperties || {}), sourcePart: index + 1 },
                        geometry: { type: 'Polygon', coordinates }
                    });
                });
            }
        }

        visit(input);
        return features;
    }

    function addGeoJson(input, options) {
        const settings = options || {};
        const features = polygonFeaturesFromGeoJson(input);
        if (!features.length) throw new Error('No Polygon or MultiPolygon geometry was found.');

        features.forEach((feature) => {
            const geoLayer = L.geoJSON(feature, {
                style: boundaryStyle
            });
            geoLayer.eachLayer((layer) => {
                ensurePastureProperties(layer, nextPastureName());
                drawnItems.addLayer(layer);
            });
        });

        updateBoundaryUi({ fit: settings.fit !== false });
        return features.length;
    }

    function boundaryStyle() {
        return {
            color: '#8ee3b1',
            weight: 3,
            opacity: 1,
            fillColor: '#68d6df',
            fillOpacity: 0.18
        };
    }

    function initializeMap() {
        if (!window.L || !L.Control || !L.Control.Draw || !L.GeometryUtil) {
            elements.mapError.hidden = false;
            elements.mapPrompt.hidden = true;
            selectAll('[data-draw-boundary], [data-map-draw], [data-locate]').forEach((button) => {
                button.disabled = true;
            });
            elements.runButton.disabled = true;
            return;
        }

        map = L.map('foragewatch-map', {
            center: [46.8721, -113.9940],
            zoom: 9,
            minZoom: 3,
            zoomControl: true
        });

        baseLayers = {
            imagery: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
            }),
            streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            })
        };

        activeBaseLayer = baseLayers.imagery.addTo(map);
        Object.values(baseLayers).forEach((layer) => {
            layer.on('tileerror', () => {
                elements.basemapStatus.textContent = 'Basemap connection issue';
            });
            layer.on('load', () => {
                const label = elements.basemap.value === 'streets' ? 'Street basemap' : 'Satellite basemap';
                elements.basemapStatus.textContent = label;
            });
        });

        drawnItems = L.featureGroup().addTo(map);
        const drawControl = new L.Control.Draw({
            position: 'topleft',
            draw: {
                polyline: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polygon: {
                    allowIntersection: false,
                    showArea: true,
                    shapeOptions: boundaryStyle()
                },
                rectangle: {
                    showArea: true,
                    shapeOptions: boundaryStyle()
                }
            },
            edit: {
                featureGroup: drawnItems,
                remove: true
            }
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (event) => {
            ensurePastureProperties(event.layer, nextPastureName());
            drawnItems.addLayer(event.layer);
            updateBoundaryUi();
            showToast(`${event.layer.feature.properties.name} added. Draw again to add another pasture.`);
        });
        map.on(L.Draw.Event.DRAWSTART, () => {
            elements.mapPrompt.hidden = true;
        });
        map.on(L.Draw.Event.DRAWSTOP, () => {
            elements.mapPrompt.hidden = getBoundarySummary().count > 0;
        });
        map.on(L.Draw.Event.EDITED, () => {
            updateBoundaryUi();
            showToast('Boundary edits saved in this browser.');
        });
        map.on(L.Draw.Event.DELETED, () => {
            updateBoundaryUi();
            showToast('Selected pasture removed.');
        });

        if (state.geometry) {
            try {
                addGeoJson(state.geometry, { fit: true });
            } catch (error) {
                state.geometry = null;
                saveState();
                showToast('The previously saved boundary could not be restored.');
            }
        } else {
            updateBoundaryUi();
        }

        window.setTimeout(() => map.invalidateSize(), 0);
        if ('ResizeObserver' in window) {
            const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
            resizeObserver.observe(select('#foragewatch-map'));
        }
    }

    function startDrawing() {
        if (!map || !window.L || !L.Draw) {
            showToast('The drawing tools are not available. Reload after checking the connection.');
            return;
        }
        const drawer = new L.Draw.Polygon(map, {
            allowIntersection: false,
            showArea: true,
            shapeOptions: boundaryStyle()
        });
        drawer.enable();
        showToast('Click the map to place pasture corners. Click the first corner to finish.');
    }

    async function importBoundary(file) {
        if (!file || !map) return;
        try {
            if (file.size > 20 * 1024 * 1024) throw new Error('GeoJSON files must be smaller than 20 MB.');
            const text = await file.text();
            const input = JSON.parse(text);
            const count = addGeoJson(input, { fit: true });
            showToast(`${count} ${count === 1 ? 'pasture' : 'pastures'} imported from ${file.name}.`);
        } catch (error) {
            showToast(error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message);
        } finally {
            elements.boundaryFile.value = '';
        }
    }

    function exportBoundary() {
        const summary = getBoundarySummary();
        if (!drawnItems || !summary.count) {
            showToast('Add at least one pasture before exporting.');
            return;
        }

        const geoJson = drawnItems.toGeoJSON();
        geoJson.name = state.projectName;
        geoJson.properties = {
            exportedBy: 'Zubr ForageWatch',
            totalAcres: Number(summary.acres.toFixed(4))
        };
        const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const safeName = (state.projectName || 'forage-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'forage-project';
        anchor.href = url;
        anchor.download = `${safeName}.geojson`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        showToast('Boundary exported as GeoJSON.');
    }

    function clearBoundary() {
        const summary = getBoundarySummary();
        if (!drawnItems || !summary.count) return;
        const confirmed = window.confirm(`Clear ${summary.count} mapped ${summary.count === 1 ? 'pasture' : 'pastures'} from this project?`);
        if (!confirmed) return;
        drawnItems.clearLayers();
        state.geometry = null;
        updateBoundaryUi();
        resetAnalysisStatus();
        showToast('All pasture boundaries cleared from this browser.');
    }

    function locateUser() {
        if (!map || !navigator.geolocation) {
            showToast('Location is not available in this browser.');
            return;
        }
        showToast('Requesting your location…');
        navigator.geolocation.getCurrentPosition((position) => {
            const latlng = [position.coords.latitude, position.coords.longitude];
            map.setView(latlng, 15);
            if (locationMarker) map.removeLayer(locationMarker);
            locationMarker = L.circleMarker(latlng, {
                radius: 7,
                color: '#ffffff',
                weight: 2,
                fillColor: '#68d6df',
                fillOpacity: 1
            }).addTo(map).bindTooltip('Your approximate location');
            showToast('Map centered on your location.');
        }, (error) => {
            const message = error.code === error.PERMISSION_DENIED ? 'Location permission was not granted.' : 'Your location could not be determined.';
            showToast(message);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }

    function switchBasemap(value) {
        if (!map || !baseLayers || !baseLayers[value]) return;
        if (activeBaseLayer) map.removeLayer(activeBaseLayer);
        activeBaseLayer = baseLayers[value].addTo(map);
        activeBaseLayer.bringToBack();
        elements.basemapStatus.textContent = value === 'streets' ? 'Street basemap' : 'Satellite basemap';
        state.basemap = value;
        saveState();
    }

    function applyMode(mode, options) {
        const settings = options || {};
        state.mode = mode === 'uav' ? 'uav' : 'public';
        selectAll('[data-mode]').forEach((button) => {
            const active = button.dataset.mode === state.mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        elements.publicSource.hidden = state.mode !== 'public';
        elements.uavSource.hidden = state.mode !== 'uav';
        selectAll('[data-uav-metric] input').forEach((input) => {
            input.disabled = state.mode !== 'uav';
            if (state.mode === 'public') input.checked = false;
        });
        collectMetrics();
        resetAnalysisStatus();
        saveState();
        if (!settings.silent) {
            const message = state.mode === 'public'
                ? 'Public satellite mode uses open imagery settings and enables biomass.'
                : 'UAV detail mode enables protein/N, NDF, and silica request setup.';
            showToast(message);
        }
    }

    function collectMetrics() {
        state.metrics = selectAll('[data-metric]:checked:not(:disabled)').map((input) => input.value);
        saveState();
    }

    function stageUavFile(file) {
        if (!file) return;
        const extension = file.name.toLowerCase().split('.').pop();
        const allowed = ['tif', 'tiff', 'las', 'laz', 'zip'];
        if (!allowed.includes(extension)) {
            elements.uavFile.value = '';
            showToast('Choose a GeoTIFF, LAS/LAZ, or ZIP file.');
            return;
        }

        runtimeUavFile = file;
        state.uavMetadata = { name: file.name, size: file.size, type: file.type || extension };
        showUavMetadata(state.uavMetadata, false);
        saveState();
        showToast(`${file.name} is staged in this browser session.`);
    }

    function showUavMetadata(metadata, restored) {
        if (!metadata) {
            elements.uavFileStatus.hidden = true;
            return;
        }
        elements.uavFileStatus.hidden = false;
        elements.uavFileName.textContent = metadata.name;
        elements.uavFileMeta.textContent = restored
            ? `${formatBytes(metadata.size)} · reselect file to analyze`
            : `${formatBytes(metadata.size)} · staged in this browser only`;
    }

    function setStage(stage, status, label) {
        const item = select(`[data-stage="${stage}"]`);
        if (!item) return;
        item.classList.remove('is-complete', 'is-error', 'is-running');
        if (status) item.classList.add(`is-${status}`);
        const output = item.querySelector('b');
        if (output) output.textContent = label;
    }

    function resetAnalysisStatus() {
        window.clearTimeout(runTimer);
        elements.runButton.disabled = false;
        elements.runButton.firstChild.textContent = 'Run estimate ';
        elements.statusCard.dataset.analysisStatus = 'idle';
        elements.statusTitle.textContent = 'Ready for inputs';
        elements.statusTime.textContent = 'No analysis has run';
        elements.statusMessage.textContent = 'Add one or more pastures, choose a target layer, then run the estimate.';
        setStage('boundary', '', 'Waiting');
        setStage('source', '', 'Waiting');
        setStage('model', '', 'Unavailable');
        setStage('publish', '', 'Waiting');
    }

    function setInputError(title, message, stage) {
        elements.statusCard.dataset.analysisStatus = 'failed';
        elements.statusTitle.textContent = title;
        elements.statusTime.textContent = 'Request not started';
        elements.statusMessage.textContent = message;
        if (stage) setStage(stage, 'error', 'Required');
        elements.statusCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function runEstimate() {
        const summary = getBoundarySummary();
        collectMetrics();
        resetAnalysisStatus();

        if (!summary.count) {
            setInputError('Pasture required', 'Draw or upload at least one pasture before running an estimate.', 'boundary');
            return;
        }
        if (!state.metrics.length) {
            setInputError('Target layer required', 'Select at least one target layer for this request.');
            return;
        }
        if (state.mode === 'uav' && !runtimeUavFile) {
            setInputError('UAV capture required', 'Stage a UAV capture for this browser session before requesting detailed forage layers.', 'source');
            return;
        }

        elements.runButton.disabled = true;
        elements.runButton.firstChild.textContent = 'Validating… ';
        elements.statusCard.dataset.analysisStatus = 'validating';
        elements.statusTitle.textContent = 'Validating request';
        elements.statusTime.textContent = 'Running locally';
        elements.statusMessage.textContent = 'Pastures and source settings are valid. Checking for an approved prediction model.';
        setStage('boundary', 'complete', 'Valid');
        setStage('source', 'complete', 'Valid');
        setStage('model', 'running', 'Checking');
        setStage('publish', '', 'Waiting');

        runTimer = window.setTimeout(() => {
            const nonBiomass = state.metrics.filter((metric) => metric !== 'biomass');
            const metricNames = {
                protein: 'protein/N',
                ndf: 'NDF',
                silica: 'silica',
                ventenata: 'Ventenata dubia detection'
            };
            const unavailable = [];
            if (state.metrics.includes('biomass')) unavailable.push('biomass');
            nonBiomass.forEach((metric) => unavailable.push(metricNames[metric] || metric));

            elements.runButton.disabled = false;
            elements.runButton.firstChild.textContent = 'Run estimate ';
            elements.statusCard.dataset.analysisStatus = 'failed';
            elements.statusTitle.textContent = 'No approved model available';
            elements.statusTime.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            elements.statusMessage.textContent = `The ${unavailable.join(', ')} request is valid and saved, but no calibrated prediction model is installed. No estimate or map layer was produced.`;
            setStage('model', 'error', 'No model');
            setStage('publish', '', 'Not started');
            showToast('Request validated. Prediction stopped because no approved model is available.');
        }, 700);
    }

    function openPrivateDialog() {
        if (!elements.privateDialog) return;
        if (typeof elements.privateDialog.showModal === 'function') elements.privateDialog.showModal();
        else elements.privateDialog.setAttribute('open', '');
    }

    function constrainedNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function updateHerdDemand(options) {
        const settings = options || {};
        state.herd.animalType = elements.animalType.value;
        state.herd.count = constrainedNumber(elements.animalCount.value, 1, 10000, 100);
        state.herd.weight = constrainedNumber(elements.animalWeight.value, 50, 3000, 1200);
        state.herd.grazingDays = constrainedNumber(elements.grazingDays.value, 1, 365, 30);
        state.herd.allowableUse = constrainedNumber(elements.allowableUse.value, 10, 50, 25);

        const animalUnits = state.herd.count * (state.herd.weight / 1000);
        const aum = animalUnits * (state.herd.grazingDays / 30);
        elements.herdAum.textContent = aum >= 100 ? aum.toFixed(0) : aum.toFixed(1);
        elements.allowableUseOutput.textContent = `${state.herd.allowableUse}%`;
        saveState();
        if (!settings.silent) resetAnalysisStatus();
    }

    function restoreFormState() {
        elements.projectName.value = state.projectName;
        elements.source.value = state.source;
        elements.fieldSeason.value = state.fieldSeason;
        elements.basemap.value = state.basemap === 'streets' ? 'streets' : 'imagery';
        elements.animalType.value = state.herd.animalType;
        elements.animalCount.value = String(state.herd.count);
        elements.animalWeight.value = String(state.herd.weight);
        elements.grazingDays.value = String(state.herd.grazingDays);
        elements.allowableUse.value = String(state.herd.allowableUse);
        selectAll('[data-metric]').forEach((input) => {
            input.checked = state.metrics.includes(input.value);
        });
        if (state.uavMetadata) showUavMetadata(state.uavMetadata, true);
        updateHerdDemand({ silent: true });
        applyMode(state.mode, { silent: true });
    }

    function bindEvents() {
        selectAll('[data-draw-boundary], [data-map-draw]').forEach((button) => button.addEventListener('click', startDrawing));
        select('[data-upload-boundary]').addEventListener('click', () => elements.boundaryFile.click());
        elements.boundaryFile.addEventListener('change', () => importBoundary(elements.boundaryFile.files[0]));
        elements.exportBoundary.addEventListener('click', exportBoundary);
        elements.clearBoundary.addEventListener('click', clearBoundary);
        select('[data-locate]').addEventListener('click', locateUser);
        elements.basemap.addEventListener('change', () => switchBasemap(elements.basemap.value));
        selectAll('[data-mode]').forEach((button) => button.addEventListener('click', () => applyMode(button.dataset.mode)));
        selectAll('[data-open-private]').forEach((button) => button.addEventListener('click', openPrivateDialog));
        const layerPanel = select('[data-layer-panel]');
        const layerPanelBody = select('[data-layer-panel-body]');
        const layerPanelToggle = select('[data-toggle-layer-panel]');
        const layerToggleLabel = select('[data-layer-toggle-label]');
        layerPanelToggle.addEventListener('click', () => {
            const expanded = layerPanelToggle.getAttribute('aria-expanded') === 'true';
            layerPanelToggle.setAttribute('aria-expanded', String(!expanded));
            layerPanelBody.hidden = expanded;
            layerPanel.classList.toggle('is-collapsed', expanded);
            layerToggleLabel.textContent = expanded ? 'Show' : 'Hide';
        });
        select('[data-upload-uav]').addEventListener('click', () => elements.uavFile.click());
        elements.uavFile.addEventListener('change', () => stageUavFile(elements.uavFile.files[0]));
        selectAll('[data-metric]').forEach((input) => input.addEventListener('change', collectMetrics));
        elements.runButton.addEventListener('click', runEstimate);

        elements.projectName.addEventListener('input', () => {
            state.projectName = elements.projectName.value.trim() || 'Untitled forage project';
            const summary = getBoundarySummary();
            if (summary.count) elements.mapHeading.textContent = `${state.projectName} · ${formatAcres(summary.acres)} acres`;
            saveState();
        });
        elements.source.addEventListener('change', () => {
            state.source = elements.source.value;
            saveState();
            resetAnalysisStatus();
        });
        elements.fieldSeason.addEventListener('change', () => {
            state.fieldSeason = elements.fieldSeason.value;
            saveState();
            resetAnalysisStatus();
        });
        const defaultWeights = { cow: 1200, pair: 1500, yearling: 750, sheep: 150, horse: 1100 };
        elements.animalType.addEventListener('change', () => {
            elements.animalWeight.value = String(defaultWeights[elements.animalType.value] || 1000);
            updateHerdDemand();
        });
        [elements.animalCount, elements.animalWeight, elements.grazingDays, elements.allowableUse].forEach((input) => {
            input.addEventListener('input', () => updateHerdDemand());
        });

        selectAll('[data-layer]').forEach((button) => {
            button.addEventListener('click', () => {
                const layer = button.dataset.layer;
                if (layer === 'boundary') {
                    const summary = getBoundarySummary();
                    if (summary.count && drawnItems.getBounds().isValid()) {
                        map.fitBounds(drawnItems.getBounds().pad(0.15), { maxZoom: 16 });
                    } else {
                        showToast('Add a pasture boundary to activate this layer.');
                    }
                    return;
                }
                const labels = { biomass: 'Biomass', protein: 'Protein / N', ndf: 'NDF', silica: 'Silica', ventenata: 'Ventenata dubia' };
                showToast(`${labels[layer]} is unavailable because no approved model is installed.`);
            });
        });
    }

    restoreFormState();
    bindEvents();
    initializeMap();
    if (state.basemap === 'streets') switchBasemap('streets');

    window.ZubrForageWatch = {
        exportProject: () => ({ ...state, geometry: drawnItems ? drawnItems.toGeoJSON() : null }),
        getBoundarySummary,
        startDrawing
    };
})();
