import type { CRSConfig } from './types';

export interface ParsedPoint {
  name: string;
  code: string;
  x: number | null;
  y: number | null;
  h: number | null;
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
}

export type ParseFormat = 'csv' | 'txt' | 'geojson' | 'kml' | 'backup';

export interface ParseResult {
  points: ParsedPoint[];
  skipped: number;
  /** Hệ tọa độ mà tệp có vẻ đang dùng. */
  kind: 'grid' | 'wgs' | 'unknown';
  format: ParseFormat;
  warnings: string[];
  columns: string[];
  backupCrs?: CRSConfig;
  backupProjectName?: string;
}

const FIELDS: Record<keyof ParsedPoint | 'ignore', string[]> = {
  name: ['ten', 'ten_diem', 'name', 'diem', 'point', 'diem_do', 'ky_hieu', 'id'],
  code: ['ma', 'code', 'ma_hieu', 'ma_diem', 'loai', 'nhom'],
  x: ['x', 'bac', 'northing', 'toa_do_x', 'n'],
  y: ['y', 'dong', 'easting', 'toa_do_y', 'e'],
  h: ['h', 'cao', 'cao_do', 'do_cao', 'z', 'elev', 'elevation', 'docao'],
  lat: ['b', 'lat', 'vi_do', 'vido', 'latitude'],
  lon: ['l', 'lon', 'kinh_do', 'kinhdo', 'longitude'],
  accuracy: ['sai_so', 'saiso', 'acc', 'accuracy', 'hdop', 'sai_so_ngang'],
  ignore: ['ghi_chu', 'note', 'thoi_gian', 'ngay', 'time', 'nguon', 'source'],
};

function normalizeKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const FIELD_ORDER: Array<keyof ParsedPoint> = ['name', 'code', 'x', 'y', 'h', 'lat', 'lon', 'accuracy'];

/** Nhận diện cột theo tiêu đề, chịu được đơn vị và từ đệm: “Tọa độ X (m)”, “Cao độ (m)”. */
function matchField(rawHeader: string): keyof ParsedPoint | null {
  const key = normalizeKey(rawHeader);
  if (!key) return null;
  for (const field of FIELD_ORDER) if (FIELDS[field].includes(key)) return field;
  for (const field of FIELD_ORDER) {
    if (FIELDS[field].some((alias) => alias.includes('_') && key.includes(alias))) return field;
  }
  const tokens = key.split('_').filter(Boolean);
  for (const field of FIELD_ORDER) if (FIELDS[field].some((alias) => tokens.includes(alias))) return field;
  return null;
}

function mapHeader(headers: string[]): Partial<Record<keyof ParsedPoint, number>> {
  const map: Partial<Record<keyof ParsedPoint, number>> = {};
  headers.forEach((h, i) => {
    const field = matchField(h);
    if (field && map[field] === undefined) map[field] = i;
  });
  return map;
}

/** Đọc số kiểu Việt Nam/Excel: 1.200.039,83 · 1,200,039.83 · 1200039.83 · 25,1 */
function toNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.trim().replace(/\s|'/g, '');
  if (!s) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    // 1,200,039 → dấu phẩy là phân cách hàng nghìn; 25,1 → dấu thập phân.
    s = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join('') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectDelimiter(line: string): string {
  // Bỏ phần trong ngoặc kép: số kiểu "1.200.039,830" có dấu phẩy bên trong.
  const bare = line.replace(/"[^"]*"/g, '');
  const candidates = ['\t', ';', ',', '|'];
  let best = ' ';
  let bestCount = 0;
  for (const c of candidates) {
    const count = bare.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return bestCount > 0 ? best : ' ';
}

/** Tách một dòng CSV có ngoặc kép (Excel bọc số/tiêu đề có dấu phẩy). */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => matchField(c) !== null);
}

function plausibleGrid(x: number, y: number): boolean {
  // VN-2000: X (Bắc) ~ 900 000 – 2 400 000; Y (Đông) ~ 200 000 – 800 000 với x0 = 500 000.
  return x > 800_000 && x < 2_600_000 && y > 100_000 && y < 900_000;
}

