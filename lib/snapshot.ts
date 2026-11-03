/**
 * 에이전틱OS 시연 화면을 "화면 틀"로 쓰기 위해 단계마다 페이지를 그대로 저장합니다.
 * 대시보드는 단계별 HTML을 iframe에 다시 그린 뒤 글자만 Use Case에 맞게 바꿔 이미지로 찍습니다.
 *
 * - 복제는 단계가 찍히는 순간 바로(동기로) 해서, 시연이 다음 장면으로 넘어가기 전 화면을 남깁니다.
 * - 스크립트는 빼고, CSS와 이미지는 "자산"으로 따로 모아 단계마다 같은 것을 반복 저장하지 않습니다.
 *   HTML 안에는 자리표시(playbook-asset:키)만 남기고, 대시보드가 다시 그릴 때 채웁니다.
 * - 스크롤 위치는 복제하면 사라지므로 data-playbook-scroll 속성으로 남깁니다.
 */

export const ASSET_PREFIX = "playbook-asset:"

export interface PageSnapshot {
  html: string
  /** 키 -> CSS 글자 또는 이미지 dataURL */
  assets: Record<string, string>
}

/** 에이전틱OS 화면인지 (다른 사이트 녹화는 매뉴얼만 만들고 화면을 저장하지 않음) */
export function isAgenticOsPage(): boolean {
  return document.title.includes("Agentic OS")
}

/** 너무 큰 이미지는 dataURL로 넣지 않습니다 (저장 크기 제한) */
const MAX_INLINE_IMAGE_BYTES = 300_000

/** 같은 내용이면 같은 키가 되도록 하는 짧은 해시 */
function hashKey(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`
}

const imageCache = new Map<string, string | null>()

async function toDataUrl(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url) ?? null
  let result: string | null = null
  try {
    const response = await fetch(url, { credentials: "include" })
    const blob = response.ok ? await response.blob() : null
    if (blob && blob.size <= MAX_INLINE_IMAGE_BYTES) {
      result = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    }
  } catch {
    result = null
  }
  imageCache.set(url, result)
  return result
}

/** CSS 안의 url(...)을 그 CSS 파일 기준 절대 주소로 바꿉니다 */
function absolutizeCssUrls(css: string, baseUrl: string): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote: string, url: string) => {
    if (/^(data:|https?:|#)/.test(url)) return match
    try {
      return `url(${quote}${new URL(url, baseUrl).href}${quote})`
    } catch {
      return match
    }
  })
}

/** 읽을 수 있는 스타일시트는 CSS 글자로, 다른 출처라 못 읽는 것은 절대 주소 link로 둡니다 */
function collectStyles(): { css: string[]; links: string[] } {
  const css: string[] = []
  const links: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode
    if (owner instanceof Element && owner.closest("plasmo-csui")) continue
    try {
      const text = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n")
      css.push(absolutizeCssUrls(text, sheet.href ?? location.href))
    } catch {
      if (sheet.href) links.push(sheet.href)
    }
  }
  return { css, links }
}

/**
 * 지금 화면을 바로 복제합니다 (단계를 찍는 순간 동기로 불러야 다음 장면으로 넘어가기 전 화면이 남음).
 * 무거운 정리(이미지 받기 등)는 finishSnapshot에서 합니다
 */
export function cloneCurrentPage(): HTMLElement {
  const clone = document.documentElement.cloneNode(true) as HTMLElement
  const originals = Array.from(document.documentElement.querySelectorAll("*"))
  const copies = Array.from(clone.querySelectorAll("*"))
  originals.forEach((original, index) => {
    const copy = copies[index]
    if (!copy) return
    if (original.scrollTop > 0 || original.scrollLeft > 0) {
      copy.setAttribute("data-playbook-scroll", `${original.scrollTop},${original.scrollLeft}`)
    }
    // 입력칸 값은 HTML 속성에 없어 복제하면 사라지므로 속성으로 옮겨 둡니다
    if (original instanceof HTMLTextAreaElement) copy.textContent = original.value
    else if (original instanceof HTMLInputElement) copy.setAttribute("value", original.value)
  })
  return clone
}

/** 복제한 화면을 혼자 그려지는 HTML + 자산으로 정리합니다 */
export async function finishSnapshot(clone: HTMLElement): Promise<PageSnapshot> {
  const assets: Record<string, string> = {}
  const addAsset = (value: string) => {
    const key = hashKey(value)
    assets[key] = value
    return `${ASSET_PREFIX}${key}`
  }

  clone
    .querySelectorAll(
      "script, noscript, iframe, plasmo-csui, link[rel='stylesheet'], style, link[rel='preload'], link[rel='modulepreload'], link[rel='prefetch']"
    )
    .forEach((node) => node.remove())

  await Promise.all(
    Array.from(clone.querySelectorAll("img")).map(async (image) => {
      image.removeAttribute("srcset")
      image.removeAttribute("loading")
      const src = image.getAttribute("src")
      if (!src) return
      if (src.startsWith("data:")) {
        image.setAttribute("src", addAsset(src))
        return
      }
      const absolute = new URL(src, location.href).href
      const dataUrl = await toDataUrl(absolute)
      image.setAttribute("src", dataUrl ? addAsset(dataUrl) : absolute)
    })
  )
  clone.querySelectorAll("[href]").forEach((node) => {
    const href = node.getAttribute("href")
    if (href && !/^(data:|https?:|#|mailto:)/.test(href)) node.setAttribute("href", new URL(href, location.href).href)
  })

  const { css, links } = collectStyles()
  const head = clone.querySelector("head")
  head?.insertAdjacentHTML(
    "beforeend",
    [
      ...links.map((href) => `<link rel="stylesheet" crossorigin="anonymous" href="${href}">`),
      ...css.map((text) => `<link rel="stylesheet" href="${addAsset(text)}">`)
    ].join("\n")
  )
  return { html: `<!DOCTYPE html>\n${clone.outerHTML}`, assets }
}
