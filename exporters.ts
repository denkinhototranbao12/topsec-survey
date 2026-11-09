import type { Project, SurveyPoint } from './types';
import { crsSummary } from './crs';
import { fmt } from './format';

export type ExportFormat = 'csv' | 'txt' | 'dxf' | 'kml' | 'geojson' | 'backup';

export interface ExportOptions {
  decimals: number;
  includeHeader: boolean;
}

const SOURCE_LABEL: Record<SurveyPoint['source'], string> = {
  gps: 'GPS điện thoại',
  manual: 'Nhập tay',
  import: 'Nhập tệp',
  measure: 'Đo trên bản đồ',
  cogo: 'Tính toán COGO',
};

export function sourceLabel(s: SurveyPoint['source']): string {
  return SOURCE_LABEL[s] ?? s;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV có BOM để Excel đọc đúng tiếng Việt. */
export function toCsv(points: SurveyPoint[], project: Project, opts: ExportOptions): string {
  const d = opts.decimals;
  const head = [
    'Ten',
    'Ma',
    'X',
    'Y',
    'H',
    'h_elip',
    'B',
    'L',
    'SaiSo_m',
    'Nguon',
    'So_do',
    'Thoi_gian',
    'Ghi_chu',
  ];
  const rows = points.map((p) =>
    [
      csvCell(p.name),
      csvCell(p.code),
      fmt(p.x, d),
      fmt(p.y, d),
      p.h === null ? '' : fmt(p.h, d),
      p.hEll === null ? '' : fmt(p.hEll, d),
      p.lat.toFixed(8),
      p.lon.toFixed(8),
      p.accuracy === null ? '' : fmt(p.accuracy, 1),
      csvCell(sourceLabel(p.source)),
      csvCell(p.book),
      new Date(p.createdAt).toISOString(),
      csvCell(p.note),
    ].join(','),
  );
  // Dòng chú thích hệ tọa độ: giúp người nhận biết X/Y thuộc KTT nào.
  const meta = `# He toa do: ${crsSummary(project.crs)} | Cong trinh: ${project.name}`;
  return '\uFEFF' + [meta, ...(opts.includeHeader ? [head.join(',')] : []), ...rows].join('\r\n') + '\r\n';
}

/** TXT: Tên X Y H Mã – đúng định dạng mà phần lớn máy toàn đạc / phần mềm nhận. */
export function toTxt(points: SurveyPoint[], opts: ExportOptions): string {
  const d = opts.decimals;
  return points
    .map((p) => {
      const parts = [p.name, fmt(p.x, d), fmt(p.y, d), p.h === null ? '0.000' : fmt(p.h, d)];
      if (p.code) parts.push(p.code);
      return parts.join(' ');
    })
    .join('\r\n');
}

/** DXF R2000 tối thiểu nhưng hợp lệ: có HEADER ($INSUNITS = 6 → mét) và bảng LAYER. */
export function toDxf(points: SurveyPoint[], project: Project, opts: ExportOptions): string {
  const d = opts.decimals;
  const xs = points.map((p) => p.y);
  const ys = points.map((p) => p.x);
  const ext = points.length
    ? [
        Math.min(...xs).toFixed(3),
        Math.min(...ys).toFixed(3),
        Math.max(...xs).toFixed(3),
        Math.max(...ys).toFixed(3),
      ]
    : ['0', '0', '0', '0'];

  const out: string[] = [];
  const g = (code: number | string, value: string | number) => {
    out.push(String(code), String(value));
  };

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1015');
  g(9, '$INSUNITS');
  g(70, 6);
  g(9, '$EXTMIN');
  g(10, ext[0]);
  g(20, ext[1]);
  g(30, 0);
  g(9, '$EXTMAX');
  g(10, ext[2]);
  g(20, ext[3]);
  g(30, 0);
  g(9, '$PROJECTNAME');
  g(1, project.name.replace(/[^\p{L}\p{N} _.-]/gu, ' ').slice(0, 200));
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, 2);
  for (const [name, color] of [
    ['DIEM', 1],
    ['TEN', 7],
  ] as Array<[string, number]>) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const p of points) {
    g(0, 'POINT');
    g(8, 'DIEM');
    g(10, fmt(p.y, d));
    g(20, fmt(p.x, d));
    g(30, p.h === null ? '0' : fmt(p.h, d));
  }
  for (const p of points) {
    g(0, 'TEXT');
    g(8, 'TEN');
    g(10, fmt(p.y, d));
    g(20, fmt(p.x, d));
    g(30, p.h === null ? '0' : fmt(p.h, d));
    g(40, 1);
    g(1, p.name.replace(/[\r\n]/g, ' '));
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toKml(points: SurveyPoint[], project: Project): string {
  const placemarks = points
    .map((p) => {
      const desc = [
        p.code ? `Mã: ${p.code}` : '',
        `X = ${fmt(p.x)}  Y = ${fmt(p.y)}`,
        p.h === null ? '' : `H = ${fmt(p.h)}`,
        p.accuracy === null ? '' : `Sai số ±${fmt(p.accuracy, 1)} m`,
        p.book ? `Sổ đo: ${p.book}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const alt = p.hEll ?? p.h;
      return (
        '    <Placemark>' +
        `<name>${xmlEscape(p.name)}</name>` +
        `<description>${xmlEscape(desc)}</description>` +
        `<Point><coordinates>${p.lon.toFixed(8)},${p.lat.toFixed(8)},${alt === null ? 0 : alt.toFixed(3)}</coordinates></Point>` +
        '</Placemark>'
      );
    })
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    `<name>${xmlEscape(project.name)}</name>` +
    `<description>${xmlEscape(crsSummary(project.crs))}</description>\n` +
    placemarks +
    '\n  </Document></kml>\n'
  );
}

export function toGeoJson(points: SurveyPoint[], project: Project): string {
  const fc = {
    type: 'FeatureCollection',
    name: project.name,
    crs: {
      type: 'name',
      properties: { name: `VN-2000 / TM-${project.crs.mode} ${project.crs.lon0}` },
    },
    features: points.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: {
        type: 'Point',
        coordinates: p.hEll === null ? [p.lon, p.lat] : [p.lon, p.lat, p.hEll],
      },
      properties: {
        ten: p.name,
        ma: p.code,
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
        h: p.h,
        he_elip: p.hEll,
        sai_so: p.accuracy,
        so_do: p.book,
        nguon: p.source,
        thoi_gian: new Date(p.createdAt).toISOString(),
        ghi_chu: p.note,
      },
    })),
  };
  return JSON.stringify(fc, null, 2);
}

export interface BackupFile {
  app: 'topsec-survey-workspace';
  version: 1;
  exportedAt: string;
  project: Project;
  points: SurveyPoint[];
}

export function toBackup(points: SurveyPoint[], project: Project): string {
  const payload: BackupFile = {
    app: 'topsec-survey-workspace',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    points,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildExport(
  format: ExportFormat,
  points: SurveyPoint[],
  project: Project,
  opts: ExportOptions,
): { text: string; mime: string; ext: string } {
  switch (format) {
    case 'csv':
      return { text: toCsv(points, project, opts), mime: 'text/csv;charset=utf-8', ext: 'csv' };
    case 'txt':
      return { text: toTxt(points, opts), mime: 'text/plain;charset=utf-8', ext: 'txt' };
    case 'dxf':
      return { text: toDxf(points, project, opts), mime: 'application/dxf', ext: 'dxf' };
    case 'kml':
      return { text: toKml(points, project), mime: 'application/vnd.google-earth.kml+xml', ext: 'kml' };
    case 'geojson':
      return { text: toGeoJson(points, project), mime: 'application/geo+json', ext: 'geojson' };
    case 'backup':
    default:
      return { text: toBackup(points, project), mime: 'application/json', ext: 'json' };
  }
}
