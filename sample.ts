import { toGrid, toWgs } from './crs';
import type { CRSConfig, SurveyPoint } from './types';
import { uid } from './format';

interface SampleOptions {
  projectId: string;
  crs: CRSConfig;
  center?: { lat: number; lon: number };
}

/**
 * Sinh dữ liệu mẫu để xem giao diện và thử hiệu năng (không phải dữ liệu thật).
 * Gồm một lưới khảo sát, một thửa đất và vài điểm đo rời.
 */
export function buildSamplePoints({ projectId, crs, center }: SampleOptions): SurveyPoint[] {
  const origin = center ?? { lat: 10.8506, lon: 106.7717 }; // Thủ Đức, TP. Hồ Chí Minh
  const c = toGrid(origin.lat, origin.lon, crs);
  const now = Date.now();
  const points: SurveyPoint[] = [];

  const push = (
    index: number,
    offsetX: number,
    offsetY: number,
    book: string,
    source: SurveyPoint['source'],
    accuracy: number | null,
    code: string,
  ) => {
    const x = c.x + offsetX;
    const y = c.y + offsetY;
    const w = toWgs(x, y, crs);
    points.push({
      id: uid('sm'),
      projectId,
      name: `M${String(index).padStart(3, '0')}`,
      code,
      book,
      note: '',
      lat: w.lat,
      lon: w.lon,
      x,
      y,
      h: null,
      hEll: null,
      accuracy,
      source,
      createdAt: now - index * 60_000,
    });
  };

  // Lưới khảo sát 20 × 30 ô, bước 8 m.
  let n = 1;
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 20; col++) {
      push(n, (col - 10) * 8, (row - 15) * 8, 'Lưới khảo sát mẫu', 'import', 0.02, 'LUOI');
      n++;
    }
  }

  // Thửa đất: 24 đỉnh trên đường tròn bán kính 45 m.
  const cx = c.x + 160;
  const cy = c.y + 120;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    push(n, cx - c.x + Math.cos(a) * 45, cy - c.y + Math.sin(a) * 34, 'Thửa đất mẫu', 'measure', 0.05, 'THUA');
    n++;
  }

  // Điểm đo rời bằng GPS điện thoại (sai số lớn, để minh hoạ phân biệt nguồn).
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.4;
    push(n, -190 + Math.cos(a) * 70, 150 + Math.sin(a) * 55, 'Đo GPS mẫu', 'gps', 3.5 + (i % 5) * 0.8, 'GPS');
    n++;
  }

  return points;
}
