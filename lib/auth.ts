const DASHBOARD_URL = process.env.PLASMO_PUBLIC_DASHBOARD_URL || "http://localhost:3000"

/** @supabase/ssr가 청크로 쪼갠 쿠키(name, name.0, name.1, ...)를 원래 순서대로 이어붙입니다 */
function combineChunkedValue(cookies: chrome.cookies.Cookie[], baseName: string): string | null {
  const exact = cookies.find((c) => c.name === baseName)
  if (exact) return exact.value

  const chunks = cookies
    .filter((c) => c.name.startsWith(`${baseName}.`))
    .map((c) => ({ index: Number(c.name.slice(baseName.length + 1)), value: c.value }))
    .filter((c) => Number.isInteger(c.index))
    .sort((a, b) => a.index - b.index)

  if (chunks.length === 0) return null
  return chunks.map((c) => c.value).join("")
}

/**
 * 브라우저 쿠키 정책(SameSite/서드파티 쿠키 차단)과 무관하게 동작하는
 * chrome.cookies API로 대시보드 로그인 세션의 access_token을 직접 읽어옵니다.
 * (background script의 fetch(credentials:"include")는 확장 프로그램 요청에 쿠키가 실리지 않아 사용 불가)
 */
export async function getDashboardAccessToken(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ url: DASHBOARD_URL })
    console.log(
      `[playbook] ${DASHBOARD_URL}에서 쿠키 ${cookies.length}개 발견:`,
      cookies.map((c) => c.name)
    )
    const authTokenCookie = cookies.find(
      (c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && !c.name.includes("code-verifier")
    )
    if (!authTokenCookie) {
      console.warn("[playbook] auth-token 쿠키를 못 찾음 (로그인 안 되어있거나 다른 프로필)")
      return null
    }

    const baseName = authTokenCookie.name.replace(/\.\d+$/, "")
    const raw = combineChunkedValue(cookies, baseName)
    if (!raw) return null

    const json = raw.startsWith("base64-") ? atob(raw.slice("base64-".length)) : raw
    const session = JSON.parse(json)
    return typeof session.access_token === "string" ? session.access_token : null
  } catch (error) {
    console.error("[playbook] 로그인 토큰 읽기 실패:", error)
    return null
  }
}
