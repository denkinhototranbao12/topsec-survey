/**
 * Đọc dữ liệu trình chiếu 3D tại chỗ (không tải lên máy chủ).
 *
 * Point cloud Potree để ở dạng 3 tệp (metadata, hierarchy, octree) và tệp dữ liệu
 * có thể rất lớn (hàng chục GB) nên app đọc từng khối bằng `File.slice` theo header
 * `Range` — không nạp cả tệp vào bộ nhớ và không copy vào thư mục dự án.
 */

export interface PotreeFileSet {
  metadata: File;
  hierarchy: File;
  octree: File;
}

export type PotreeFileCheck = { ok: true; set: PotreeFileSet } | { ok: false; missing: string[] };

const METADATA_NAMES = ['metadata.oct', 'metadata.json'];

/** Tìm 3 tệp cần thiết trong danh sách người dùng chọn (không phân biệt hoa thường). */
export function pickPotreeFiles(files: File[]): PotreeFileCheck {
  const byName = new Map<string, File>();
  for (const f of files) byName.set(f.name.toLowerCase(), f);

  const metadata = METADATA_NAMES.map((n) => byName.get(n)).find(Boolean);
  const hierarchy = byName.get('hierarchy.bin');
  const octree = byName.get('octree.bin');

  const missing: string[] = [];
  if (!metadata) missing.push('metadata.oct (hoặc metadata.json)');
  if (!hierarchy) missing.push('hierarchy.bin');
  if (!octree) missing.push('octree.bin');
  if (!metadata || !hierarchy || !octree) return { ok: false, missing };
  return { ok: true, set: { metadata, hierarchy, octree } };
}

export interface PotreeMetadata {
  version: string;
  name: string;
  points: number;
  attributes: string[];
  spacing: number | null;
  /** Gốc dời của point cloud (mét). */
  offset: [number, number, number] | null;
}

/** Đọc phần đầu metadata của Potree 2.x (tệp JSON dù đuôi là .oct). */
export function parsePotreeMetadata(text: string): PotreeMetadata {
  let data: {
    version?: string;
    name?: string;
    points?: number;
    spacing?: number;
    offset?: number[];
    attributes?: Array<{ name?: string }>;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error('Tệp metadata không phải JSON – có thể đây không phải point cloud Potree.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.attributes)) {
    throw new Error('Thiếu danh sách thuộc tính điểm trong metadata.');
  }
  const attributes = data.attributes.map((a) => String(a?.name ?? '')).filter(Boolean);
  if (!attributes.includes('position')) {
    throw new Error('Metadata không có thuộc tính “position” – không dựng được point cloud.');
  }
  return {
    version: String(data.version ?? '?'),
    name: String(data.name ?? 'Point cloud'),
    points: Number(data.points ?? 0),
    attributes,
    spacing: typeof data.spacing === 'number' ? data.spacing : null,
    offset:
      Array.isArray(data.offset) && data.offset.length === 3 && data.offset.every((v) => Number.isFinite(v))
        ? [data.offset[0], data.offset[1], data.offset[2]]
        : null,
  };
}

/** Tiền tố URL giả: potree-core cần URL kết thúc bằng “/metadata.json”. */
export const POTREE_BASE_URL = 'local://potree';

/**
 * potree-core 2.x giải mã điểm thành toạ độ đã cộng `offset` của metadata, nhưng hộp bao
 * dùng để tính hiển thị (frustum/LOD) lại là toạ độ cục bộ. Với dữ liệu có `offset` khác 0
 * (XGrids, Potree 2.1 xuất từ LAS có toạ độ lớn) hai hệ lệch nhau hàng chục km nên không
 * có khối điểm nào được vẽ.
 *
 * Cách xử lý: đưa `offset` về 0 khi đưa metadata cho thư viện. Point cloud hiển thị quanh
 * gốc toạ độ; giá trị offset gốc vẫn được giữ lại trong `PotreeMetadata.offset` để hiển thị.
 */
export function zeroPotreeOffset(text: string): string {
  try {
    const data = JSON.parse(text) as { offset?: unknown };
    if (!data || typeof data !== 'object') return text;
    const o = data.offset;
    if (!Array.isArray(o) || (o[0] === 0 && o[1] === 0 && o[2] === 0)) return text;
    data.offset = [0, 0, 0];
    return JSON.stringify(data);
  } catch {
    return text;
  }
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === name);
    return hit ? hit[1] : null;
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  return key ? record[key] : null;
}

