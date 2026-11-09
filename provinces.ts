/**
 * Kinh tuyến trục theo tỉnh/thành.
 *
 * - Giá trị kinh tuyến trục lấy theo bảng quy định tại Thông tư 25/2014/TT-BTNMT
 *   (Phụ lục 02) – bảng 63 tỉnh/thành trước sắp xếp.
 * - Tên tỉnh/thành cập nhật theo Nghị quyết 202/2025/QH15 (hiệu lực 01/7/2025):
 *   63 → 34 đơn vị hành chính cấp tỉnh. Tỉnh sau sáp nhập có thể nằm trên nhiều
 *   khu vực có kinh tuyến trục khác nhau, nên mỗi tỉnh có thể có nhiều lựa chọn.
 *
 * Luôn đối chiếu lại với hồ sơ kỹ thuật của công trình trước khi dùng cho mục đích
 * pháp lý (cấp giấy, nghiệm thu, bàn giao mốc).
 */

export interface MeridianArea {
  /** Nhãn khu vực, ví dụ "Hà Nam – Ninh Bình". */
  label: string;
  /** Kinh tuyến trục (độ). */
  lon0: number;
}

export interface ProvinceGroup {
  province: string;
  areas: MeridianArea[];
}

/** Bảng gốc 63 tỉnh/thành → kinh tuyến trục. */
const OLD: Array<[string, number]> = [
  ['Lai Châu', 103],
  ['Điện Biên', 103],
  ['Sơn La', 104],
  ['Kiên Giang', 104.5],
  ['Cà Mau', 104.5],
  ['Lào Cai', 104.75],
  ['Yên Bái', 104.75],
  ['Phú Thọ', 104.75],
  ['Nghệ An', 104.75],
  ['An Giang', 104.75],
  ['Vĩnh Phúc', 105],
  ['Hà Nội', 105],
  ['Hà Nam', 105],
  ['Ninh Bình', 105],
  ['Thanh Hóa', 105],
  ['Đồng Tháp', 105],
  ['Cần Thơ', 105],
  ['Hậu Giang', 105],
  ['Bạc Liêu', 105],
  ['Hà Giang', 105.5],
  ['Bắc Ninh', 105.5],
  ['Hải Dương', 105.5],
  ['Hưng Yên', 105.5],
  ['Nam Định', 105.5],
  ['Thái Bình', 105.5],
  ['Hà Tĩnh', 105.5],
  ['Tây Ninh', 105.5],
  ['Vĩnh Long', 105.5],
  ['Trà Vinh', 105.5],
  ['Sóc Trăng', 105.5],
  ['Cao Bằng', 105.75],
  ['Long An', 105.75],
  ['Hải Phòng', 105.75],
  ['Bình Dương', 105.75],
  ['TP. Hồ Chí Minh', 105.75],
  ['Tiền Giang', 105.75],
  ['Bến Tre', 105.75],
  ['Tuyên Quang', 106],
  ['Hòa Bình', 106],
  ['Quảng Bình', 106],
  ['Quảng Trị', 106.25],
  ['Bình Phước', 106.25],
  ['Bắc Kạn', 106.5],
  ['Thái Nguyên', 106.5],
  ['Bắc Giang', 107],
  ['Thừa Thiên Huế', 107],
  ['Lạng Sơn', 107.25],
  ['Kon Tum', 107.5],
  ['Đắk Nông', 107.5],
  ['Quảng Ninh', 107.75],
  ['Đà Nẵng', 107.75],
  ['Quảng Nam', 107.75],
  ['Lâm Đồng', 107.75],
  ['Đồng Nai', 107.75],
  ['Bà Rịa - Vũng Tàu', 107.75],
  ['Quảng Ngãi', 108],
  ['Bình Định', 108.25],
  ['Khánh Hòa', 108.25],
  ['Ninh Thuận', 108.25],
  ['Phú Yên', 108.5],
  ['Gia Lai', 108.5],
  ['Đắk Lắk', 108.5],
  ['Bình Thuận', 108.5],
];

const OLD_MAP = new Map<string, number>(OLD);

