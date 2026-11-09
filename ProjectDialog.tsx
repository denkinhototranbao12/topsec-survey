import { useState } from 'react';
import Modal from './Modal';
import { PROVINCES, ZONES_6, formatMeridian } from '../lib/provinces';
import { crsSummary, makeCrs } from '../lib/crs';
import type { CRSConfig, Project } from '../lib/types';

interface ProjectDialogProps {
  project: Project | null;
  onClose: () => void;
  onSave: (draft: { name: string; client: string; note: string; crs: CRSConfig }) => void;
  onDelete?: (id: string) => void;
}

function locate(crs?: CRSConfig) {
  if (crs) {
    for (const p of PROVINCES) {
      const idx = p.areas.findIndex((a) => Math.abs(a.lon0 - crs.lon0) < 1e-9);
      if (idx >= 0) return { province: p.province, areaIdx: idx };
    }
  }
  const haNoi = PROVINCES.find((p) => p.province === 'Hà Nội') ?? PROVINCES[0];
  return { province: haNoi.province, areaIdx: 0 };
}

export default function ProjectDialog({ project, onClose, onSave, onDelete }: ProjectDialogProps) {
  const initial = locate(project?.crs);
  const [name, setName] = useState(project?.name ?? '');
  const [client, setClient] = useState(project?.client ?? '');
  const [note, setNote] = useState(project?.note ?? '');
  const [mode, setMode] = useState<3 | 6>(project?.crs.mode ?? 3);
  const [province, setProvince] = useState(initial.province);
  const [areaIdx, setAreaIdx] = useState(initial.areaIdx);
  const [custom, setCustom] = useState(false);
  const [customLon, setCustomLon] = useState(String(project?.crs.lon0 ?? 105));
  const [zone, setZone] = useState(project?.crs.mode === 6 ? project.crs.lon0 : 108);
  const [error, setError] = useState('');

  const group = PROVINCES.find((p) => p.province === province) ?? PROVINCES[0];
  const area = group.areas[Math.min(areaIdx, group.areas.length - 1)] ?? group.areas[0];

  const crs: CRSConfig =
    mode === 6
      ? makeCrs(6, zone, ZONES_6.find((z) => z.lon0 === zone)?.label ?? `Múi ${zone}°`)
      : custom
        ? makeCrs(3, Number(customLon) || 0, 'Tùy nhập kinh tuyến trục')
        : makeCrs(3, area.lon0, area.label);

  const submit = () => {
    if (!name.trim()) {
      setError('Hãy nhập tên công trình.');
      return;
    }
    if (!(crs.lon0 >= 100 && crs.lon0 <= 112)) {
      setError('Kinh tuyến trục phải nằm trong khoảng 100° – 112° cho lãnh thổ Việt Nam.');
      return;
    }
    onSave({ name: name.trim(), client: client.trim(), note: note.trim(), crs });
  };

  return (
    <Modal
      title={project ? 'Thông tin công trình' : 'Công trình mới'}
      onClose={onClose}
      footer={
        <>
          {project && onDelete ? (
            <button
              className="btn btn-danger"
              onClick={() => {
                if (window.confirm(`Xóa công trình “${project.name}” và toàn bộ điểm bên trong?`)) {
                  onDelete(project.id);
                }
              }}
            >
              Xóa công trình
            </button>
          ) : null}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {project ? 'Lưu thay đổi' : 'Tạo công trình'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="prj-name">Tên công trình *</label>
        <input
          id="prj-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ví dụ: Khảo sát hiện trạng khu đất Thủ Đức"
          autoFocus
        />
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="prj-client">Chủ đầu tư / khách hàng</label>
          <input id="prj-client" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="prj-note">Ghi chú</label>
          <input id="prj-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Hệ tọa độ</label>
        <div className="segmented">
          <button aria-pressed={mode === 3} onClick={() => setMode(3)}>
            Múi 3° (theo tỉnh)
          </button>
          <button aria-pressed={mode === 6} onClick={() => setMode(6)}>
            Múi 6° (48 / 49 / 50)
          </button>
        </div>
      </div>

      {mode === 3 ? (
        <>
          <div className="grid2">
            <div className="field">
              <label htmlFor="prj-prov">Tỉnh / thành</label>
              <select
                id="prj-prov"
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setAreaIdx(0);
                  setCustom(false);
                }}
              >
                {PROVINCES.map((p) => (
                  <option key={p.province} value={p.province}>
                    {p.province}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="prj-area">Khu vực / kinh tuyến trục</label>
              <select
                id="prj-area"
                value={areaIdx}
                disabled={custom}
                onChange={(e) => {
                  setAreaIdx(Number(e.target.value));
                  setCustom(false);
                }}
              >
                {group.areas.map((a, i) => (
                  <option key={`${a.lon0}-${a.label}`} value={i}>
                    {a.label} — {formatMeridian(a.lon0)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => setCustom(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Tự nhập kinh tuyến trục
          </label>

          {custom ? (
            <div className="field" style={{ maxWidth: 180 }}>
              <label htmlFor="prj-lon">Kinh tuyến trục (°)</label>
              <input
                id="prj-lon"
                type="number"
                step="0.25"
                value={customLon}
                onChange={(e) => setCustomLon(e.target.value)}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="prj-zone">Múi chiếu 6°</label>
          <select id="prj-zone" value={zone} onChange={(e) => setZone(Number(e.target.value))}>
            {ZONES_6.map((z) => (
              <option key={z.lon0} value={z.lon0}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="result">
        <strong>{crsSummary(crs)}</strong>
        {'\n'}Ellipsoid WGS-84 · lưới chiếu Transverse Mercator · X = Bắc, Y = Đông · X0 = 500 000 m
      </div>

      <p className="note">
        Kinh tuyến trục theo Thông tư 25/2014/TT-BTNMT; tên tỉnh cập nhật theo Nghị quyết 202/2025/QH15. Tỉnh sau sáp
        nhập có thể nằm trên nhiều khu vực có KTT khác nhau — chọn đúng khu vực của công trình.
      </p>

      {error ? <p className="note warn">{error}</p> : null}
    </Modal>
  );
}
