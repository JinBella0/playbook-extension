import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState } from "react"

import type { ExtensionMessage, ExtensionResponse, RecordingState } from "~lib/types"
import { STORAGE_KEY_RECORDING_STATE } from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
  run_at: "document_idle"
}

// Shadow DOM 안에서 사용할 스타일 (호스트 페이지 CSS와 충돌하지 않도록 격리됨)
export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = `
    * { box-sizing: border-box; font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; }
  `
  return style
}

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message)
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function ControlBar() {
  const [state, setState] = useState<RecordingState>({ status: "idle", steps: [] })
  const [now, setNow] = useState(() => Date.now())
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY_RECORDING_STATE).then((result) => {
      const initial = result[STORAGE_KEY_RECORDING_STATE] as RecordingState | undefined
      if (initial) setState(initial)
    })

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") return
      const change = changes[STORAGE_KEY_RECORDING_STATE]
      if (change?.newValue) setState(change.newValue as RecordingState)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  useEffect(() => {
    if (state.status !== "recording") return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state.status])

  // 캡처하는 순간에는 컨트롤 바를 숨깁니다 (background.ts captureWithoutControlBar).
  // React 렌더를 기다리지 않도록 DOM에 바로 적용하고, 화면이 다시 그려진 뒤에 응답합니다
  useEffect(() => {
    const listener = (message: ExtensionMessage, _sender: unknown, sendResponse: (ok: boolean) => void) => {
      if (message.type !== "SET_CONTROL_BAR_HIDDEN") return
      if (barRef.current) barRef.current.style.visibility = message.hidden ? "hidden" : "visible"
      requestAnimationFrame(() => requestAnimationFrame(() => sendResponse(true)))
      return true
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  if (state.status !== "recording" && state.status !== "paused") return null

  const isPaused = state.status === "paused"
  const elapsed = state.startedAt ? now - state.startedAt : 0

  const handleStop = async () => {
    await sendMessage({ type: "STOP_RECORDING" })
  }

  const handleTogglePause = async () => {
    await sendMessage({ type: isPaused ? "RESUME_RECORDING" : "PAUSE_RECORDING" })
  }

  return (
    <div
      ref={barRef}
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "#1e293b",
        color: "#fff",
        borderRadius: 999,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        fontSize: 13,
        opacity: isPaused ? 0.85 : 1
      }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: isPaused ? "#a1a1aa" : "#e11d48",
          display: "inline-block"
        }}
      />
      <span>{isPaused ? "일시정지됨" : "녹화 중"}</span>
      <span style={{ opacity: 0.8 }}>{formatElapsed(elapsed)}</span>
      <span style={{ opacity: 0.8 }}>{state.steps.length} 단계 캡처됨</span>
      <button
        onClick={handleTogglePause}
        style={{
          background: "transparent",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer"
        }}>
        {isPaused ? "재개" : "일시정지"}
      </button>
      <button
        onClick={handleStop}
        style={{
          background: "#e11d48",
          color: "#fff",
          border: "none",
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer"
        }}>
        녹화 완료
      </button>
    </div>
  )
}

export default ControlBar
