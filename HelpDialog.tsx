import Modal from './Modal';

interface HelpDialogProps {
  onClose: () => void;
}

export default function HelpDialog({ onClose }: HelpDialogProps) {
  return (
    <Modal title="Hướng dẫn sử dụng" onClose={onClose} wide>
      <div className="help">
        <h4>1. Tạo công trình</h4>
        <p>
          Bấm <span className="kbd">+ Công trình</span>, đặt tên và chọn tỉnh/thành. Kinh tuyến trục (KTT) được điền tự
          động theo Thông tư 25/2014. Tỉnh đã sáp nhập có thể có nhiều khu vực KTT — chọn đúng khu vực của công trình.
        </p>

        <h4>2. Đưa điểm vào</h4>
        <ol>
          <li>
            <b>Nhập tệp:</b> <span className="kbd">Nhập dữ liệu</span> → chọn CSV/TXT/GeoJSON/KML xuất từ sổ đo trên điện
            thoại, máy toàn đạc hoặc phần mềm khác.
          </li>
          <li>
            <b>Nhập tay:</b> <span className="kbd">+ Thêm điểm</span> → gõ X, Y hoặc B, L; hệ còn lại tự tính.
          </li>
          <li>
            <b>GPS trình duyệt:</b> trong hộp thoại thêm điểm bấm “Lấy vị trí GPS hiện tại”. Sai số vài mét — chỉ dùng để
            tham khảo, không dùng để nghiệm thu.
          </li>
        </ol>

        <h4>3. Bản đồ</h4>
        <ul>
          <li>Điểm được gom thành cụm khi thu nhỏ; bấm vào cụm để phóng to.</li>
          <li>Bấm vào điểm để xem nhanh X, Y, H, sai số. Tick ô trong danh sách để chọn nhiều điểm.</li>
          <li>
            Nút <span className="kbd">📐</span> bật chế độ đo: chạm để đặt đỉnh, từ 3 đỉnh sẽ có diện tích và chu vi tính
            trên hệ VN-2000. Bấm “Lưu thành điểm” nếu muốn đưa các đỉnh vào sổ đo.
          </li>
          <li>
            Nút <span className="kbd">◎</span> hiện vị trí hiện tại kèm vòng tròn sai số (GPS của máy tính/điện thoại).
          </li>
        </ul>

        <h4>4. Công cụ</h4>
        <p>
          <span className="kbd">Công cụ</span> gồm bài toán nghịch, thuận, giao hội góc, giao hội cạnh, tính diện tích và
          chuyển đổi B/L ⇄ X/Y. Kết quả có thể lưu thẳng thành điểm.
        </p>

        <h4>5. Xuất dữ liệu</h4>
        <ul>
          <li>
            <b>CSV</b> có BOM — mở bằng Excel không lỗi dấu. <b>TXT</b> dạng Tên X Y H Mã cho máy toàn đạc. <b>DXF</b> đơn
            vị mét, lớp DIEM/TEN. <b>KML</b> mở bằng Google Earth. <b>GeoJSON</b> cho QGIS/Web GIS.
          </li>
          <li>
            <b>Sao lưu JSON</b> chứa toàn bộ điểm kèm hệ tọa độ — dùng để chuyển máy hoặc khôi phục. Hãy sao lưu cuối mỗi
            buổi làm việc.
          </li>
        </ul>

        <h4>6. Những điều cần biết</h4>
        <ul>
          <li>
            Dữ liệu lưu trong trình duyệt (IndexedDB) trên <b>chính máy này</b>. Xóa dữ liệu trình duyệt là mất sạch —
            hãy xuất sao lưu định kỳ.
          </li>
          <li>
            <b>Chưa phải RTK thật:</b> muốn centimet cần máy thu GNSS ngoài + NTRIP. GPS của điện thoại/máy tính chỉ đạt
            vài mét.
          </li>
          <li>
            <b>h elipsoid ≠ H VN-2000:</b> chênh lệch do geoid là hàng mét, không được dùng để tính đào/đắp.
          </li>
          <li>
            Bộ 7 tham số quốc gia cho sai số dưới mét so với tọa độ chính thức của tỉnh. Với công trình cần độ chính xác
            cao, hiệu chuẩn theo mốc địa phương hoặc trạm base.
          </li>
          <li>
            Ảnh nền vệ tinh Esri và OpenStreetMap dùng cho nội bộ/thử nghiệm. Khi phát hành rộng rãi cần nhà cung cấp có
            hợp đồng.
          </li>
        </ul>
      </div>
    </Modal>
  );
}
