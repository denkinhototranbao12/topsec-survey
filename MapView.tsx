import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Basemap, Project, SurveyPoint } from '../lib/types';
import { toGrid } from '../lib/crs';
import { fmt, uid } from '../lib/format';
import { polygonMetrics } from '../lib/geo';

export interface MapHandle {
  fit: () => void;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
  locate: () => void;
}

interface MapViewProps {
  project: Project | null;
  points: SurveyPoint[];
  selectedIds: string[];
  basemap: Basemap;
  onBasemapChange: (b: Basemap) => void;
  onPick: (id: string | null) => void;
  onAddPoints: (pts: SurveyPoint[]) => void;
  onCursor: (c: { lat: number; lon: number } | null) => void;
  onToast: (message: string) => void;
}

const BASEMAPS = {
  sat: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics',
  },
  osm: {
    // CARTO dùng dữ liệu OpenStreetMap; tile.openstreetmap.org thường bị chặn DNS ở Việt Nam.
    tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors © CARTO',
  },
};

const LAYER_IDS = {
  clusters: 'points-clusters',
  unclustered: 'points-unclustered',
  selected: 'points-selected',
};

/** Màu điểm theo nguồn — dùng chung cho lớp bản đồ và chú thích. */
const SOURCE_META: Array<{ key: SurveyPoint['source']; label: string; color: string }> = [
  { key: 'import', label: 'Nhập tệp', color: '#12306b' },
  { key: 'measure', label: 'Đo trên bản đồ', color: '#b45309' },
  { key: 'gps', label: 'GPS điện thoại', color: '#d6101a' },
  { key: 'manual', label: 'Nhập tay', color: '#0f766e' },
  { key: 'cogo', label: 'Tính toán COGO', color: '#7c3aed' },
];

const SOURCE_COLOR_EXPR = [
  'match',
  ['get', 'source'],
  ...SOURCE_META.flatMap((s) => [s.key, s.color]),
  '#0f766e',
];

interface Feature {
  type: 'Feature';
  id?: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] as Feature[] };
}

function pointsToFC(points: SurveyPoint[]) {
  return {
    type: 'FeatureCollection',
    features: points.map<Feature>((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        code: p.code,
        source: p.source,
        x: p.x,
        y: p.y,
        h: p.h,
        acc: p.accuracy,
      },
    })),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Xấp xỉ vòng tròn sai số bằng đa giác 64 cạnh. */
function accuracyPolygon(lat: number, lon: number, radiusM: number) {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    coords.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]);
  }
  return coords;
}