/** 34 đơn vị cấp tỉnh sau sắp xếp, kèm các đơn vị cũ cấu thành. */
const MERGED: Array<[string, string[]]> = [
  ['An Giang', ['An Giang', 'Kiên Giang']],
  ['Bắc Ninh', ['Bắc Ninh', 'Bắc Giang']],
  ['Cà Mau', ['Cà Mau', 'Bạc Liêu']],
  ['Cao Bằng', ['Cao Bằng']],
  ['Cần Thơ', ['Cần Thơ', 'Hậu Giang', 'Sóc Trăng']],
  ['Đà Nẵng', ['Đà Nẵng', 'Quảng Nam']],
  ['Đắk Lắk', ['Đắk Lắk', 'Phú Yên']],
  ['Điện Biên', ['Điện Biên']],
  ['Đồng Nai', ['Đồng Nai', 'Bình Phước']],
  ['Đồng Tháp', ['Đồng Tháp', 'Tiền Giang']],
  ['Gia Lai', ['Gia Lai', 'Bình Định']],
  ['Hà Nội', ['Hà Nội']],
  ['Hà Tĩnh', ['Hà Tĩnh']],
  ['Hải Phòng', ['Hải Phòng', 'Hải Dương']],
  ['Huế', ['Thừa Thiên Huế']],
  ['Hưng Yên', ['Hưng Yên', 'Thái Bình']],
  ['Khánh Hòa', ['Khánh Hòa', 'Ninh Thuận']],
  ['Lai Châu', ['Lai Châu']],
  ['Lâm Đồng', ['Lâm Đồng', 'Đắk Nông', 'Bình Thuận']],
  ['Lạng Sơn', ['Lạng Sơn']],
  ['Lào Cai', ['Lào Cai', 'Yên Bái']],
  ['Nghệ An', ['Nghệ An']],
  ['Ninh Bình', ['Ninh Bình', 'Hà Nam', 'Nam Định']],
  ['Phú Thọ', ['Phú Thọ', 'Vĩnh Phúc', 'Hòa Bình']],
  ['Quảng Ninh', ['Quảng Ninh']],
  ['Quảng Ngãi', ['Quảng Ngãi', 'Kon Tum']],
  ['Quảng Trị', ['Quảng Trị', 'Quảng Bình']],
  ['Sơn La', ['Sơn La']],
  ['Tây Ninh', ['Tây Ninh', 'Long An']],
  ['Thái Nguyên', ['Thái Nguyên', 'Bắc Kạn']],
  ['Thanh Hóa', ['Thanh Hóa']],
  ['TP. Hồ Chí Minh', ['TP. Hồ Chí Minh', 'Bình Dương', 'Bà Rịa - Vũng Tàu']],
  ['Tuyên Quang', ['Tuyên Quang', 'Hà Giang']],
  ['Vĩnh Long', ['Vĩnh Long', 'Bến Tre', 'Trà Vinh']],
];

function buildAreas(oldNames: string[]): MeridianArea[] {
  const byLon = new Map<number, string[]>();
  for (const name of oldNames) {
    const lon0 = OLD_MAP.get(name);
    if (lon0 === undefined) continue;
    const list = byLon.get(lon0) ?? [];
    list.push(name);
    byLon.set(lon0, list);
  }
  return [...byLon.entries()]
    .map(([lon0, names]) => ({ label: names.join(' – '), lon0 }))
    .sort((a, b) => a.lon0 - b.lon0);
}

export const PROVINCES: ProvinceGroup[] = MERGED.map(([province, olds]) => ({
  province,
  areas: buildAreas(olds),
})).sort((a, b) => a.province.localeCompare(b.province, 'vi'));

/** Múi 6° dùng cho bản đồ tỷ lệ nhỏ. Việt Nam nằm trong múi 48, 49, 50. */
export const ZONES_6 = [
  { lon0: 102, label: 'Múi 48 (102°)' },
  { lon0: 108, label: 'Múi 49 (108°)' },
  { lon0: 114, label: 'Múi 50 (114°)' },
];

export function formatMeridian(lon0: number): string {
  return `${Number.isInteger(lon0) ? lon0 : lon0.toFixed(2).replace(/0$/, '')}°`;
}
