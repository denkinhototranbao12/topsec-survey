import { useMemo, useState } from 'react';
import Modal from './Modal';
import type { Project, SurveyPoint } from '../lib/types';
import { crsShort, toGrid, toWgs } from '../lib/crs';
import { fmt, num, uid } from '../lib/format';
import { forward, intersectBearings, intersectDistances, inverse, polygonMetrics } from '../lib/geo';

interface ToolsDialogProps {
  project: Project;
  selectedPoints: SurveyPoint[];
  onClose: () => void;
  onAddPoint: (p: SurveyPoint) => void;
  onToast: (message: string) => void;
}

type Tab = 'inv' | 'fwd' | 'bear' | 'dist' | 'area' | 'conv';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'inv', label: 'Nghịch' },
  { id: 'fwd', label: 'Thuận' },
  { id: 'bear', label: 'Giao hội góc' },
  { id: 'dist', label: 'Giao hội cạnh' },
  { id: 'area', label: 'Diện tích' },
  { id: 'conv', label: 'Chuyển đổi' },
];

function makePoint(project: Project, x: number, y: number, name: string, code: string): SurveyPoint {
  const w = toWgs(x, y, project.crs);
  return {
    id: uid('cg'),
    projectId: project.id,
    name,
    code,
    book: 'Công cụ COGO',
    note: '',
    lat: w.lat,
    lon: w.lon,
    x,
    y,
    h: null,
    hEll: null,
    accuracy: null,
    source: 'cogo',
    createdAt: Date.now(),
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InversePanel() {
  const [v, setV] = useState({ x1: '', y1: '', x2: '', y2: '' });
  const [out, setOut] = useState<ReturnType<typeof inverse> | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <>
      <div className="grid2">
        <div className="field">
          <label>X1</label>
          <input value={v.x1} onChange={set('x1')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y1</label>
          <input value={v.y1} onChange={set('y1')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>X2</label>
          <input value={v.x2} onChange={set('x2')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y2</label>
          <input value={v.y2} onChange={set('y2')} inputMode="decimal" />
        </div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => {
          const [x1, y1, x2, y2] = [num(v.x1), num(v.y1), num(v.x2), num(v.y2)];
          if (![x1, y1, x2, y2].every(Number.isFinite)) return;
          setOut(inverse(x1, y1, x2, y2));
        }}
      >
        Tính
      </button>
      {out ? (
        <div className="result">
          <Row label="Khoảng cách" value={`${fmt(out.distance, 3)} m`} />
          <Row label="Phương vị" value={`${out.azimuth.toFixed(4)}°`} />
          <Row label="ΔX" value={`${fmt(out.dx, 3)} m`} />
          <Row label="ΔY" value={`${fmt(out.dy, 3)} m`} />
        </div>
      ) : null}
    </>
  );
}

function ForwardPanel({ project, onAddPoint, onToast }: { project: Project; onAddPoint: ToolsDialogProps['onAddPoint']; onToast: ToolsDialogProps['onToast'] }) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [az, setAz] = useState('');
  const [d, setD] = useState('');
  const [name, setName] = useState('P');
  const result = useMemo(() => {
    const [xv, yv, av, dv] = [num(x), num(y), num(az), num(d)];
    if (![xv, yv, av, dv].every(Number.isFinite)) return null;
    return forward(xv, yv, av, dv);
  }, [x, y, az, d]);

  return (
    <>
      <div className="grid2">
        <div className="field">
          <label>X gốc</label>
          <input value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y gốc</label>
          <input value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Phương vị (°)</label>
          <input value={az} onChange={(e) => setAz(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Khoảng cách (m)</label>
          <input value={d} onChange={(e) => setD(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      {result ? (
        <div className="result">
          <Row label="X" value={fmt(result.x, 3)} />
          <Row label="Y" value={fmt(result.y, 3)} />
        </div>
      ) : (
        <p className="note">Nhập đủ 4 giá trị để tính điểm mới.</p>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Tên điểm lưu</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button
          className="btn btn-sm"
          disabled={!result}
          onClick={() => {
            if (!result) return;
            onAddPoint(makePoint(project, result.x, result.y, name.trim() || 'P', 'COGO thuận'));
            onToast('Đã lưu điểm vào sổ đo.');
          }}
        >
          Lưu thành điểm
        </button>
      </div>
    </>
  );
}

function BearingsPanel({ project, onAddPoint, onToast }: { project: Project; onAddPoint: ToolsDialogProps['onAddPoint']; onToast: ToolsDialogProps['onToast'] }) {
  const [v, setV] = useState({ xa: '', ya: '', aa: '', xb: '', yb: '', ab: '' });
  const [out, setOut] = useState<{ x: number; y: number; d: number } | null>(null);
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <>
      <div className="grid3">
        <div className="field">
          <label>X điểm A</label>
          <input value={v.xa} onChange={set('xa')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y điểm A</label>
          <input value={v.ya} onChange={set('ya')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Phương vị từ A (°)</label>
          <input value={v.aa} onChange={set('aa')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>X điểm B</label>
          <input value={v.xb} onChange={set('xb')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y điểm B</label>
          <input value={v.yb} onChange={set('yb')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Phương vị từ B (°)</label>
          <input value={v.ab} onChange={set('ab')} inputMode="decimal" />
        </div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => {
          const [xa, ya, aa, xb, yb, ab] = [num(v.xa), num(v.ya), num(v.aa), num(v.xb), num(v.yb), num(v.ab)];
          if (![xa, ya, aa, xb, yb, ab].every(Number.isFinite)) {
            setError('Nhập đủ 6 giá trị.');
            setOut(null);
            return;
          }
          const res = intersectBearings({ x: xa, y: ya }, aa, { x: xb, y: yb }, ab);
          if (!res.ok) {
            setError(res.error);
            setOut(null);
            return;
          }
          setError('');
          setOut({ x: res.point.x, y: res.point.y, d: res.distFromA });
        }}
      >
        Tính giao điểm
      </button>
      {error ? <p className="note warn">{error}</p> : null}
      {out ? (
        <>
          <div className="result">
            <Row label="X" value={fmt(out.x, 3)} />
            <Row label="Y" value={fmt(out.y, 3)} />
            <Row label="Cách A" value={`${fmt(out.d, 3)} m`} />
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              onAddPoint(makePoint(project, out.x, out.y, 'G', 'Giao hội góc'));
              onToast('Đã lưu điểm giao hội.');
            }}
          >
            Lưu thành điểm
          </button>
        </>
      ) : null}
    </>
  );
}

function DistancesPanel({ project, onAddPoint, onToast }: { project: Project; onAddPoint: ToolsDialogProps['onAddPoint']; onToast: ToolsDialogProps['onToast'] }) {
  const [v, setV] = useState({ xa: '', ya: '', da: '', xb: '', yb: '', db: '' });
  const [out, setOut] = useState<{ x: number; y: number }[] | null>(null);
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <>
      <div className="grid3">
        <div className="field">
          <label>X điểm A</label>
          <input value={v.xa} onChange={set('xa')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y điểm A</label>
          <input value={v.ya} onChange={set('ya')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Khoảng cách từ A (m)</label>
          <input value={v.da} onChange={set('da')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>X điểm B</label>
          <input value={v.xb} onChange={set('xb')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y điểm B</label>
          <input value={v.yb} onChange={set('yb')} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Khoảng cách từ B (m)</label>
          <input value={v.db} onChange={set('db')} inputMode="decimal" />
        </div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => {
          const [xa, ya, da, xb, yb, db] = [num(v.xa), num(v.ya), num(v.da), num(v.xb), num(v.yb), num(v.db)];
          if (![xa, ya, da, xb, yb, db].every(Number.isFinite)) {
            setError('Nhập đủ 6 giá trị.');
            setOut(null);
            return;
          }
          const res = intersectDistances({ x: xa, y: ya }, da, { x: xb, y: yb }, db);
          if (!res.ok) {
            setError(res.error);
            setOut(null);
            return;
          }
          setError('');
          setOut(res.points);
        }}
      >
        Tính giao điểm
      </button>
      {error ? <p className="note warn">{error}</p> : null}
      {out ? (
        <>
          <div className="result">
            {out.map((p, i) => (
              <Row key={i} label={`Điểm ${i + 1}`} value={`X ${fmt(p.x, 3)} · Y ${fmt(p.y, 3)}`} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {out.map((p, i) => (
              <button
                key={i}
                className="btn btn-sm"
                onClick={() => {
                  onAddPoint(makePoint(project, p.x, p.y, `G${i + 1}`, 'Giao hội cạnh'));
                  onToast(`Đã lưu điểm ${i + 1}.`);
                }}
              >
                Lưu điểm {i + 1}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function AreaPanel({ selectedPoints }: { selectedPoints: SurveyPoint[] }) {
  const [text, setText] = useState('');
  const [out, setOut] = useState<{ area: number; perimeter: number; count: number } | null>(null);
  const [error, setError] = useState('');

  const fill = () => setText(selectedPoints.map((p) => `${fmt(p.x, 3)} ${fmt(p.y, 3)}`).join('\n'));

  return (
    <>
      <div className="field">
        <label>Mỗi dòng một đỉnh: X Y</label>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={fill} disabled={!selectedPoints.length}>
          Lấy từ điểm đang chọn ({selectedPoints.length})
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            const xy = text
              .split(/\r?\n/)
              .map((line) => line.trim().split(/[\s,;]+/).map(Number))
              .filter((arr) => arr.length >= 2 && Number.isFinite(arr[0]) && Number.isFinite(arr[1]))
              .map((arr) => ({ x: arr[0], y: arr[1] }));
            if (xy.length < 3) {
              setError('Cần ít nhất 3 đỉnh hợp lệ.');
              setOut(null);
              return;
            }
            setError('');
            const m = polygonMetrics(xy);
            setOut({ area: m.area, perimeter: m.perimeter, count: xy.length });
          }}
        >
          Tính
        </button>
      </div>
      {error ? <p className="note warn">{error}</p> : null}
      {out ? (
        <div className="result">
          <Row label="Số đỉnh" value={String(out.count)} />
          <Row label="Diện tích" value={`${fmt(out.area, 2)} m²`} />
          <Row label="Quy đổi" value={`${fmt(out.area / 10_000, 4)} ha`} />
          <Row label="Chu vi" value={`${fmt(out.perimeter, 3)} m`} />
        </div>
      ) : null}
    </>
  );
}

function ConvertPanel({ project }: { project: Project }) {
  const [b, setB] = useState('');
  const [l, setL] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');

  const grid = useMemo(() => {
    const bv = num(b);
    const lv = num(l);
    if (!Number.isFinite(bv) || !Number.isFinite(lv)) return null;
    return toGrid(bv, lv, project.crs);
  }, [b, l, project.crs]);

  const wgs = useMemo(() => {
    const xv = num(x);
    const yv = num(y);
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) return null;
    return toWgs(xv, yv, project.crs);
  }, [x, y, project.crs]);

  return (
    <>
      <div className="grid2">
        <div className="field">
          <label>B (vĩ độ, độ thập phân)</label>
          <input value={b} onChange={(e) => setB(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>L (kinh độ, độ thập phân)</label>
          <input value={l} onChange={(e) => setL(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="result">
        {grid ? (
          <>
            <Row label="X" value={fmt(grid.x, 3)} />
            <Row label="Y" value={fmt(grid.y, 3)} />
          </>
        ) : (
          'Nhập B, L để đổi sang VN-2000.'
        )}
      </div>

      <div className="grid2">
        <div className="field">
          <label>X (Bắc)</label>
          <input value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Y (Đông)</label>
          <input value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="result">
        {wgs ? (
          <>
            <Row label="B" value={wgs.lat.toFixed(8)} />
            <Row label="L" value={wgs.lon.toFixed(8)} />
          </>
        ) : (
          'Nhập X, Y để đổi sang WGS-84.'
        )}
      </div>
      <p className="note">
        Đang dùng {crsShort(project.crs)}. Bộ 7 tham số quốc gia cho sai số dưới mét — không thay thế hiệu chuẩn trạm base
        RTK.
      </p>
    </>
  );
}

export default function ToolsDialog({ project, selectedPoints, onClose, onAddPoint, onToast }: ToolsDialogProps) {
  const [tab, setTab] = useState<Tab>('inv');

  return (
    <Modal title="Công cụ trắc địa" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inv' ? <InversePanel /> : null}
      {tab === 'fwd' ? <ForwardPanel project={project} onAddPoint={onAddPoint} onToast={onToast} /> : null}
      {tab === 'bear' ? <BearingsPanel project={project} onAddPoint={onAddPoint} onToast={onToast} /> : null}
      {tab === 'dist' ? <DistancesPanel project={project} onAddPoint={onAddPoint} onToast={onToast} /> : null}
      {tab === 'area' ? <AreaPanel selectedPoints={selectedPoints} /> : null}
      {tab === 'conv' ? <ConvertPanel project={project} /> : null}

      <p className="note">Phương vị tính từ Bắc, theo chiều kim đồng hồ. X = Bắc, Y = Đông, phù hợp VN-2000.</p>
    </Modal>
  );
}