const MapView = forwardRef<MapHandle, MapViewProps>(function MapView(
  { project, points, selectedIds, basemap, onBasemapChange, onPick, onAddPoints, onCursor, onToast },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const basemapRef = useRef<Basemap>(basemap);
  const measureOnRef = useRef(false);
  const callbacks = useRef({ onPick, onAddPoints, onCursor, onToast });
  callbacks.current = { onPick, onAddPoints, onCursor, onToast };

  const [ready, setReady] = useState(false);
  const [measureOn, setMeasureOn] = useState(false);
  const [vertices, setVertices] = useState<[number, number][]>([]);

  measureOnRef.current = measureOn;
  basemapRef.current = basemap;

  // Số điểm theo nguồn, để chú thích đúng những màu đang có trên bản đồ.
  const legend = useMemo(() => {
    const counts = new Map<SurveyPoint['source'], number>();
    for (const p of points) counts.set(p.source, (counts.get(p.source) ?? 0) + 1);
    return SOURCE_META.map((s) => ({ ...s, count: counts.get(s.key) ?? 0 })).filter((s) => s.count > 0);
  }, [points]);

  // ---------- khởi tạo bản đồ ----------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6f1' } }],
      } as unknown as maplibregl.StyleSpecification,
      center: [106.4, 16.2],
      zoom: 5,
      maxZoom: 22,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Ảnh nền lỗi (mất mạng, DNS chặn): báo một lần thay vì để bản đồ trống.
    let basemapWarned = false;
    map.on('error', (e) => {
      const sourceId = (e as unknown as { sourceId?: string }).sourceId;
      if (sourceId !== 'basemap' || basemapWarned) return;
      basemapWarned = true;
      callbacks.current.onToast('Không tải được ảnh nền bản đồ — kiểm tra mạng hoặc chọn nền khác.');
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const applyBase = (kind: Basemap) => {
      if (map.getLayer('basemap')) map.removeLayer('basemap');
      if (map.getSource('basemap')) map.removeSource('basemap');
      if (kind === 'none' || !map.isStyleLoaded()) return;
      const cfg = BASEMAPS[kind];
      map.addSource('basemap', {
        type: 'raster',
        tiles: cfg.tiles,
        tileSize: 256,
        attribution: cfg.attribution,
        maxzoom: 19,
      } as unknown as maplibregl.SourceSpecification);
      const before = map.getLayer(LAYER_IDS.clusters) ? LAYER_IDS.clusters : undefined;
      map.addLayer(
        {
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 120 },
        } as unknown as maplibregl.LayerSpecification,
        before,
      );
    };

    const addDataLayers = () => {
      if (map.getSource('points')) return;
      map.addSource('points', {
        type: 'geojson',
        data: emptyFC(),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 46,
        promoteId: 'id',
      } as unknown as maplibregl.SourceSpecification);
      map.addSource('selected', {
        type: 'geojson',
        data: emptyFC(),
        promoteId: 'id',
      } as unknown as maplibregl.SourceSpecification);
      map.addSource('measure', { type: 'geojson', data: emptyFC() } as unknown as maplibregl.SourceSpecification);
      map.addSource('me', { type: 'geojson', data: emptyFC() } as unknown as maplibregl.SourceSpecification);

      map.addLayer({
        id: LAYER_IDS.clusters,
        type: 'circle',
        source: 'points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#12306b',
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.9)',
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23, 200, 29, 1000, 36],
        },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: LAYER_IDS.unclustered,
        type: 'circle',
        source: 'points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': SOURCE_COLOR_EXPR,
          'circle-radius': 4.5,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#ffffff',
        },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: LAYER_IDS.selected,
        type: 'circle',
        source: 'selected',
        paint: {
          'circle-color': '#f59e0b',
          'circle-radius': 9,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: 'measure-fill',
        type: 'fill',
        source: 'measure',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#d6101a', 'fill-opacity': 0.12 },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure',
        filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
        paint: { 'line-color': '#d6101a', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'measure',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#12306b',
          'circle-radius': 5,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      } as unknown as maplibregl.LayerSpecification);

      map.addLayer({
        id: 'me-fill',
        type: 'fill',
        source: 'me',
        paint: { 'fill-color': '#0f766e', 'fill-opacity': 0.1 },
      } as unknown as maplibregl.LayerSpecification);
      map.addLayer({
        id: 'me-line',
        type: 'line',
        source: 'me',
        paint: { 'line-color': '#0f766e', 'line-width': 1.5 },
      } as unknown as maplibregl.LayerSpecification);
    };

    map.on('load', () => {
      addDataLayers();
      applyBase(basemapRef.current);
      setReady(true);
    });

    map.on('click', (e) => {
      if (measureOnRef.current) {
        setVertices((v) => [...v, [e.lngLat.lat, e.lngLat.lng]]);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.unclustered] });
      if (feats.length) {
        const props = feats[0].properties as Record<string, unknown>;
        const id = String(props.id ?? '');
        callbacks.current.onPick(id);
        openPopup(map, e.lngLat, props);
        return;
      }
      const clusters = map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.clusters] });
      if (clusters.length) {
        const props = clusters[0].properties as Record<string, unknown>;
        const source = map.getSource('points') as maplibregl.GeoJSONSource | undefined;
        const clusterId = Number(props.cluster_id);
        const maybePromise = source?.getClusterExpansionZoom(clusterId) as unknown as Promise<number> | undefined;
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then((zoom) => map.easeTo({ center: e.lngLat, zoom: Math.min(22, zoom + 0.4) }))
            .catch(() => undefined);
        }
        return;
      }
      callbacks.current.onPick(null);
    });

    let raf = 0;
    map.on('mousemove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        callbacks.current.onCursor({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });
    });
    map.on('mouseout', () => callbacks.current.onCursor(null));

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      meMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  function openPopup(map: maplibregl.Map, lngLat: maplibregl.LngLat, props: Record<string, unknown>) {
    const h = props.h;
    const acc = props.acc;
    const html =
      `<div class="pp-title">${escapeHtml(String(props.name ?? ''))}</div>` +
      (String(props.code ?? '') ? `<div class="pp-row">${escapeHtml(String(props.code))}</div>` : '') +
      `<div class="pp-row">X ${fmt(Number(props.x), 3)} &nbsp; Y ${fmt(Number(props.y), 3)}</div>` +
      (typeof h === 'number' ? `<div class="pp-row">H ${fmt(h, 3)}</div>` : '') +
      (typeof acc === 'number' ? `<div class="pp-row">±${fmt(acc, 1)} m</div>` : '');
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  // ---------- đồng bộ dữ liệu ----------
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource('points') as maplibregl.GeoJSONSource | undefined;
    source?.setData(pointsToFC(points) as never);
  }, [points, ready]);

  useEffect(() => {
    if (!ready) return;
    const set = new Set(selectedIds);
    const source = mapRef.current?.getSource('selected') as maplibregl.GeoJSONSource | undefined;
    source?.setData(pointsToFC(points.filter((p) => set.has(p.id))) as never);
  }, [selectedIds, points, ready]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const source = map?.getSource('measure') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: unknown[] = vertices.map((v) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [v[1], v[0]] },
    }));
    if (vertices.length >= 2) {
      const line = vertices.map((v) => [v[1], v[0]]);
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
      if (vertices.length >= 3) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...line, line[0]]] },
        });
      }
    }
    source.setData({ type: 'FeatureCollection', features } as never);
  }, [vertices, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    const before = map.getLayer(LAYER_IDS.clusters) ? LAYER_IDS.clusters : undefined;
    if (map.getLayer('basemap')) map.removeLayer('basemap');
    if (map.getSource('basemap')) map.removeSource('basemap');
    if (basemap === 'none') return;
    const cfg = BASEMAPS[basemap];
    map.addSource('basemap', {
      type: 'raster',
      tiles: cfg.tiles,
      tileSize: 256,
      attribution: cfg.attribution,
      maxzoom: 19,
    } as unknown as maplibregl.SourceSpecification);
    map.addLayer(
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 120 },
      } as unknown as maplibregl.LayerSpecification,
      before,
    );
  }, [basemap, ready]);

  // ---------- fit khi đổi công trình ----------
  useEffect(() => {
    if (!ready) return;
    if (!points.length) {
      mapRef.current?.easeTo({ center: [106.4, 16.2], zoom: 5 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend([p.lon, p.lat]));
    mapRef.current?.fitBounds(bounds, { padding: 70, maxZoom: 18, duration: 500 });
    // Chỉ chạy khi đổi công trình, không chạy lại mỗi lần thêm điểm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, project?.id]);

  const metrics = useMemo(() => {
    if (!project || vertices.length === 0) return null;
    const xy = vertices.map((v) => toGrid(v[0], v[1], project.crs));
    const poly = polygonMetrics(xy);
    let distance = 0;
    for (let i = 1; i < xy.length; i++) {
      distance += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
    }
    return { ...poly, distance, count: xy.length };
  }, [vertices, project]);

  const locate = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      onToast('Thiết bị không hỗ trợ định vị.');
      return;
    }
    onToast('Đang lấy vị trí…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        meMarkerRef.current?.remove();
        meMarkerRef.current = new maplibregl.Marker({ color: '#0f766e' })
          .setLngLat([longitude, latitude])
          .addTo(map);
        const source = map.getSource('me') as maplibregl.GeoJSONSource | undefined;
        source?.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [accuracyPolygon(latitude, longitude, Math.max(5, accuracy))] },
            },
          ],
        } as never);
        map.easeTo({ center: [longitude, latitude], zoom: 17 });
        onToast(`Vị trí hiện tại · sai số ±${accuracy.toFixed(0)} m (GPS trình duyệt)`);
      },
      (err) => onToast(`Không lấy được vị trí: ${err.message}`),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        const map = mapRef.current;
        if (!map || !points.length) return;
        const bounds = new maplibregl.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lon, p.lat]));
        map.fitBounds(bounds, { padding: 70, maxZoom: 18, duration: 500 });
      },
      flyTo: (lat: number, lon: number, zoom = 18) => {
        mapRef.current?.flyTo({ center: [lon, lat], zoom });
      },
      locate,
    }),
    [points],
  );

  const saveVertices = () => {
    if (!project || vertices.length === 0) return;
    const now = Date.now();
    const start = points.length + 1;
    const created: SurveyPoint[] = vertices.map((v, i) => {
      const g = toGrid(v[0], v[1], project.crs);
      return {
        id: uid('ms'),
        projectId: project.id,
        name: `T${String(start + i).padStart(3, '0')}`,
        code: 'Đo bản đồ',
        book: 'Đo trên bản đồ',
        note: '',
        lat: v[0],
        lon: v[1],
        x: g.x,
        y: g.y,
        h: null,
        hEll: null,
        accuracy: null,
        source: 'measure',
        createdAt: now,
      };
    });
    onAddPoints(created);
    setVertices([]);
    setMeasureOn(false);
    onToast(`Đã lưu ${created.length} đỉnh vào sổ đo.`);
  };

  return (
    <div className="map-wrap">
      <div id="map" ref={containerRef} />

      <div className="basemap" role="group" aria-label="Nền bản đồ">
        <button aria-pressed={basemap === 'sat'} onClick={() => onBasemapChange('sat')}>
          Vệ tinh
        </button>
        <button aria-pressed={basemap === 'osm'} onClick={() => onBasemapChange('osm')}>
          Bản đồ
        </button>
        <button aria-pressed={basemap === 'none'} onClick={() => onBasemapChange('none')}>
          Trống
        </button>
      </div>

      {legend.length ? (
        <div className="map-legend" aria-label="Chú thích màu điểm">
          <div className="map-legend-title">Chấm trên bản đồ</div>
          {legend.map((s) => (
            <div key={s.key} className="map-legend-row">
              <span className="dot" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="map-legend-count">{fmt(s.count, 0)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="map-tools">
        <button
          className={`icon-btn${measureOn ? ' active' : ''}`}
          title="Đo khoảng cách / diện tích"
          aria-label="Đo khoảng cách, diện tích"
          onClick={() => {
            setMeasureOn((v) => !v);
            if (measureOn) setVertices([]);
          }}
        >
          📐
        </button>
        <button className="icon-btn" title="Vị trí của tôi" aria-label="Vị trí của tôi" onClick={locate}>
          ◎
        </button>
        <button
          className="icon-btn"
          title="Xem toàn bộ điểm"
          aria-label="Xem toàn bộ điểm"
          onClick={() => {
            const map = mapRef.current;
            if (!map || !points.length) return;
            const bounds = new maplibregl.LngLatBounds();
            points.forEach((p) => bounds.extend([p.lon, p.lat]));
            map.fitBounds(bounds, { padding: 70, maxZoom: 18, duration: 500 });
          }}
        >
          ⤢
        </button>
      </div>

      {measureOn ? <div className="hint">Chạm lên bản đồ để đặt đỉnh · chạm vào điểm cuối để chỉnh</div> : null}

      {measureOn ? (
        <div className="measure">
          <h4>Đo trên bản đồ</h4>
          {metrics ? (
            <>
              <div className="big">{fmt(metrics.area, 1)} m²</div>
              <div className="kv">
                <span>Diện tích</span>
                <span>{fmt(metrics.area / 10_000, 4)} ha</span>
              </div>
              <div className="kv">
                <span>Chu vi</span>
                <span>{fmt(metrics.perimeter, 2)} m</span>
              </div>
              <div className="kv">
                <span>Đường gấp khúc</span>
                <span>{fmt(metrics.distance, 2)} m</span>
              </div>
              <div className="kv">
                <span>Số đỉnh</span>
                <span>{metrics.count}</span>
              </div>
            </>
          ) : (
            <p className="note">Chạm lên bản đồ để bắt đầu. Từ 3 đỉnh trở lên sẽ tính diện tích.</p>
          )}
          <div className="actions">
            <button className="btn btn-sm" onClick={() => setVertices((v) => v.slice(0, -1))} disabled={!vertices.length}>
              Hoàn tác
            </button>
            <button className="btn btn-sm" onClick={() => setVertices([])} disabled={!vertices.length}>
              Xóa
            </button>
            <button className="btn btn-sm btn-primary" onClick={saveVertices} disabled={!vertices.length}>
              Lưu thành điểm
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export default MapView;
