import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import MapView, { type MapHandle } from './components/MapView';
import ProjectDialog from './components/ProjectDialog';
import PointDialog from './components/PointDialog';
import ImportDialog from './components/ImportDialog';
import ExportDialog from './components/ExportDialog';
import ToolsDialog from './components/ToolsDialog';
import HelpDialog from './components/HelpDialog';
import PresentationView from './components/PresentationView';
import { loadAll, putMany, removeMany, requestPersistence } from './lib/db';
import { crsSummary, makeCrs, toGrid, toWgs } from './lib/crs';
import { fmt, fmtCount, uid } from './lib/format';
import { buildSamplePoints } from './lib/sample';
import type { ParsedPoint } from './lib/importers';
import type { Basemap, CRSConfig, Project, StorageState, SurveyPoint } from './lib/types';

type DialogName = 'project' | 'point' | 'import' | 'export' | 'tools' | 'help' | null;

/** Chuẩn hóa toạ độ của một dòng nhập: giữ đúng hệ người dùng chọn, hệ còn lại tính lại. */
function resolveCoords(row: ParsedPoint, mode: 'grid' | 'wgs', crs: CRSConfig) {
  const hasGrid = row.x !== null && row.y !== null;
  const hasWgs = row.lat !== null && row.lon !== null;

  if (mode === 'grid') {
    if (hasGrid) {
      const x = row.x as number;
      const y = row.y as number;
      const w = toWgs(x, y, crs);
      return { x, y, lat: w.lat, lon: w.lon };
    }
    if (hasWgs) {
      const lat = row.lat as number;
      const lon = row.lon as number;
      const g = toGrid(lat, lon, crs);
      return { x: g.x, y: g.y, lat, lon };
    }
    return null;
  }

  if (hasWgs) {
    const lat = row.lat as number;
    const lon = row.lon as number;
    const g = toGrid(lat, lon, crs);
    return { x: g.x, y: g.y, lat, lon };
  }
  if (hasGrid) {
    const x = row.x as number;
    const y = row.y as number;
    const w = toWgs(x, y, crs);
    return { x, y, lat: w.lat, lon: w.lon };
  }
  return null;
}

function readTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('topsec-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* chế độ riêng tư có thể chặn localStorage – không quan trọng */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allPoints, setAllPoints] = useState<SurveyPoint[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('__all');
  const [basemap, setBasemap] = useState<Basemap>('sat');
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [editingPoint, setEditingPoint] = useState<SurveyPoint | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [storage, setStorage] = useState<StorageState>({ status: 'idle' });
  const [booted, setBooted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [toast, setToast] = useState<{ msg: string; action?: { label: string; run: () => void } } | null>(null);
  const [presenting, setPresenting] = useState(false);

  const mapRef = useRef<MapHandle | null>(null);
  const lastCursor = useRef(0);

  const project = useMemo(
    () => projects.find((p) => p.id === currentId) ?? projects[0] ?? null,
    [projects, currentId],
  );

  /* ---------- Nạp dữ liệu ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedProjects, storedPoints] = await Promise.all([
          loadAll<Project>('projects'),
          loadAll<SurveyPoint>('points'),
        ]);
        if (cancelled) return;
        const sorted = storedProjects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(sorted);
        setAllPoints(storedPoints);
        if (sorted.length) setCurrentId(sorted[0].id);
        setStorage({ status: 'ok' });
        void requestPersistence();
      } catch (e) {
        if (cancelled) return;
        setStorage({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('topsec-theme', theme);
    } catch {
      /* bỏ qua */
    }
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg: string, action?: { label: string; run: () => void }) => {
    setToast({ msg, action });
  }, []);

  const failWrite = useCallback((e: unknown) => {
    setStorage({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    notify('Không ghi được dữ liệu — hãy xuất sao lưu ngay.');
  }, [notify]);

  const writePoints = useCallback(
    (items: SurveyPoint[]) => {
      if (!items.length) return;
      setStorage({ status: 'saving' });
      putMany('points', items)
        .then(() => setStorage({ status: 'ok' }))
        .catch(failWrite);
    },
    [failWrite],
  );

  const writeProjects = useCallback(
    (items: Project[]) => {
      if (!items.length) return;
      setStorage({ status: 'saving' });
      putMany('projects', items)
        .then(() => setStorage({ status: 'ok' }))
        .catch(failWrite);
    },
    [failWrite],
  );

  /* ---------- Dữ liệu dẫn xuất ---------- */
  const projectPoints = useMemo(
    () => (project ? allPoints.filter((p) => p.projectId === project.id) : []),
    [allPoints, project],
  );

  const sortedPoints = useMemo(() => projectPoints.slice().sort((a, b) => b.createdAt - a.createdAt), [projectPoints]);

  const books = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of sortedPoints) {
      if (p.book && !seen.has(p.book)) {
        seen.add(p.book);
        list.push(p.book);
      }
    }
    return list;
  }, [sortedPoints]);

  const viewPoints = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedPoints.filter((p) => {
      if (bookFilter !== '__all' && p.book !== bookFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.code} ${p.note} ${p.book} ${fmt(p.x, 2)} ${fmt(p.y, 2)}`.toLowerCase().includes(q);
    });
  }, [sortedPoints, query, bookFilter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const selectedPoints = useMemo(
    () => projectPoints.filter((p) => selectedSet.has(p.id)),
    [projectPoints, selectedSet],
  );

  const cursorGrid = useMemo(
    () => (cursor && project ? toGrid(cursor.lat, cursor.lon, project.crs) : null),
    [cursor, project],
  );

  const defaultBook = books[0] ?? 'Sổ đo 1';

  /* ---------- Thao tác điểm ---------- */
  const addPoints = useCallback(
    (incoming: SurveyPoint[]) => {
      if (!incoming.length) return;
      setAllPoints((prev) => [...prev, ...incoming]);
      writePoints(incoming);
    },
    [writePoints],
  );

  const upsertPoint = useCallback(
    (p: SurveyPoint) => {
      setAllPoints((prev) => {
        const idx = prev.findIndex((x) => x.id === p.id);
        if (idx === -1) return [...prev, p];
        const next = prev.slice();
        next[idx] = p;
        return next;
      });
      writePoints([p]);
    },
    [writePoints],
  );

  const restorePoints = useCallback(
    (items: SurveyPoint[]) => {
      setAllPoints((prev) => [...prev, ...items]);
      writePoints(items);
    },
    [writePoints],
  );

  const deletePoints = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const idSet = new Set(ids);
      const removed = allPoints.filter((p) => idSet.has(p.id));
      if (!removed.length) return;
      setAllPoints((prev) => prev.filter((p) => !idSet.has(p.id)));
      setSelected((prev) => prev.filter((id) => !idSet.has(id)));
      setStorage({ status: 'saving' });
      removeMany('points', ids)
        .then(() => setStorage({ status: 'ok' }))
        .catch(failWrite);
      notify(`Đã xóa ${fmtCount(removed.length)} điểm.`, { label: 'Hoàn tác', run: () => restorePoints(removed) });
    },
    [allPoints, failWrite, notify, restorePoints],
  );

  /* ---------- Thao tác công trình ---------- */
  const saveProject = useCallback(
    (draft: { name: string; client: string; note: string; crs: CRSConfig }) => {
      const now = Date.now();
      if (editingProject) {
        const changed = editingProject.crs.lon0 !== draft.crs.lon0 || editingProject.crs.k !== draft.crs.k;
        const updated: Project = { ...editingProject, ...draft, updatedAt: now };
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        writeProjects([updated]);
        notify(
          changed
            ? 'Đã đổi kinh tuyến trục. Toạ độ X/Y của điểm cũ giữ nguyên — kiểm tra lại nếu cần.'
            : 'Đã lưu thông tin công trình.',
        );
      } else {
        const created: Project = { id: uid('prj'), ...draft, createdAt: now, updatedAt: now };
        setProjects((prev) => [created, ...prev]);
        setCurrentId(created.id);
        setSelected([]);
        writeProjects([created]);
        notify(`Đã tạo công trình “${created.name}”.`);
      }
      setDialog(null);
      setEditingProject(null);
    },
    [editingProject, notify, writeProjects],
  );

  const deleteProject = useCallback(
    (id: string) => {
      const ids = allPoints.filter((p) => p.projectId === id).map((p) => p.id);
      const remaining = projects.filter((p) => p.id !== id);
      setProjects(remaining);
      setAllPoints((prev) => prev.filter((p) => p.projectId !== id));
      setSelected([]);
      if (currentId === id) setCurrentId(remaining[0]?.id ?? '');
      setStorage({ status: 'saving' });
      Promise.all([removeMany('projects', [id]), removeMany('points', ids)])
        .then(() => setStorage({ status: 'ok' }))
        .catch(failWrite);
      setDialog(null);
      setEditingProject(null);
      notify(`Đã xóa công trình và ${fmtCount(ids.length)} điểm bên trong.`);
    },
    [allPoints, projects, currentId, failWrite, notify],
  );

  const createSample = useCallback(() => {
    const crs = makeCrs(3, 105.75, 'TP. Hồ Chí Minh – Bình Dương (105.75°)');
    const now = Date.now();
    const created: Project = {
      id: uid('prj'),
      name: 'Công trình mẫu – TP. Hồ Chí Minh',
      client: 'TOPSEC',
      note: 'Dữ liệu mẫu để xem giao diện và thử hiệu năng',
      crs,
      createdAt: now,
      updatedAt: now,
    };
    const pts = buildSamplePoints({ projectId: created.id, crs });
    setProjects((prev) => [created, ...prev]);
    setCurrentId(created.id);
    setAllPoints((prev) => [...prev, ...pts]);
    setSelected([]);
    writeProjects([created]);
    writePoints(pts);
    notify(`Đã tạo công trình mẫu với ${fmtCount(pts.length)} điểm.`);
  }, [notify, writePoints, writeProjects]);

  /* ---------- Nhập dữ liệu ---------- */
  const importPoints = useCallback(
    (rows: ParsedPoint[], mode: 'grid' | 'wgs', book: string): number => {
      if (!project) return 0;
      const now = Date.now();
      const created: SurveyPoint[] = [];
      rows.forEach((row, i) => {
        const c = resolveCoords(row, mode, project.crs);
        if (!c) return;
        created.push({
          id: uid('im'),
          projectId: project.id,
          name: row.name || `P${i + 1}`,
          code: row.code,
          book,
          note: '',
          lat: c.lat,
          lon: c.lon,
          x: c.x,
          y: c.y,
          h: row.h,
          hEll: null,
          accuracy: row.accuracy,
          source: 'import',
          createdAt: now - i,
        });
      });
      if (!created.length) {
        notify('Không có dòng nào có toạ độ hợp lệ.');
        return 0;
      }
      const ids = created.map((p) => p.id);
      addPoints(created);
      notify(`Đã nhập ${fmtCount(created.length)} điểm và lưu vào máy.`, {
        label: 'Hoàn tác',
        run: () => {
          setAllPoints((prev) => prev.filter((p) => !ids.includes(p.id)));
          removeMany('points', ids).catch(failWrite);
        },
      });
      return created.length;
    },
    [project, addPoints, notify, failWrite],
  );

  /* ---------- Điều khiển ---------- */
  const openPoint = useCallback(
    (point: SurveyPoint | null) => {
      setEditingPoint(point);
      setDialog('point');
    },
    [],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const focusPoint = useCallback((p: SurveyPoint) => {
    setSelected([p.id]);
    mapRef.current?.flyTo(p.lat, p.lon, 18);
    setSidebarOpen(false);
  }, []);

  const handleCursor = useCallback((c: { lat: number; lon: number } | null) => {
    if (c === null) {
      setCursor(null);
      return;
    }
    const now = performance.now();
    if (now - lastCursor.current < 80) return;
    lastCursor.current = now;
    setCursor(c);
  }, []);

  const storageLabel =
    storage.status === 'error'
      ? 'Lỗi lưu dữ liệu'
      : storage.status === 'saving'
        ? 'Đang lưu…'
        : storage.status === 'ok'
          ? 'Đã lưu trên máy'
          : 'Sẵn sàng';

  return (
    <div className="app">
      <TopBar
        projects={projects}
        project={project}
        onSelectProject={(id) => {
          setCurrentId(id);
          setSelected([]);
          setBookFilter('__all');
        }}
        onNewProject={() => {
          setEditingProject(null);
          setDialog('project');
        }}
        onEditProject={() => {
          setEditingProject(project);
          setDialog('project');
        }}
        onImport={() => setDialog('import')}
        onExport={() => setDialog('export')}
        onTools={() => setDialog('tools')}
        onPresent={() => setPresenting(true)}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onHelp={() => setDialog('help')}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      {storage.status === 'error' ? (
        <div className="banner">
          <span>
            <strong>Không ghi được dữ liệu:</strong> {storage.message}
          </span>
          <span className="grow" />
          <button className="btn btn-sm" onClick={() => setDialog('export')}>
            Xuất sao lưu
          </button>
        </div>
      ) : null}

      <div className="main">
        <Sidebar
          project={project}
          points={viewPoints}
          total={projectPoints.length}
          selected={selected}
          query={query}
          onQuery={setQuery}
          books={books}
          bookFilter={bookFilter}
          onBookFilter={setBookFilter}
          onToggle={toggleSelect}
          onFocus={focusPoint}
          onAdd={() => openPoint(null)}
          onEdit={() => {
            const p = selectedPoints[0];
            if (p) openPoint(p);
          }}
          onExport={() => setDialog('export')}
          onDeleteSelected={() => deletePoints(selected)}
          onOpenProject={() => {
            setEditingProject(null);
            setDialog('project');
          }}
          open={sidebarOpen}
        />

        <MapView
          ref={mapRef}
          project={project}
          points={projectPoints}
          selectedIds={selected}
          basemap={basemap}
          onBasemapChange={setBasemap}
          onPick={(id) => {
            if (id) setSelected([id]);
          }}
          onAddPoints={addPoints}
          onCursor={handleCursor}
          onToast={notify}
        />

        {booted && !project ? (
          <div className="welcome">
            <div className="welcome-card">
              <h2>Bắt đầu một công trình</h2>
              <p>
                Chọn tỉnh/thành để app tự điền kinh tuyến trục VN-2000, rồi nhập điểm từ sổ đo trên điện thoại hoặc thêm
                điểm bằng tay. Chưa có dữ liệu? Nạp bộ mẫu để xem thử.
              </p>
              <div className="welcome-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditingProject(null);
                    setDialog('project');
                  }}
                >
                  + Tạo công trình
                </button>
                <button className="btn" onClick={createSample}>
                  Nạp dữ liệu mẫu
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="statusbar">
        <span>{project ? <strong>{crsSummary(project.crs)}</strong> : 'Chưa có công trình'}</span>
        <span className="hide-sm">{fmtCount(projectPoints.length)} điểm</span>
        {cursorGrid ? (
          <span className="hide-sm">
            X {fmt(cursorGrid.x, 2)} · Y {fmt(cursorGrid.y, 2)}
          </span>
        ) : null}
        <span className="hide-sm">{project?.crs.areaLabel ?? ''}</span>
        <span className="grow" />
        <span>
          <span className={`status-dot ${storage.status}`} />
          {storageLabel}
        </span>
      </footer>

      {dialog === 'project' ? (
        <ProjectDialog
          project={editingProject}
          onClose={() => {
            setDialog(null);
            setEditingProject(null);
          }}
          onSave={saveProject}
          onDelete={deleteProject}
        />
      ) : null}

      {dialog === 'point' && project ? (
        <PointDialog
          project={project}
          point={editingPoint}
          suggestedName={`P${projectPoints.length + 1}`}
          defaultBook={defaultBook}
          onClose={() => {
            setDialog(null);
            setEditingPoint(null);
          }}
          onSave={(p) => {
            upsertPoint(p);
            setDialog(null);
            setEditingPoint(null);
            notify(`Đã lưu điểm ${p.name}.`);
          }}
          onDelete={(id) => {
            deletePoints([id]);
            setDialog(null);
            setEditingPoint(null);
          }}
        />
      ) : null}

      {dialog === 'import' && project ? (
        <ImportDialog
          project={project}
          defaultBook={defaultBook}
          onClose={() => setDialog(null)}
          onImport={importPoints}
        />
      ) : null}

      {dialog === 'export' && project ? (
        <ExportDialog
          project={project}
          points={viewPoints}
          selectedPoints={selectedPoints}
          onClose={() => setDialog(null)}
          onToast={notify}
        />
      ) : null}

      {dialog === 'tools' && project ? (
        <ToolsDialog
          project={project}
          selectedPoints={selectedPoints}
          onClose={() => setDialog(null)}
          onAddPoint={upsertPoint}
          onToast={notify}
        />
      ) : null}

      {dialog === 'help' ? <HelpDialog onClose={() => setDialog(null)} /> : null}

      {presenting ? <PresentationView onClose={() => setPresenting(false)} /> : null}

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.action ? (
            <button
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