function finish(points: ParsedPoint[], skipped: number, format: ParseFormat): ParseResult {
  const warnings: string[] = [];
  const withGrid = points.filter((p) => p.x !== null && p.y !== null);
  const withWgs = points.filter((p) => p.lat !== null && p.lon !== null);

  let kind: ParseResult['kind'] = 'unknown';
  if (withGrid.length && withWgs.length === 0) kind = 'grid';
  else if (withWgs.length && withGrid.length === 0) kind = 'wgs';
  else if (withGrid.length && withWgs.length) kind = 'grid';

  if (kind === 'grid') {
    const bad = withGrid.filter((p) => !plausibleGrid(p.x as number, p.y as number)).length;
    if (bad) {
      warnings.push(
        `${bad} điểm có X/Y nằm ngoài khoảng thường gặp của VN-2000 – kiểm tra lại kinh tuyến trục và thứ tự cột X/Y.`,
      );
    }
  }
  if (skipped) warnings.push(`${skipped} dòng bị bỏ qua vì thiếu hoặc sai định dạng tọa độ.`);
  if (!points.length) warnings.push('Không đọc được điểm nào từ tệp này.');
  return { points, skipped, kind, format, warnings, columns: [] };
}

function parseDelimited(text: string): ParseResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return finish([], 0, 'txt');

  const delimiter = detectDelimiter(lines[0]);
  const split = (line: string) => splitLine(line, delimiter);

  let headers: string[] = [];
  let startIndex = 0;
  const firstCells = split(lines[0]);
  let columnMap: Partial<Record<keyof ParsedPoint, number>>;

  if (looksLikeHeader(firstCells)) {
    headers = firstCells;
    columnMap = mapHeader(firstCells);
    startIndex = 1;
  } else {
    // Không có tiêu đề: tự tìm cột tên và cặp cột số, chịu được cột “STT” đứng trước hoặc X/Y đảo thứ tự.
    const numericCols = firstCells.map((c, i) => (toNum(c) !== null ? i : -1)).filter((i) => i >= 0);
    const nameIdx = firstCells.findIndex((c) => toNum(c) === null);
    const name = nameIdx >= 0 ? nameIdx : 0;
    // Cột số đứng trước cột tên thường là “STT” — bỏ qua nếu vẫn đủ cặp tọa độ phía sau.
    let coordCols = numericCols.filter((i) => i !== name);
    if (nameIdx >= 0) {
      const afterName = coordCols.filter((i) => i > nameIdx);
      if (afterName.length >= 2) coordCols = afterName;
    }
    const first = coordCols[0];
    const second = coordCols[1];
    const v1 = first !== undefined ? toNum(firstCells[first]) : null;
    const v2 = second !== undefined ? toNum(firstCells[second]) : null;

    if (v1 !== null && v2 !== null && Math.abs(v1) <= 90 && Math.abs(v2) <= 180) {
      columnMap = { name, lat: first, lon: second };
    } else {
      columnMap = { name, x: first, y: second };
    }
    // X/Y đảo cột (Y đứng trước X) thì đổi lại khi khoảng giá trị cho thấy điều đó.
    if (columnMap.x !== undefined && columnMap.y !== undefined && v1 !== null && v2 !== null) {
      if (v1 > 100_000 && v1 < 900_000 && v2 > 800_000) {
        columnMap.x = second;
        columnMap.y = first;
      }
    }
    if (coordCols[2] !== undefined) columnMap.h = coordCols[2];
    if (coordCols[3] !== undefined) columnMap.code = coordCols[3];
  }

  const points: ParsedPoint[] = [];
  let skipped = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (cells.length < 2) {
      skipped++;
      continue;
    }
    const pick = (k: keyof ParsedPoint) => {
      const idx = columnMap[k];
      return idx === undefined ? undefined : cells[idx];
    };
    // Dòng ít cột hơn tiêu đề (Excel hay bỏ trống ô cuối).
    const nameCell = (pick('name') ?? '').trim();
    const p: ParsedPoint = {
      name: nameCell || `P${points.length + 1}`,
      code: (pick('code') ?? '').trim(),
      x: toNum(pick('x')),
      y: toNum(pick('y')),
      h: toNum(pick('h')),
      lat: toNum(pick('lat')),
      lon: toNum(pick('lon')),
      accuracy: toNum(pick('accuracy')),
    };
    const hasGrid = p.x !== null && p.y !== null;
    const hasWgs = p.lat !== null && p.lon !== null;
    if (!hasGrid && !hasWgs) {
      skipped++;
      continue;
    }
    if (hasWgs && (Math.abs(p.lat as number) > 90 || Math.abs(p.lon as number) > 180)) {
      p.lat = null;
      p.lon = null;
    }
    points.push(p);
  }

  const result = finish(points, skipped, delimiter === ' ' ? 'txt' : 'csv');
  result.columns = headers;
  return result;
}

