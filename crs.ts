import proj4 from 'proj4';
import type { CRSConfig } from './types';
import { formatMeridian } from './provinces';

/**
 * Bộ 7 tham số chuyển đổi VN-2000 ⇄ WGS-84 thường dùng của Bộ TN&MT.
 * Lưu ý: đây là bộ tham số quốc gia; một số tỉnh công bố bộ tham số riêng hoặc
 * tọa độ được xác định qua lưới khống chế địa phương. Sai số thực tế thường ở
 * mức dưới mét đến mét – KHÔNG dùng để thay thế hiệu chuẩn trạm base RTK.
 */
export const TOWGS84 =
  '-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278';

interface Converter {
  forward(coords: number[]): number[];
  inverse(coords: number[]): number[];
}

const cache = new Map<string, Converter>();

/** Định nghĩa proj4 cho phép chiếu VN-2000 (ellipsoid WGS-84, TM, x0 = 500 000). */
export function projDef(crs: CRSConfig): string {
  return (
    `+proj=tmerc +lat_0=0 +lon_0=${crs.lon0} +k=${crs.k} +x_0=500000 +y_0=0 ` +
    `+ellps=WGS84 +towgs84=${TOWGS84} +units=m +no_defs`
  );
}

function converter(crs: CRSConfig): Converter {
  const key = `${crs.lon0}|${crs.k}`;
  let c = cache.get(key);
  if (!c) {
    c = proj4('EPSG:4326', projDef(crs)) as unknown as Converter;
    cache.set(key, c);
  }
  return c;
}

/** WGS-84 (B, L) → VN-2000 (X = Bắc, Y = Đông). */
export function toGrid(lat: number, lon: number, crs: CRSConfig): { x: number; y: number } {
  const r = converter(crs).forward([lon, lat]);
  return { x: r[1], y: r[0] };
}

/** VN-2000 (X, Y) → WGS-84 (B, L). */
export function toWgs(x: number, y: number, crs: CRSConfig): { lat: number; lon: number } {
  const r = converter(crs).inverse([y, x]);
  return { lat: r[1], lon: r[0] };
}

export function makeCrs(mode: 3 | 6, lon0: number, areaLabel: string): CRSConfig {
  return { mode, lon0, k: mode === 3 ? 0.9999 : 0.9996, areaLabel };
}

export function crsSummary(crs: CRSConfig): string {
  return `VN-2000 · ${crs.mode}° · KTT ${formatMeridian(crs.lon0)} · k0=${crs.k}`;
}

export function crsShort(crs: CRSConfig): string {
  return `KTT ${formatMeridian(crs.lon0)} · ${crs.mode}°`;
}
