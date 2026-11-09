import type { Project } from '../lib/types';

interface TopBarProps {
  projects: Project[];
  project: Project | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onEditProject: () => void;
  onImport: () => void;
  onExport: () => void;
  onTools: () => void;
  onPresent: () => void;
  onToggleSidebar: () => void;
  onHelp: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function TopBar({
  projects,
  project,
  onSelectProject,
  onNewProject,
  onEditProject,
  onImport,
  onExport,
  onTools,
  onPresent,
  onToggleSidebar,
  onHelp,
  theme,
  onToggleTheme,
}: TopBarProps) {
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onToggleSidebar} aria-label="Mở danh sách điểm" title="Danh sách điểm">
        ☰
      </button>

      <div className="brand" title="TOPSEC Survey Workspace">
        <svg viewBox="0 0 30 34" aria-hidden="true">
          <path
            d="M15 1 2 6v10c0 8 5.5 14 13 17 7.5-3 13-9 13-17V6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="M15 6v22c-5-2.5-9-7-9-12V9z" fill="#d6101a" />
        </svg>
        <span>
          TOP<b>SEC</b>
          <small>Survey Workspace</small>
        </span>
      </div>

      <div className="topbar-sep" />

      <select
        value={project?.id ?? ''}
        onChange={(e) => onSelectProject(e.target.value)}
        aria-label="Chọn công trình"
        style={{
          maxWidth: 260,
          padding: '7px 10px',
          borderRadius: 9,
          border: '1px solid var(--line)',
          background: 'var(--panel-2)',
          fontWeight: 600,
        }}
      >
        {projects.length === 0 ? <option value="">Chưa có công trình</option> : null}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <button className="btn btn-sm" onClick={onNewProject} title="Tạo công trình mới">
        + Công trình
      </button>

      <button className="btn btn-sm" onClick={onEditProject} disabled={!project} title="Sửa tên và hệ tọa độ">
        ⚙ <span className="label">Hệ tọa độ</span>
      </button>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button className="btn btn-sm" onClick={onImport} disabled={!project} title="Nhập CSV / TXT / GeoJSON / KML">
          ⬆ <span className="label">Nhập dữ liệu</span>
        </button>
        <button className="btn btn-sm" onClick={onExport} disabled={!project} title="Xuất CSV / DXF / KML / GeoJSON">
          ⬇ <span className="label">Xuất dữ liệu</span>
        </button>
        <button className="btn btn-sm" onClick={onTools} disabled={!project} title="COGO và chuyển đổi tọa độ">
          🧮 <span className="label">Công cụ</span>
        </button>
        <button className="btn btn-sm" onClick={onPresent} title="Trình chiếu point cloud / dữ liệu 3D">
          🛰 <span className="label">Trình chiếu</span>
        </button>
        <button className="icon-btn" onClick={onHelp} aria-label="Hướng dẫn sử dụng" title="Hướng dẫn sử dụng">
          ?
        </button>
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label="Đổi giao diện sáng/tối"
          title="Đổi giao diện sáng/tối"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