function parseGeoJsonText(text: string): ParseResult {
  const data = JSON.parse(text) as {
    type?: string;
    features?: Array<{
      geometry?: { type?: string; coordinates?: number[] };
      properties?: Record<string, unknown>;
    }>;
  };
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Tệp JSON không phải FeatureCollection của GeoJSON.');
  }
  const points: ParsedPoint[] = [];
  let skipped = 0;
  for (const f of data.features) {
    const c = f.geometry?.coordinates;
    if (f.geometry?.type !== 'Point' || !Array.isArray(c) || c.length < 2) {
      skipped++;
      continue;
    }
    const props = f.properties ?? {};
    const find = (keys: string[]): number | null => {
      for (const [k, v] of Object.entries(props)) {
        if (keys.includes(normalizeKey(k))) {
          const n = typeof v === 'number' ? v : toNum(String(v ?? ''));
          if (n !== null) return n;
        }
      }
      return null;
    };
    const name = String(props.ten ?? props.name ?? props.Name ?? `P${points.length + 1}`);
    const code = String(props.ma ?? props.code ?? '');
    points.push({
      name,
      code,
      lon: c[0],
      lat: c[1],
      h: find(['h', 'cao_do', 'z']),
      x: find(['x', 'bac']),
      y: find(['y', 'dong']),
      accuracy: find(['sai_so', 'acc', 'accuracy']),
    });
  }
  return finish(points, skipped, 'geojson');
}

function parseKmlText(text: string): ParseResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const points: ParsedPoint[] = [];
  let skipped = 0;
  for (const pm of placemarks) {
    const coordText = pm.getElementsByTagName('coordinates')[0]?.textContent?.trim();
    if (!coordText) {
      skipped++;
      continue;
    }
    const parts = coordText.split(/[\s,]+/).map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
      skipped++;
      continue;
    }
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || `P${points.length + 1}`;
    const desc = pm.getElementsByTagName('description')[0]?.textContent ?? '';
    points.push({
      name,
      code: '',
      lon: parts[0],
      lat: parts[1],
      h: null,
      x: null,
      y: null,
      accuracy: null,
    });
    void desc;
  }
  return finish(points, skipped, 'kml');
}

function parseBackup(text: string): ParseResult | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const obj = data as {
    app?: string;
    project?: { name?: string; crs?: CRSConfig };
    points?: Array<Record<string, unknown>>;
  };
  if (obj?.app !== 'topsec-survey-workspace' || !Array.isArray(obj.points)) return null;

  const points: ParsedPoint[] = obj.points.map((raw, i) => ({
    name: String(raw.name ?? `P${i + 1}`),
    code: String(raw.code ?? ''),
    x: typeof raw.x === 'number' ? raw.x : null,
    y: typeof raw.y === 'number' ? raw.y : null,
    h: typeof raw.h === 'number' ? raw.h : null,
    lat: typeof raw.lat === 'number' ? raw.lat : null,
    lon: typeof raw.lon === 'number' ? raw.lon : null,
    accuracy: typeof raw.accuracy === 'number' ? raw.accuracy : null,
  }));
  const result = finish(points, 0, 'backup');
  result.backupCrs = obj.project?.crs;
  result.backupProjectName = obj.project?.name;
  result.warnings.unshift('Đây là bản sao lưu TOPSEC – dữ liệu được giữ nguyên X/Y và hệ tọa độ gốc.');
  return result;
}

export function parseImport(text: string, filename = ''): ParseResult {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('Nội dung tệp rỗng.');

  const lower = filename.toLowerCase();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  const looksXml = trimmed.startsWith('<?xml') || trimmed.startsWith('<kml') || trimmed.includes('<Placemark');

  if (looksJson) {
    const backup = parseBackup(trimmed);
    if (backup) return backup;
    return parseGeoJsonText(trimmed);
  }
  if (looksXml || lower.endsWith('.kml')) return parseKmlText(trimmed);
  return parseDelimited(trimmed);
}
