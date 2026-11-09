import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LocalPotreeRequestManager,
  UrlPotreeRequestManager,
  GROUP_LABEL,
  parseDataIndex,
  parsePotreeMetadata,
  pickPotreeFiles,
  type DataIndex,
  type PotreeFileSet,
  type PotreeMetadata,
} from '../lib/pointcloud';
import { fmtBytes, fmtCount } from '../lib/format';

type ColorMode = 'height' | 'rgb' | 'intensity';

interface ViewerOptions {
  colorMode: ColorMode;
  pointSize: number;
  budget: number;
}

interface ViewerHandle {
  apply: (o: ViewerOptions) => void;
  reset: () => void;
}

interface Props {
  onClose: () => void;
}

export default function PresentationView({ onClose }: Props) {
  const [set, setSet] = useState<PotreeFileSet | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [meta, setMeta] = useState<PotreeMetadata | null>(null);
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [visiblePoints, setVisiblePoints] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('height');
  const [pointSize, setPointSize] = useState(1.2);
  const [budget, setBudget] = useState(2_000_000);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const indexInputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const optionsRef = useRef<ViewerOptions>({ colorMode, pointSize, budget });
  optionsRef.current = { colorMode, pointSize, budget };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* --------------------------- chọn dữ liệu --------------------------- */
  const loadFiles = useCallback(async (files: File[], sourceLabel: string) => {
    const picked = pickPotreeFiles(files);
    if (!picked.ok) {
      setStatus('error');
      setError(`Thiếu tệp: ${picked.missing.join(', ')}. Hãy chọn cả thư mục point cloud (${sourceLabel}).`);
      return;
    }
    try {
      const text = await picked.set.metadata.text();
      const parsed = parsePotreeMetadata(text);
      setMeta(parsed);
      setSet(picked.set);
      setUrl(null);
      setError(null);
      setStatus('loading');
      setColorMode(parsed.attributes.includes('rgb') ? 'rgb' : 'height');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onPickFolder = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length) void loadFiles(files, 'metadata + hierarchy + octree');
    },
    [loadFiles],
  );

  /** Mở point cloud đã đặt trên máy chủ có hỗ trợ HTTP Range. */
  const openUrl = useCallback(async () => {
    const base = urlDraft.trim().replace(/\/?$/, '/');
    if (!base) return;
    setStatus('loading');
    setError(null);
    try {
      let text: string | null = null;
      let lastError = '';
      for (const name of ['metadata.json', 'metadata.oct']) {
        try {
          const res = await fetch(base + name);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          text = await res.text();
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!text) throw new Error(`Không tải được metadata (${lastError}).`);
      const parsed = parsePotreeMetadata(text);
      setMeta(parsed);
      setUrl(base);
      setSet(null);
      setColorMode(parsed.attributes.includes('rgb') ? 'rgb' : 'height');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [urlDraft]);

  const onPickIndex = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setIndex(parseDataIndex(await file.text()));
      setError(null);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) void loadFiles(files, 'kéo cả 3 tệp vào đây');
    },
    [loadFiles],
  );

  /* --------------------------- dựng cảnh 3D --------------------------- */
  useEffect(() => {
    if ((!set && !url) || !canvasRef.current || !stageRef.current) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    let disposed = false;
    let raf = 0;
    let lastCount = 0;
    let ro: ResizeObserver | null = null;
    let cleanup: (() => void) | null = null;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const { Potree, PointColorType, PointSizeType } = await import('potree-core');
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0f14);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e7);
      camera.up.set(0, 0, 1);

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = false;

      const potree = new Potree();
      potree.pointBudget = optionsRef.current.budget;

      const manager = url
        ? new UrlPotreeRequestManager(url)
        : new LocalPotreeRequestManager([set!.metadata, set!.hierarchy, set!.octree]);
      const cloud = await potree.loadPointCloud('metadata.json', manager);
      if (disposed) return;
      scene.add(cloud);

      const material = cloud.material;
      // Potree 2.x bật new_format: shader chỉ lấy màu từ thuộc tính rgba và bỏ qua
      // kiểu màu (độ cao/cường độ). Dữ liệu không kèm màu sẽ ra đen tuyền, nên với
      // trường hợp đó quay về shader cũ để tô theo độ cao.
      if (!meta?.attributes.includes('rgb')) {
        material.newFormat = false;
        material.needsUpdate = true;
      }
      material.pointSizeType = PointSizeType.ADAPTIVE;
      material.size = optionsRef.current.pointSize;
      material.minSize = 1;
      material.maxSize = 12;

      material.intensityRange = [0, 1];

      // Metadata đã được chuẩn hoá offset = 0 (xem pointcloud.ts) nên toạ độ điểm và
      // hộp bao cùng một hệ cục bộ. Đặt camera theo hộp bao ngay để khối điểm đầu tiên
      // lọt tầm nhìn, rồi khung lại chính xác theo hộp bao thật sau khi khối đã nạp.
      let framed = false;
      const frame = (box: InstanceType<typeof THREE.Box3>, syncingHeights: boolean) => {
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z) || 1;
        if (syncingHeights) {
          material.heightMin = box.min.z;
          material.heightMax = box.max.z;
        }
        camera.position.set(center.x + radius * 0.85, center.y - radius * 1.05, center.z + radius * 0.8);
        camera.near = Math.max(radius / 2000, 0.01);
        camera.far = radius * 20;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
      };

      const frameCloud = () => {
        if (framed) return;
        const box = new THREE.Box3().setFromObject(cloud);
        if (box.isEmpty() || !Number.isFinite(box.min.x)) return;
        framed = true;
        frame(box, true);
      };

      frame(cloud.boundingBox.clone(), true);

      const renderFrame = () => {
        const result = potree.updatePointClouds([cloud], camera, renderer);
        frameCloud();
        return result;
      };

      const apply = (o: ViewerOptions) => {
        material.size = o.pointSize;
        potree.pointBudget = o.budget;
        if (o.colorMode === 'rgb') material.pointColorType = PointColorType.RGB;
        else if (o.colorMode === 'intensity') material.pointColorType = PointColorType.INTENSITY;
        else material.pointColorType = PointColorType.HEIGHT;
        // Kiểu màu là #define trong shader: đổi xong phải biên dịch lại, nếu không
        // điểm vẫn vẽ theo chế độ cũ (RGB không có dữ liệu màu → đen tuyền).
        material.needsUpdate = true;
      };
      apply(optionsRef.current);
      viewerRef.current = {
        apply,
        reset: () => {
          const box = new THREE.Box3().setFromObject(cloud);
          if (!box.isEmpty()) frame(box, false);
        },
      };

      const resize = () => {
        const w = stage.clientWidth || 1;
        const h = stage.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(stage);

      const loop = () => {
        if (disposed) return;
        const result = renderFrame();
        controls.update();
        renderer.render(scene, camera);
        const n = result?.numVisiblePoints ?? 0;
        if (Math.abs(n - lastCount) > 5000) {
          lastCount = n;
          setVisiblePoints(n);
        }
        raf = requestAnimationFrame(loop);
      };
      setStatus('ready');
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro?.disconnect();
        controls.dispose();
        cloud.dispose?.();
        renderer.dispose();
        viewerRef.current = null;
      };
    })().catch((e: unknown) => {
      if (disposed) return;
      setStatus('error');
      setError(
        `Không dựng được point cloud: ${e instanceof Error ? e.message : String(e)}. ` +
          'Kiểm tra thư mục có đủ metadata.oct, hierarchy.bin, octree.bin và đúng phiên bản Potree 2.x.',
      );
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [set, url]);

  useEffect(() => {
    viewerRef.current?.apply({ colorMode, pointSize, budget });
  }, [colorMode, pointSize, budget]);

  const hasRgb = meta?.attributes.includes('rgb') ?? false;
  const hasIntensity = meta?.attributes.includes('intensity') ?? false;
  const octreeBytes = set?.octree.size ?? 0;

  return (
    <div className="pv">
      <header className="pv-bar">
        <button className="pv-back" onClick={onClose} title="Đóng trình chiếu (Esc)">
          ← Bản đồ
        </button>
        <div className="pv-brand">
          <strong>Trình chiếu 3D</strong>
          <span>{meta ? meta.name : 'Point cloud Potree 2.x'}</span>
        </div>
        <span className="grow" />
        <button className="pv-btn" onClick={() => dirInputRef.current?.click()}>
          📁 Chọn thư mục
        </button>
        <button className="pv-btn" onClick={() => indexInputRef.current?.click()}>
          🗂 dataIndex.json
        </button>
        {set ? (
          <button className="pv-btn" onClick={() => viewerRef.current?.reset()}>
            ⤢ Đặt lại góc nhìn
          </button>
        ) : null}
        <input ref={dirInputRef} type="file" multiple hidden onChange={onPickFolder} />
        <input ref={indexInputRef} type="file" accept=".json,application/json" hidden onChange={onPickIndex} />
      </header>

      <div className="pv-body">
        <aside className="pv-rail">
          <div className="pv-card">
            <h4>Màu điểm</h4>
            <div className="pv-seg">
              <button
                className={colorMode === 'height' ? 'on' : ''}
                onClick={() => setColorMode('height')}
                title="Tô màu theo độ cao"
              >
                Độ cao
              </button>
              <button
                className={colorMode === 'rgb' ? 'on' : ''}
                onClick={() => setColorMode('rgb')}
                disabled={!hasRgb}
                title={hasRgb ? 'Màu gốc của điểm' : 'Dữ liệu này không có thuộc tính màu RGB'}
              >
                RGB
              </button>
              <button
                className={colorMode === 'intensity' ? 'on' : ''}
                onClick={() => setColorMode('intensity')}
                disabled={!hasIntensity}
                title={hasIntensity ? 'Cường độ phản hồi' : 'Dữ liệu này không có cường độ'}
              >
                C.độ
              </button>
            </div>
          </div>

          <div className="pv-card">
            <h4>
              Cỡ điểm <b>{pointSize.toFixed(1)}</b>
            </h4>
            <input
              type="range"
              min={0.4}
              max={4}
              step={0.1}
              value={pointSize}
              onChange={(e) => setPointSize(Number(e.target.value))}
            />
          </div>

          <div className="pv-card">
            <h4>
              Ngân sách điểm <b>{fmtCount(Math.round(budget / 1000))}k</b>
            </h4>
            <input
              type="range"
              min={500_000}
              max={6_000_000}
              step={100_000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
            <p>Máy yếu thì hạ xuống để xoay mượt.</p>
          </div>

          {meta ? (
            <div className="pv-card pv-info">
              <h4>Dữ liệu</h4>
              <dl>
                <dt>Điểm</dt>
                <dd>{fmtCount(meta.points)}</dd>
                <dt>Khoảng cách</dt>
                <dd>{meta.spacing ? `${meta.spacing.toFixed(2)} m` : '—'}</dd>
                {octreeBytes > 0 ? (
                  <>
                    <dt>octree.bin</dt>
                    <dd>{fmtBytes(octreeBytes)}</dd>
                  </>
                ) : null}
                <dt>Đang hiện</dt>
                <dd>{fmtCount(visiblePoints)}</dd>
              </dl>
            </div>
          ) : null}

          {index ? (
            <div className="pv-card pv-index">
              <h4>Danh mục ({index.items.length})</h4>
              <ul>
                {index.items.map((it, i) => (
                  <li key={`${it.path}-${i}`} className={it.supported ? '' : 'off'}>
                    <span className="pv-tag">{GROUP_LABEL[it.group] ?? it.group}</span>
                    <span className="pv-name" title={it.path}>
                      {it.label}
                    </span>
                    {it.supported ? <span className="pv-ok">mở được</span> : <span className="pv-no">chưa hỗ trợ</span>}
                  </li>
                ))}
              </ul>
              <p>
                Đây là danh mục trỏ tới đường dẫn trên máy. Bấm <b>Chọn thư mục</b> và trỏ đúng thư mục của mục point
                cloud để mở.
              </p>
            </div>
          ) : null}
        </aside>

        <div className="pv-stage" ref={stageRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <canvas ref={canvasRef} className="pv-canvas" />

          {status !== 'ready' ? (
            <div className="pv-empty">
              <div className="pv-empty-card">
                <h3>{status === 'error' ? 'Chưa mở được dữ liệu' : 'Mở dữ liệu trình chiếu'}</h3>
                {error ? <p className="pv-error">{error}</p> : null}
                {status === 'loading' ? (
                  <p className="pv-loading">Đang nạp khối điểm đầu tiên…</p>
                ) : (
                  <>
                    <p>
                      Point cloud Potree gồm 3 tệp: <code>metadata.oct</code> (hoặc <code>metadata.json</code>),{' '}
                      <code>hierarchy.bin</code>, <code>octree.bin</code>. Dữ liệu được đọc thẳng từ đĩa, không tải
                      lên mạng và không copy vào project.
                    </p>
                    <div className="pv-empty-actions">
                      <button className="pv-btn primary" onClick={() => dirInputRef.current?.click()}>
                        Chọn thư mục point cloud
                      </button>
                      <button className="pv-btn" onClick={() => indexInputRef.current?.click()}>
                        Mở dataIndex.json
                      </button>
                    </div>
                    <div className="pv-url">
                      <input
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void openUrl();
                        }}
                        placeholder="hoặc http://127.0.0.1:8765/thu-muc-cloud/"
                        spellCheck={false}
                        aria-label="Địa chỉ thư mục point cloud trên máy chủ"
                      />
                      <button className="pv-btn" onClick={() => void openUrl()}>
                        Mở URL
                      </button>
                    </div>
                    <p className="pv-note">…hoặc kéo thả 3 tệp vào khung này.</p>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="pv-foot">
        <span className={status === 'error' ? 'dot err' : status === 'ready' ? 'dot ok' : 'dot'} />
        {status === 'ready'
          ? `${fmtCount(visiblePoints)} điểm đang hiển thị`
          : status === 'loading'
            ? 'Đang nạp…'
            : status === 'error'
              ? 'Có lỗi'
              : 'Chưa mở dữ liệu'}
        <span className="grow" />
        <span className="pv-hint">
          Chuột trái: xoay · chuột phải: dịch · lăn: thu phóng · Esc: đóng
        </span>
      </footer>
    </div>
  );
}