function parseRange(value: string | null): { start: number; end: number } | null {
  if (!value) return null;
  const m = /bytes=(\d+)-(\d+)/.exec(value);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

async function metadataResponse(file: File): Promise<Response> {
  const text = await file.text();
  const rewritten = zeroPotreeOffset(text);
  if (rewritten === text) {
    return new Response(file, {
      status: 200,
      headers: { 'content-length': String(file.size), 'content-type': 'application/octet-stream' },
    });
  }
  return new Response(rewritten, { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * Cầu nối giữa potree-core và các tệp trên đĩa. Chỉ đọc đúng khoảng byte được yêu cầu,
 * nên mở được point cloud 15 GB mà không tốn RAM.
 */
export class LocalPotreeRequestManager {
  private files = new Map<string, File>();

  constructor(files: File[]) {
    for (const f of files) {
      const key = f.name.toLowerCase();
      this.files.set(key, f);
      // potree-core luôn hỏi “metadata.json”, còn XGrids/Potree 2.1 đặt tên “metadata.oct”.
      if (METADATA_NAMES.includes(key)) {
        for (const alias of METADATA_NAMES) this.files.set(alias, f);
      }
    }
  }

  /**
   * potree-core thay hậu tố "/metadata.json" bằng "/octree.bin" và "/hierarchy.bin",
   * nên URL phải có tiền tố và có dấu “/” trước tên tệp.
   */
  async getUrl(url: string): Promise<string> {
    if (/^[a-z]+:\/\//i.test(url)) return url;
    return `${POTREE_BASE_URL}/${url.replace(/^\/+/, '')}`;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = (url.split('/').pop() ?? '').toLowerCase();
    const file = this.files.get(name);
    if (!file) throw new Error(`Thiếu tệp “${name}” trong thư mục đã chọn.`);

    if (METADATA_NAMES.includes(name)) return metadataResponse(file);

    const range = parseRange(headerValue(init?.headers, 'range'));
    if (!range) {
      return new Response(file, {
        status: 200,
        headers: { 'content-length': String(file.size), 'content-type': 'application/octet-stream' },
      });
    }

    const start = Math.max(0, Math.min(range.start, file.size));
    const end = Math.max(start - 1, Math.min(range.end, file.size - 1));
    const blob = file.slice(start, end + 1);
    return new Response(blob, {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${file.size}`,
        'content-length': String(blob.size),
        'content-type': 'application/octet-stream',
      },
    });
  }
}

/** Cầu nối cho point cloud đặt trên máy chủ (cần HTTP Range + CORS). */
export class UrlPotreeRequestManager {
  private base: string;

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  async getUrl(url: string): Promise<string> {
    return /^https?:/i.test(url) ? url : this.base + url;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = /^https?:/i.test(raw) ? raw : this.base + raw;
    const res = await fetch(target, init);
    if (!res.ok || !/metadata\.(json|oct)$/i.test(target)) return res;
    const text = await res.text();
    const rewritten = zeroPotreeOffset(text);
    if (rewritten === text) return res;
    return new Response(rewritten, { status: 200, headers: { 'content-type': 'application/json' } });
  }
}

/* ------------------------------ dataIndex.json ------------------------------ */

export const GROUP_LABEL: Record<string, string> = {
  pointCloud: 'Point cloud',
  mesh: 'Mô hình 3D (mesh)',
  cad: 'Bản vẽ CAD',
  gaussianCloud: 'Gaussian splat',
  expandPoint: 'Điểm mở rộng',
  panomicData: 'Ảnh toàn cảnh',
};

/** Nhóm trình chiếu được ngay trong bản này. */
export const SUPPORTED_GROUPS = ['pointCloud'];

export interface DataIndexItem {
  group: string;
  label: string;
  path: string;
  /** Tên tệp/thư mục cuối cùng, dùng để đối chiếu khi chọn thư mục. */
  fileName: string;
  supported: boolean;
}

export interface DataIndex {
  items: DataIndexItem[];
}

/** Tên hiển thị gọn từ đường dẫn tuyệt đối trên máy người dùng. */
export function labelFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  const clean = folder
    .replace(/_potree$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || parts[parts.length - 1] || path;
}

/** Đọc dataIndex.json (danh mục dữ liệu của công cụ trình chiếu). */
export function parseDataIndex(text: string): DataIndex {
  let raw: { data?: Record<string, unknown> };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    throw new Error('Tệp không phải JSON hợp lệ.');
  }
  if (!raw || typeof raw !== 'object' || !raw.data || typeof raw.data !== 'object') {
    throw new Error('Thiếu khối “data” – không giống dataIndex.json.');
  }

  const items: DataIndexItem[] = [];
  for (const [group, value] of Object.entries(raw.data)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      const path = entry.trim();
      items.push({
        group,
        label: labelFromPath(path),
        path,
        fileName: (path.split(/[\\/]/).pop() ?? '').toLowerCase(),
        supported: SUPPORTED_GROUPS.includes(group),
      });
    }
  }
  if (!items.length) throw new Error('Danh mục không có mục dữ liệu nào.');
  return { items };
}
