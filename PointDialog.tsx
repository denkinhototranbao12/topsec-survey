import { useState } from 'react';
import Modal from './Modal';
import type { Project, SurveyPoint } from '../lib/types';
import { toGrid, toWgs, crsShort } from '../lib/crs';
import { fmt, num, uid } from '../lib/format';

interface PointDialogProps {
  project: Project;
  point: SurveyPoint | null;
  suggestedName: string;
  defaultBook: string;
  onClose: () => void;
  onSave: (p: SurveyPoint) => void;
  onDelete?: (id: string) => void;
}

export default function PointDialog({
  project,
  point,
  suggestedName,
  defaultBook,
  onClose,
  onSave,
  onDelete,
}: PointDialogProps) {
  const [name, setName] = useState(point?.name ?? suggestedName);
  const [code, setCode] = useState(point?.code ?? '');
  const [book, setBook] = useState(point?.book ?? defaultBook);
  const [note, setNote] = useState(point?.note ?? '');

  const [x, setX] = useState(point ? fmt(point.x, 3) : '');
  const [y, setY] = useState(point ? fmt(point.y, 3) : '');
  const [lat, setLat] = useState(point ? point.lat.toFixed(8) : '');
  const [lon, setLon] = useState(point ? point.lon.toFixed(8) : '');
  const [h, setH] = useState(point?.h !== null && point?.h !== undefined ? fmt(point.h, 3) : '');
  const [hEll, setHEll] = useState(point?.hEll !== null && point?.hEll !== undefined ? fmt(point.hEll, 3) : '');
  const [acc, setAcc] = useState(point?.accuracy !== null && point?.accuracy !== undefined ? fmt(point.accuracy, 1) : '');

  const [fromGps, setFromGps] = useState(point?.source === 'gps');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onGrid = (nx: string, ny: string) => {
    setX(nx);
    setY(ny);
    const xv = num(nx);
    const yv = num(ny);
    if (Number.isFinite(xv) && Number.isFinite(yv)) {
      const w = toWgs(xv, yv, project.crs);
      setLat(w.lat.toFixed(8));
      setLon(w.lon.toFixed(8));
    }
  };

  const onWgs = (nlat: string, nlon: string) => {
    setLat(nlat);
    setLon(nlon);
    const la = num(nlat);
    const lo = num(nlon);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      const g = toGrid(la, lo, project.crs);
      setX(g.x.toFixed(3));
      setY(g.y.toFixed(3));
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) {
      setError('Thiết bị không hỗ trợ định vị.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude, accuracy } = pos.coords;
        onWgs(latitude.toFixed(8), longitude.toFixed(8));
        setHEll(altitude === null ? '' : altitude.toFixed(3));
        setAcc(accuracy.toFixed(1));
        setFromGps(true);
        setBusy(false);
        setError('');
      },
      (err) => {
        setError(`Không lấy được vị trí: ${err.message}`);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const submit = () => {
    const xv = num(x);
    const yv = num(y);
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      setError('Cần có tọa độ X, Y hợp lệ (VN-2000).');
      return;
    }
    const la = num(lat);
    const lo = num(lon);
    const wgs = Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : toWgs(xv, yv, project.crs);
    onSave({
      id: point?.id ?? uid('pt'),
      projectId: project.id,
      name: name.trim() || suggestedName,
      code: code.trim(),
      book: book.trim() || defaultBook,
      note: note.trim(),
      lat: wgs.lat,
      lon: wgs.lon,
      x: xv,
      y: yv,
      h: Number.isFinite(num(h)) ? num(h) : null,
      hEll: Number.isFinite(num(hEll)) ? num(hEll) : null,
      accuracy: Number.isFinite(num(acc)) ? num(acc) : null,
      source: point?.source ?? (fromGps ? 'gps' : 'manual'),
      createdAt: point?.createdAt ?? Date.now(),
    });
  };

  return (
    <Modal
      title={point ? `Sửa điểm ${point.name}` : 'Thêm điểm'}
      onClose={onClose}
      footer={
        <>
          {point && onDelete ? (
            <button className="btn btn-danger" onClick={() => onDelete(point.id)}>
              Xóa điểm
            </button>
          ) : null}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Lưu điểm
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="pt-name">Tên điểm *</label>
          <input id="pt-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="pt-code">Mã / loại điểm</label>
          <input id="pt-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mốc, tim, góc thửa…" />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="pt-book">Sổ đo</label>
          <input id="pt-book" value={book} onChange={(e) => setBook(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pt-note">Ghi chú</label>
          <input id="pt-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>VN-2000 · {crsShort(project.crs)}</label>
        <div className="grid2">
          <input
            aria-label="X (Bắc)"
            value={x}
            onChange={(e) => onGrid(e.target.value, y)}
            placeholder="X (Bắc)"
            inputMode="decimal"
          />
          <input
            aria-label="Y (Đông)"
            value={y}
            onChange={(e) => onGrid(x, e.target.value)}
            placeholder="Y (Đông)"
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="field">
        <label>WGS-84</label>
        <div className="grid2">
          <input
            aria-label="B (vĩ độ)"
            value={lat}
            onChange={(e) => onWgs(e.target.value, lon)}
            placeholder="B (vĩ độ)"
            inputMode="decimal"
          />
          <input
            aria-label="L (kinh độ)"
            value={lon}
            onChange={(e) => onWgs(lat, e.target.value)}
            placeholder="L (kinh độ)"
            inputMode="decimal"
          />
        </div>
        <p className="note">Sửa ô nào cũng được — hệ còn lại tự tính theo kinh tuyến trục của công trình.</p>
      </div>

      <div className="grid3">
        <div className="field">
          <label htmlFor="pt-h">H thủy chuẩn (m)</label>
          <input id="pt-h" value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" placeholder="tùy chọn" />
        </div>
        <div className="field">
          <label htmlFor="pt-hell">h elipsoid (m)</label>
          <input id="pt-hell" value={hEll} onChange={(e) => setHEll(e.target.value)} inputMode="decimal" placeholder="từ GPS" />
        </div>
        <div className="field">
          <label htmlFor="pt-acc">Sai số ± (m)</label>
          <input id="pt-acc" value={acc} onChange={(e) => setAcc(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <p className="note">
        h elipsoid lấy từ GPS điện thoại <em>không phải</em> cao độ VN-2000 (Hon Dau). Muốn có H đúng phải dùng geoid
        hoặc thủy chuẩn — đừng dùng chênh cao elipsoid để tính đào/đắp.
      </p>

      <div>
        <button className="btn btn-sm" onClick={useGps} disabled={busy}>
          {busy ? 'Đang lấy vị trí…' : '◎ Lấy vị trí GPS hiện tại'}
        </button>
      </div>

      {error ? <p className="note warn">{error}</p> : null}
    </Modal>
  );
}
