// Plasmo가 빌드 때 그림 파일을 data URL 글자로 바꿔 넣는 가져오기 (popup의 로고)
declare module "data-base64:*" {
  const value: string
  export default value
}
