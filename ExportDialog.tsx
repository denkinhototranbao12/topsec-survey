import { useMemo, useState } from 'react';
import Modal from './Modal';
import { buildExport, type ExportFormat } from '../lib/exporters';
import { crsSummary } from '../lib/crs';
import { downloadText, safeFileName, stamp } from '../lib/format';
import type { Project, SurveyPoint } from '../lib/types';

interface ExportDialogProps {
  project: Project;
  points: SurveyPoint[];
  selectedPoints: SurveyPoint[];
  onClose: () => void;
  onToast: (message: string) => void;
}

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'csv', label: 'CSV', hint: 'Bảng tính, có BOM cho Excel' },
  { id: 'txt', label: 'TXT', hint: 'Tên X Y H Mã – cho máy toàn đạc' },
  { id: 'dxf', label: 'DXF', hint: 'CAD, đơn vị mét, lớp DIEM/TEN' },
  { id: 'kml', label: 'KML', hint: 'Google Earth' },
  { id: 'geojson', label: 'GeoJSON', hint: 'Web GIS, QGIS' },
  { id: 'backup', label: 'Sao lưu JSON', hint: 'Đầy đủ dữ liệu để khôi phục' },
];

export default function ExportDialog({ project, points, selectedPoints, onClose, onToast }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [decimals, setDecimals] = useState(3);
  const [includeHeader, setIncludeHeader] = useState(true);

  const source = scope === 'selected' ? selectedPoints : points;

  const built = useMemo(
    () => buildExport(format, source, project, { decimals, includeHeader }),
    [format, source, project, decimals, includeHeader],
  );

  const preview = useMemo(() => built.text.split(/\r?\n/).slice(0, 16).join('\n'), [built]);
  const fileName = `${safeFileName(project.name)}_${stamp()}.${built.ext}`;

  return (
    <Modal
      title="Xuất dữ liệu"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="note">
            {source.length.toLocaleString('vi-VN')} điểm · {built.ext.toUpperCase()}
          </span>
          <span className="grow" />
          <button
            className="btn"
            disabled={!source.length}
            onClick={() => {
              navigator.clipboard
                .writeText(built.text)
                .then(() => onToast('Đã sao chép nội dung.'))
                .catch(() => onToast('Không sao chép được – hãy tải tệp.'));
            }}
          >
            Sao chép
          </button>
          <button
            className="btn btn-primary"
            disabled={!source.length}
            onClick={() => {
              downloadText(fileName, built.text, built.mime);
              onToast(`Đã tạo tệp ${fileName}`);
            }}
          >
            ⬇ Tải tệp
          </button>
        </>
      }
    >
      <div className="field">
        <label>Phạm vi</label>
        <div className="segmented">
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Tất cả ({points.length.toLocaleString('vi-VN')})
          </button>
          <button aria-pressed={scope === 'selected'} onClick={() => setScope('selected')} disabled={!selectedPoints.length}>
            Đang chọn ({selectedPoints.length})
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {FORMATS.map((f) => (
          <button key={f.id} className="tab" role="tab" aria-selected={format === f.id} onClick={() => setFormat(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <p className="note">{FORMATS.find((f) => f.id === format)?.hint}</p>

      <div className="grid2">
        <div className="field">
          <label htmlFor="exp-dec">Số chữ số thập phân</label>
          <select id="exp-dec" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))}>
            <option value={2}>2 (cm)</option>
            <option value={3}>3 (mm)</option>
            <option value={4}>4</option>
          </select>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-end', fontSize: 12.5, paddingBottom: 9 }}>
          <input
            type="checkbox"
            checked={includeHeader}
            onChange={(e) => setIncludeHeader(e.target.checked)}
            style={{ width: 'auto' }}
            disabled={format !== 'csv'}
          />
          Có dòng tiêu đề (CSV)
        </label>
      </div>

      <div className="result">
        <strong>{crsSummary(project.crs)}</strong>
        {'\n'}Tệp xuất kèm hệ tọa độ trong phần mô tả/tiêu đề để không bị mất nguồn gốc.
      </div>

      <pre className="preview">{preview || 'Chưa có dữ liệu.'}</pre>
    </Modal>
  );
}
