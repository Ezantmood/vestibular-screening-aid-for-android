# Vestibular Screening Aid

Ứng dụng Android hỗ trợ ghi nhận vận động mắt, quản lý hồ sơ và xuất báo cáo tại
thiết bị. React Native + TypeScript + Expo SDK 57, với các module Kotlin Camera2,
giải mã video và nhận diện đồng tử. Thiết bị kiểm chứng: Redmi Note 13 Pro 5G.

Đây là nguyên mẫu đang kiểm chứng kỹ thuật. Hiệu chỉnh và các chỉ số vận động mắt
chưa được xác nhận độ chính xác lâm sàng; ứng dụng không đưa ra chẩn đoán.

## Tải và cập nhật

**[Bản kiểm thử 0.2.9 beta](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases/tag/v0.2.9-beta.1)** ·
[Toàn bộ Releases](https://github.com/Ezantmood/vestibular-screening-aid-for-android/releases)

APK, mã kiểm tra SHA-256, thay đổi từng phiên bản và kết quả kiểm tra nằm trong
**Releases**. README và `docs/` giữ hướng dẫn phát triển cùng các hợp đồng kỹ thuật.

| File trong Release                     | Mục đích                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `vestibular-clinic.apk`                | Ứng dụng chính: tài khoản, hồ sơ, bài đo và báo cáo; có INTERNET cho đăng nhập |
| `vestibular.apk`                       | Công cụ kiểm thử Batch 3 độc lập, không cần tài khoản hay mạng                 |
| `SHA256SUMS` / `release-manifest.json` | Đối chiếu file tải, phiên bản và source commit                                 |

Hai APK dùng cùng package Android và là hai cách chạy thay thế. Chủ thiết bị cài
bản phù hợp; các lệnh build trong dự án không cài hay mở ứng dụng trên điện thoại.

## Phát triển trên máy

Node.js 25, Android SDK 36, JDK 21. Cấu hình Firebase theo `.env.example` khi dùng
luồng tài khoản. Expo Go không nạp được các module Camera2 của dự án.

```bash
npm install
npm run check
npm test
npm run format
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home npm run build:clinic
```

| Lệnh                                       | Công việc                                            |
| ------------------------------------------ | ---------------------------------------------------- |
| `npm start`                                | Metro LAN + QR cho Development Build do chủ máy mở   |
| `npm run build:dev`                        | Tạo Development APK                                  |
| `npm run build:clinic`                     | Tạo APK ứng dụng chính                               |
| `npm run build:batch3`                     | Tạo APK kiểm thử độc lập                             |
| `npm run check`                            | TypeScript + ESLint                                  |
| `npm test`                                 | Kiểm thử logic và mô phỏng                           |
| `npm run format`                           | Kiểm tra Prettier                                    |
| `npm run release:prepare -- v0.2.9-beta.1` | Chuẩn bị APK/checksum/manifest từ source commit sạch |

[Development Build và Metro](docs/DEVELOPMENT_BUILD.md) ·
[Kiểm chứng calibration và hai bài mắt](docs/BATCH3_VALIDATION.md) ·
[Quy trình Releases](docs/RELEASING.md)

## Mã nguồn và tài liệu

`src/ui/` chứa giao diện; `src/camera/` là ranh giới với native;
`src/eyetracking/` chứa nhận diện, tracking và calibration; `src/signals/` xử lý
dòng thời gian; `src/tests/` chứa stimulus và metric; `src/clinic/`, `src/patients/`,
`src/auth/`, `src/storage/` phục vụ luồng tài khoản và hồ sơ tại thiết bị.
`modules/` chứa các module Android Kotlin.

- [Trạng thái hiện tại](docs/STATUS.md) · [Roadmap](docs/ROADMAP.md)
- [Calibration và tín hiệu](docs/CALIBRATION_SIGNALS.md) · [Các bài mắt](docs/EYE_TESTS.md)
- [Kiến trúc](docs/ARCHITECTURE.md) · [Quyết định thiết kế](docs/DECISIONS.md)
- [Phạm vi dự án](docs/PROJECT_SPEC.md) · [Quy tắc đóng góp](AGENTS.md)
