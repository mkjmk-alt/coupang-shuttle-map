# 쿠팡 셔틀버스 노선 지도 웹페이지

쿠팡 셔틀버스 노선을 네이버 지도를 통해 한눈에 확인할 수 있는 웹 어플리케이션입니다.

## 🚀 시작하기

1. **네이버 지도 API 키 설정**:
   - `index.html` 파일을 열고 `<script ... ncpClientId=YOUR_CLIENT_ID>` 부분의 `YOUR_CLIENT_ID`를 본인의 네이버 클라우드 플랫폼 Client ID로 교체하세요.
   - 네이버 클라우드 플랫폼 설정에서 `http://localhost` 또는 사용하는 도메인을 서비스 URL에 등록해야 합니다.

2. **로컬 서버 실행**:
   - 이 디렉터리에서 `python -m http.server 8000` 명령어를 실행합니다.
   - 브라우저에서 `http://localhost:8000`에 접속합니다.

3. **데이터 업데이트**:
   - `CoupangShuttleTool` 폴더의 Excel 데이터가 변경된 경우, `python convert_data.py`를 실행하여 `data/shuttle_data.json`을 업데이트할 수 있습니다.

## ✨ 주요 기능

- **센터별 검색**: 수십 개의 쿠팡 센터 데이터를 선택 가능
- **근무조/노선 선택**: 주간/오후/심야 등 근무조에 따른 노선 필터링
- **다이나믹 맵**: 정류장 위치 표시 및 노선 경로 시각화 (Polyline)
- **정보창**: 정류장 이름, 도착 시간, 상세 주소 확인
- **프리미엄 UI**: 사이드바를 통한 직관적인 노선 리스트 제공

## 📁 파일 구조

- `index.html`: 메인 페이지 구조
- `style.css`: 현대적이고 세련된 스타일링
- `app.js`: 지도 로직 및 인터랙션 구현
- `convert_data.py`: Excel 데이터를 JSON으로 변환하는 유틸리티
- `data/shuttle_data.json`: 변환된 셔틀 데이터
