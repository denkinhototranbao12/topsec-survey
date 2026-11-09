// Máy chủ tĩnh tối giản có hỗ trợ HTTP Range – dùng để thử trình chiếu point cloud
// từ đĩa mà không phải copy dữ liệu vào project.
//   node scripts/serve-pointcloud.mjs "<thư mục point cloud>" [cổng]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8765);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  // potree-core gửi kèm Range và content-type nên preflight phải cho phép cả hai.
  'Access-Control-Allow-Headers': 'range, content-type',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  'Accept-Ranges': 'bytes',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = urlPath.replace(/^\/+/, '');
  let file = path.join(root, rel);
  if (!path.resolve(file).startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  // potree-core luôn hỏi metadata.json; dữ liệu XGrids đặt tên metadata.oct.
  if (path.basename(file) === 'metadata.json' && !fs.existsSync(file)) {
    file = path.join(path.dirname(file), 'metadata.oct');
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, CORS);
    res.end('not found');
    return;
  }

  const headers = { ...CORS, 'Content-Type': 'application/octet-stream' };

  // Thử nghiệm: một số bộ dữ liệu XGrids/Potree 2.1 bị lệch gốc dời (offset) khi giải mã.
  if (process.env.ZERO_OFFSET && /^metadata\.(json|oct)$/i.test(path.basename(file))) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.offset = [0, 0, 0];
    const body = Buffer.from(JSON.stringify(json));
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
    return;
  }

  const range = req.headers.range;
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});
