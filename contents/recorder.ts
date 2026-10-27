import type { PlasmoCSConfig } from "plasmo"

import { buildSelector, getElementText } from "~lib/selector"
import type {
  Coordinates,
  ElementInfo,
  ExtensionMessage,
  RecordingState,
  StepCapturePayload
} from "~lib/types"
import { STORAGE_KEY_RECORDING_STATE } from "~lib/types"

// all_frames: false - 최상위 프레임에서만 동작합니다.
// iframe 내부에서 캡처하면 그 iframe의 좁은 window.innerWidth/innerHeight를
// "전체 화면 크기"로 잘못 기록하게 되어(실제 스크린샷은 항상 탭 전체이므로),
// 하이라이트 비율이 어긋나 이미지가 확대/왜곡되어 보이는 문제가 생깁니다.
// document_start: 페이지 스크립트보다 먼저 이벤트 리스너를 걸어야, 시연 페이지가 Tab 키를
// window에서 가로채(stopImmediatePropagation) 막아도 녹화가 먼저 받을 수 있습니다.
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
  run_at: "document_start"
}

let isRecording = false

// background에서 관리하는 녹화 상태를 storage 변경 이벤트로 동기화
chrome.storage.local.get(STORAGE_KEY_RECORDING_STATE).then((result) => {
  const state = result[STORAGE_KEY_RECORDING_STATE] as RecordingState | undefined
  isRecording = state?.status === "recording"
})

const MAX_SCREEN_TEXT_LENGTH = 1500

// 직전 단계 때 화면에 있던 글자 줄. 단계마다 "새로 나타난 줄"만 골라 시연이 그 단계에서 보여준 내용을 남깁니다
// (Tab으로 넘기는 시연은 클릭한 요소 글자가 없어서, 이것이 없으면 AI가 "Tab을 누릅니다"밖에 쓸 수 없습니다)
let previousScreenLines = new Set<string>()

/** 화면 글자 + 입력칸에 써진 글자 (시연이 질문을 입력칸에 타이핑하는 단계도 잡히도록. innerText에는 입력칸 값이 없음) */
function readScreenLines(): string[] {
  const text = document.body?.innerText ?? ""
  const inputValues = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input"))
    .filter((element) => !(element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type)))
    .map((element) => element.value)
  return [text, ...inputValues]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
}

function takeNewScreenText(): string {
  const lines = readScreenLines()
  const newLines = lines.filter((line) => !previousScreenLines.has(line))
  previousScreenLines = new Set(lines)
  return [...new Set(newLines)].join("\n").slice(0, MAX_SCREEN_TEXT_LENGTH)
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return
  const recordingChange = changes[STORAGE_KEY_RECORDING_STATE]
  if (recordingChange) {
    const newState = recordingChange.newValue as RecordingState | undefined
    const wasRecording = isRecording
    isRecording = newState?.status === "recording"
    // 녹화 시작 시점의 화면을 기준으로 삼아, 첫 단계에 원래 있던 글자가 몽땅 "새 글자"로 잡히지 않게 합니다
    if (isRecording && !wasRecording && newState?.steps.length === 0) {
      previousScreenLines = new Set(readScreenLines())
    }
  }
})

function buildCoordinates(
  clientX: number,
  clientY: number,
  targetRect?: DOMRect
): Coordinates {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const coordinates: Coordinates = {
    x: clientX,
    y: clientY,
    viewportWidth,
    viewportHeight,
    xRatio: viewportWidth > 0 ? clientX / viewportWidth : 0,
    yRatio: viewportHeight > 0 ? clientY / viewportHeight : 0
  }

  // 요소 크기가 과도하게 크면(예: 전체 페이지 컨테이너) 사각형 하이라이트가 의미 없으므로 제외
  if (
    targetRect &&
    targetRect.width > 0 &&
    targetRect.height > 0 &&
    targetRect.width < viewportWidth * 0.6 &&
    targetRect.height < viewportHeight * 0.4
  ) {
    coordinates.box = {
      xRatio: targetRect.left / viewportWidth,
      yRatio: targetRect.top / viewportHeight,
      widthRatio: targetRect.width / viewportWidth,
      heightRatio: targetRect.height / viewportHeight
    }
  }

  return coordinates
}

