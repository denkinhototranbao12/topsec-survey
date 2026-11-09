import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { parseImport, type ParsedPoint, type ParseResult } from '../lib/importers';
import { fmt } from '../lib/format';
import type { Project } from '../lib/types';

interface ImportDialogProps {
  project: Project;
  defaultBook: string;
  onClose: () => void;
  onImport: (rows: ParsedPoint[], mode: 'grid' | 'wgs', book: string) => number;
}

export default function ImportDialog({ project, defaultBook, onClose, onImport }: ImportDialogProps) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'grid' | 'wgs'>('grid');
  const [book, setBook] = useState(defaultBook);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const modeTouched = useRef(false);

  useEffect(() => {
    if (!text.trim()) {
      setParsed(null);
      setError('');
      return;
    }
    const timer = setTimeout(() => {
      try {
        const result = parseImport(text, fileName);
        setParsed(result);
        setError('');
        if (!modeTouched.current) {
          setMode(result.kind === 'wgs' ? 'wgs' : 'grid');
        }
      } catch (e) {
        setParsed(null);
        setError(e instanceof Error ? e.message : 'Không đọc được nội dung tệp.');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text, fileName]);

  const readFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.onerror = () => setError('Không đọc được tệp.');
    reader.readAsText(file, 'UTF-8');
  };

  const preview = parsed?.points.slice(0, 6) ?? [];

  return (
    <Modal
      title="Nhập dữ liệu"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            disabled={!parsed || parsed.points.length === 0}
            onClick={() => {
              if (!parsed) return;
              const count = onImport(parsed.points, mode, book.trim() || defaultBook);
              if (count > 0) onClose();
            }}
          >
            Nhập {parsed ? parsed.points.length.toLocaleString('vi-VN') : 0} điểm
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label>Chọn tệp</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.geojson,.json,.kml,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="imp-book">Sổ đo nhận</label>
          <input id="imp-book" value={book} onChange={(e) => setBook(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="imp-text">Hoặc dán nội dung</label>
        <textarea
          id="imp-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'M1,1452004.223,858098.080,25.1\nM2,1452013.500,858104.900,25.3'}
        />
      </div>

      <div className="field">
        <label>Hệ tọa độ của tệp</label>
        <div className="segmented">
          <button
            aria-pressed={mode === 'grid'}
            onClick={() => {
              modeTouched.current = true;
              setMode('grid');
            }}
          >
            VN-2000 (X, Y)
          </button>
          <button
            aria-pressed={mode === 'wgs'}
            onClick={() => {
              modeTouched.current = true;
              setMode('wgs');
            }}
          >
            WGS-84 (B, L)
          </button>
        </div>
        <p className="note">
          VN-2000 dùng kinh tuyến trục của công trình. Khi nhập, X/Y và B/L được tính lại và lưu cùng điểm.
        </p>
      </div>

      {error ? <p className="note warn">{error}</p> : null}

      {parsed ? (
        <>
          <div className="result">
            Đọc được <strong>{parsed.points.length.toLocaleString('vi-VN')}</strong> điểm ·{' '}
            {parsed.format === 'backup'
              ? 'bản sao lưu TOPSEC'
              : parsed.format === 'geojson'
                ? 'GeoJSON'
                : parsed.format === 'kml'
                  ? 'KML'
                  : 'bảng CSV/TXT'}
            {parsed.kind !== 'unknown' ? ` · phát hiện ${parsed.kind === 'grid' ? 'X/Y' : 'B/L'}` : ''}
            {parsed.skipped ? ` · bỏ qua ${parsed.skipped} dòng` : ''}
          </div>

          {parsed.warnings.length ? (
            <ul className="warn-list">
              {parsed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {preview.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>X / B</th>
                    <th>Y / L</th>
                    <th>H</th>
                    <th>Mã</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={`${p.name}-${i}`}>
                      <td>{p.name}</td>
                      <td>{p.x !== null ? fmt(p.x, 3) : p.lat !== null ? p.lat.toFixed(7) : '—'}</td>
                      <td>{p.y !== null ? fmt(p.y, 3) : p.lon !== null ? p.lon.toFixed(7) : '—'}</td>
                      <td>{p.h !== null ? fmt(p.h, 3) : '—'}</td>
                      <td>{p.code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="note">Dự phòng tối đa 6 dòng đầu. Bấm “Nhập” để ghi vào công trình {project.name}.</p>
        </>
      ) : (
        <p className="note">
          Hỗ trợ CSV/TXT (Tên, X, Y, H, Mã hoặc Tên, B, L), GeoJSON và KML. Có tiêu đề hay không đều được.
        </p>
      )}
    </Modal>
  );
}
