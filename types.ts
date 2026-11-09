/** Kiểu dữ liệu dùng chung cho toàn app. */

export type ZoneMode = 3 | 6;

/** Cấu hình hệ tọa độ gắn với từng công trình (không bao giờ là biến toàn cục). */
export interface CRSConfig {
  mode: ZoneMode;
  /** Kinh tuyến trục (độ). */
  lon0: number;
  /** Hệ số tỷ lệ: 0.9999 cho múi 3°, 0.9996 cho múi 6°. */
  k: number;
  /** Nhãn khu vực, ví dụ "Phú Yên – Đắk Lắk (108.5°)". */
  areaLabel: string;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  note: string;
  crs: CRSConfig;
  createdAt: number;
  updatedAt: number;
}

export type PointSource = 'gps' | 'manual' | 'import' | 'measure' | 'cogo';

export interface SurveyPoint {
  id: string;
  projectId: string;
  name: string;
  code: string;
  /** Sổ đo / đợt đo. */
  book: string;
  note: string;
  /** WGS-84, độ thập phân. */
  lat: number;
  lon: number;
  /** VN-2000 theo CRS của công trình: X = Bắc (northing), Y = Đông (easting). */
  x: number;
  y: number;
  /** Cao độ thủy chuẩn (Hon Dau) nếu có nhập tay. */
  h: number | null;
  /** Cao độ elipsoid (WGS-84) lấy từ GPS. */
  hEll: number | null;
  /** Sai số ngang ± (m) nếu có. */
  accuracy: number | null;
  source: PointSource;
  createdAt: number;
}

export type Basemap = 'sat' | 'osm' | 'none';

export interface StorageState {
  status: 'idle' | 'saving' | 'ok' | 'error';
  message?: string;
}