function buildElementInfo(target: Element, extra?: Partial<ElementInfo>): ElementInfo {
  const htmlTarget = target as HTMLInputElement & HTMLTextAreaElement

  return {
    tagName: target.tagName,
    text: getElementText(target),
    placeholder: htmlTarget.placeholder ?? "",
    ariaLabel: target.getAttribute("aria-label") ?? "",
    selector: buildSelector(target),
    ...extra
  }
}

function sendCaptureStep(payload: StepCapturePayload) {
  const message: ExtensionMessage = {
    type: "CAPTURE_STEP",
    payload: { ...payload, screenText: takeNewScreenText() }
  }
  chrome.runtime.sendMessage(message).catch((error) => {
    console.error("[playbook] 이벤트 전송 실패:", error)
  })
}

function handleClick(event: MouseEvent) {
  if (!isRecording) return

  const target = event.target as Element | null
  if (!target) return

  sendCaptureStep({
    type: "click",
    timestamp: Date.now(),
    url: window.location.href,
    pageTitle: document.title,
    coordinates: buildCoordinates(event.clientX, event.clientY, target.getBoundingClientRect()),
    element: buildElementInfo(target)
  })
}

function handleChange(event: Event) {
  if (!isRecording) return

  const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  if (!target) return

  const rect = target.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  // 비밀번호 입력값은 매뉴얼에 노출되지 않도록 마스킹
  const isSensitive =
    target instanceof HTMLInputElement && target.type === "password"
  const inputValue = isSensitive ? "••••••" : (target as HTMLInputElement).value ?? ""

  sendCaptureStep({
    type: "change",
    timestamp: Date.now(),
    url: window.location.href,
    pageTitle: document.title,
    coordinates: buildCoordinates(centerX, centerY, rect),
    element: buildElementInfo(target, { inputValue })
  })
}

/** 입력칸 안에서 누른 Tab은 칸 이동이라 단계로 보지 않습니다 */
function isEditableElement(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

function handleKeydown(event: KeyboardEvent) {
  if (!isRecording || event.repeat) return

  const target = event.target as Element | null
  if (!target) return

  // 에이전틱OS 시연 모드는 Tab으로 다음 장면으로 넘어갑니다. 입력칸 안의 Tab은 칸 이동이라 단계로 보지 않습니다
  const isStepTab = event.key === "Tab" && !isEditableElement(target)
  if (event.key !== "Enter" && !isStepTab) return

  const rect = target.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  sendCaptureStep({
    type: "keydown",
    timestamp: Date.now(),
    url: window.location.href,
    pageTitle: document.title,
    coordinates: buildCoordinates(centerX, centerY, rect),
    element: buildElementInfo(target, { keyPressed: event.key })
  })
}

function handleContextMenu(event: MouseEvent) {
  if (!isRecording) return

  const target = event.target as Element | null
  if (!target) return

  sendCaptureStep({
    type: "contextmenu",
    timestamp: Date.now(),
    url: window.location.href,
    pageTitle: document.title,
    coordinates: buildCoordinates(event.clientX, event.clientY, target.getBoundingClientRect()),
    element: buildElementInfo(target)
  })
}

// dragstart에서 기록해둔 원본 요소를 drop 시점에 함께 전송합니다
let dragSourceElement: Element | null = null

function handleDragStart(event: DragEvent) {
  if (!isRecording) return
  dragSourceElement = event.target as Element | null
}

function handleDrop(event: DragEvent) {
  if (!isRecording || !dragSourceElement) return

  const target = event.target as Element | null
  if (!target) {
    dragSourceElement = null
    return
  }

  const rect = target.getBoundingClientRect()

  sendCaptureStep({
    type: "dragdrop",
    timestamp: Date.now(),
    url: window.location.href,
    pageTitle: document.title,
    coordinates: buildCoordinates(event.clientX, event.clientY, rect),
    element: buildElementInfo(target, { dragSourceText: getElementText(dragSourceElement) })
  })

  dragSourceElement = null
}

document.addEventListener("click", handleClick, { capture: true })
document.addEventListener("change", handleChange, { capture: true })
// 시연 페이지가 키 입력을 먼저 가로채도(stopPropagation) 놓치지 않도록 가장 바깥(window)에서 받습니다
window.addEventListener("keydown", handleKeydown, { capture: true })
document.addEventListener("contextmenu", handleContextMenu, { capture: true })
document.addEventListener("dragstart", handleDragStart, { capture: true })
document.addEventListener("drop", handleDrop, { capture: true })
