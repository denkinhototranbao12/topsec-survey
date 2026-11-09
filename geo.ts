/** Các bài toán trắc địa / COGO cơ bản, làm việc trên mặt phẳng lưới chiếu. */

export interface InverseResult {
  dx: number;
  dy: number;
  distance: number;
  /** Phương vị (độ, từ Bắc theo chiều kim đồng hồ). */
  azimuth: number;
}

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export function normAzimuth(az: number): number {
  return ((az % 360) + 360) % 360;
}

/** Bài toán nghịch: từ 2 điểm → khoảng cách, phương vị. */
export function inverse(x1: number, y1: number, x2: number, y2: number): InverseResult {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy),
    azimuth: normAzimuth(Math.atan2(dy, dx) * DEG),
  };
}

/** Bài toán thuận: từ điểm + phương vị + khoảng cách → điểm mới. */
export function forward(x: number, y: number, azimuth: number, distance: number) {
  const a = azimuth * RAD;
  return { x: x + distance * Math.cos(a), y: y + distance * Math.sin(a) };
}

export interface Point2 {
  x: number;
  y: number;
}

/** Giao hội góc: hai tia từ A (phương vị azA) và B (phương vị azB). */
export function intersectBearings(
  a: Point2,
  azA: number,
  b: Point2,
  azB: number,
): { ok: true; point: Point2; distFromA: number } | { ok: false; error: string } {
  const p = azA * RAD;
  const q = azB * RAD;
  const ux = Math.cos(p);
  const uy = Math.sin(p);
  const wx = Math.cos(q);
  const wy = Math.sin(q);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const det = -ux * wy + wx * uy;
  if (Math.abs(det) < 1e-12) {
    return { ok: false, error: 'Hai phương vị song song hoặc trùng nhau – không có giao điểm.' };
  }
  const t = (dx * -wy + wx * dy) / det;
  return {
    ok: true,
    point: { x: a.x + t * ux, y: a.y + t * uy },
    distFromA: Math.abs(t),
  };
}

/** Giao hội cạnh: giao hai đường tròn tâm A, B. */
export function intersectDistances(
  a: Point2,
  dA: number,
  b: Point2,
  dB: number,
): { ok: true; points: Point2[] } | { ok: false; error: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ok: false, error: 'Hai điểm tâm trùng nhau.' };
  if (d > dA + dB || d < Math.abs(dA - dB)) {
    return { ok: false, error: 'Hai đường tròn không cắt nhau – kiểm tra lại khoảng cách.' };
  }
  const along = (dA * dA - dB * dB + d * d) / (2 * d);
  const h2 = dA * dA - along * along;
  const h = Math.sqrt(Math.max(0, h2));
  const ex = dx / d;
  const ey = dy / d;
  const base = { x: a.x + along * ex, y: a.y + along * ey };
  return {
    ok: true,
    points: [
      { x: base.x - h * ey, y: base.y + h * ex },
      { x: base.x + h * ey, y: base.y - h * ex },
    ],
  };
}

/** Diện tích (m²) và chu vi (m) của đa giác trên mặt phẳng X/Y. */
export function polygonMetrics(vertices: Point2[]): { area: number; perimeter: number } {
  if (vertices.length < 2) return { area: 0, perimeter: 0 };
  let twice = 0;
  let perimeter = 0;
  vertices.forEach((p, i) => {
    const q = vertices[(i + 1) % vertices.length];
    twice += p.y * q.x - q.y * p.x;
    perimeter += Math.hypot(q.x - p.x, q.y - p.y);
  });
  const closed = vertices.length > 2;
  return {
    area: closed ? Math.abs(twice) / 2 : 0,
    perimeter: closed ? perimeter : perimeter,
  };
}

/** Khoảng cách mặt đất (haversine) – dùng để đối chiếu nhanh. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
