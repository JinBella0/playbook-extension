// 클릭된 DOM 요소로부터 안정적인 CSS Selector를 생성하는 유틸리티

export function buildSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`
  }

  const path: string[] = []
  let current: Element | null = el

  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 6) {
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`)
      break
    }

    let segment = current.tagName.toLowerCase()

    const classNames = Array.from(current.classList)
      .filter((c) => c.length > 0)
      .slice(0, 2)
    if (classNames.length > 0) {
      segment += "." + classNames.map((c) => CSS.escape(c)).join(".")
    }

    const parent: Element | null = current.parentElement
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === current!.tagName
      )
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1
        segment += `:nth-of-type(${index})`
      }
    }

    path.unshift(segment)
    current = parent
  }

  return path.join(" > ")
}

export function getElementText(el: Element): string {
  const text = (el as HTMLElement).innerText ?? el.textContent ?? ""
  return text.trim().replace(/\s+/g, " ").slice(0, 100)
}
