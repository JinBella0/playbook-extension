// 대시보드 주소. 배포 빌드는 .env의 PLASMO_PUBLIC_DASHBOARD_URL, 없으면 로컬 개발 대시보드를 씁니다
export const DASHBOARD_URL = process.env.PLASMO_PUBLIC_DASHBOARD_URL || "http://localhost:3000"
