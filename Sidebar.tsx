import { useEffect, useRef, useState } from 'react';
import type { Project, SurveyPoint } from '../lib/types';
import { fmt, fmtCount, fmtTime } from '../lib/format';
import { sourceLabel } from '../lib/exporters';

const ROW_H = 58;

const SOURCE_COLOR: Record<SurveyPoint['source'], string> = {
  gps: 'var(--accent)',
  import: 'var(--brand)',
  manual: '#0f766e',
  measure: '#b45309',
  cogo: '#7c3aed',
};

interface SidebarProps {
  project: Project | null;
  points: SurveyPoint[];
  total: number;
  selected: string[];
  query: string;
  onQuery: (v: string) => void;
  books: string[];
  bookFilter: string;
  onBookFilter: (b: string) => void;
  onToggle: (id: string) => void;
  onFocus: (p: SurveyPoint) => void;
  onAdd: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDeleteSelected: () => void;
  onOpenProject: () => void;
  open: boolean;
}

export default function Sidebar({
  project,
  points,
  total,
  selected,
  query,
  onQuery,
  books,
  bookFilter,
  onBookFilter,
  onToggle,
  onFocus,
  onAdd,
  onEdit,
  onExport,
  onDeleteSelected,
  onOpenProject,
  open,
}: SidebarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(420);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, bookFilter, project?.id]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const end = Math.min(points.length, Math.ceil((scrollTop + viewport) / ROW_H) + 6);
  const slice = points.slice(start, end);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-head">
        <div className="sidebar-title">
          <h2>Điểm đo</h2>
          <span className="count">
            {fmtCount(points.length)}
            {points.length !== total ? ` / ${fmtCount(total)}` : ''}
          </span>
        </div>

        <div className="search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Tìm theo tên, mã, ghi chú…"
            aria-label="Tìm điểm"
          />
        </div>

        {books.length > 1 ? (
          <div className="chips">
            <button className="chip" aria-pressed={bookFilter === '__all'} onClick={() => onBookFilter('__all')}>
              Tất cả sổ
            </button>
            {books.map((b) => (
              <button key={b} className="chip" aria-pressed={bookFilter === b} onClick={() => onBookFilter(b)}>
                {b}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className="list-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {points.length === 0 ? (
          <div className="empty">
            <h3>{project ? 'Chưa có điểm nào' : 'Chưa có công trình'}</h3>
            <p className="note">
              {project
                ? 'Bấm “Thêm điểm” để nhập tay, hoặc “Nhập dữ liệu” để đưa sổ đo từ điện thoại lên.'
                : 'Tạo công trình để bắt đầu: chọn tỉnh/thành để có kinh tuyến trục đúng.'}
            </p>
            {project ? (
              <button className="btn btn-primary btn-sm" onClick={onAdd}>
                + Thêm điểm
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={onOpenProject}>
                + Tạo công trình
              </button>
            )}
          </div>
        ) : (
          <div style={{ height: points.length * ROW_H, position: 'relative' }}>
            {slice.map((p, i) => {
              const top = (start + i) * ROW_H;
              const isSel = selected.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={`row${isSel ? ' selected' : ''}`}
                  style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
                  onClick={() => onFocus(p)}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggle(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Chọn ${p.name}`}
                  />
                  <div className="row-main">
                    <div className="row-name">
                      <span className="dot" style={{ background: SOURCE_COLOR[p.source] }} />
                      {p.name}
                      {p.code ? <span style={{ color: 'var(--mute)', fontWeight: 500 }}>· {p.code}</span> : null}
                    </div>
                    <div className="row-meta">
                      X {fmt(p.x, 2)} · Y {fmt(p.y, 2)}
                    </div>
                    <div className="row-meta">
                      {fmtTime(p.createdAt)} · {sourceLabel(p.source)}
                      {p.accuracy !== null ? ` · ±${fmt(p.accuracy, 1)} m` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        {selected.length > 0 ? (
          <>
            <span className="note">Đã chọn {fmtCount(selected.length)}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={onEdit} disabled={selected.length !== 1}>
              Sửa
            </button>
            <button className="btn btn-sm" onClick={onExport}>
              Xuất
            </button>
            <button className="btn btn-sm btn-danger" onClick={onDeleteSelected}>
              Xóa
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm btn-primary" onClick={onAdd} disabled={!project}>
              + Thêm điểm
            </button>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={onExport} disabled={!project || points.length === 0}>
              Xuất
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
