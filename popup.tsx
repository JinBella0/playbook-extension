import iconUrl from "data-base64:~assets/icon.png"
import { useEffect, useState } from "react"

import { DASHBOARD_URL } from "~lib/dashboard"
import type {
  ExtensionMessage,
  ExtensionResponse,
  RecordingSession,
  RecordingState
} from "~lib/types"
import { STORAGE_KEY_RECORDING_STATE, STORAGE_KEY_SESSIONS } from "~lib/types"

const DEFAULT_STATE: RecordingState = { status: "idle", steps: [] }

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message)
}

function openTab(path: string) {
  chrome.tabs.create({ url: `${DASHBOARD_URL}${path}` })
}

// 토스처럼: 큰 질문형 제목 + 회색 보조 문장 + 넉넉한 여백 + 아래 큰 버튼
const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; }
  .pb { width: 320px; padding: 20px 20px 22px; color: #191f28;
    font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    letter-spacing: -0.02em; word-break: keep-all; }
  button { font: inherit; letter-spacing: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; }

  .head { display: flex; align-items: center; justify-content: space-between; }
  .head img { width: 24px; height: 24px; border-radius: 7px; display: block; }
  .go { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 600; color: #8b95a1; }
  .go:hover { color: #4e5968; }

  .title { margin: 28px 0 0; font-size: 22px; line-height: 1.4; font-weight: 700; letter-spacing: -0.03em; }
  .title .rec { color: #f04452; }
  .desc { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: #6b7684; }

  .actions { margin-top: 32px; }
  .btn { display: flex; align-items: center; justify-content: center; width: 100%; height: 54px;
    border-radius: 16px; font-size: 17px; font-weight: 600; transition: background .15s, transform .1s; }
  .btn:active { transform: scale(0.98); }
  .btn-primary { background: #3182f6; color: #fff; }
  .btn-primary:hover { background: #1b64da; }
  .btn-danger { background: #f04452; color: #fff; }
  .btn-danger:hover { background: #d63341; }
  .btn-secondary { background: #f2f4f6; color: #4e5968; }
  .btn-secondary:hover { background: #e5e8eb; }
  .row { display: flex; gap: 8px; }
  .row .btn { flex: 1; }
  .sub { display: block; width: 100%; margin-top: 14px; font-size: 13px; color: #8b95a1; text-align: center; }
  button.sub:hover { color: #4e5968; }

  .notice { margin-top: 16px; padding: 14px 16px; border-radius: 14px; background: #f9fafb; font-size: 13px; line-height: 1.5; color: #4e5968; }
  .notice button { font-weight: 600; color: #3182f6; }
`

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

function IndexPopup() {
  const [state, setState] = useState<RecordingState>(DEFAULT_STATE)
  const [sessions, setSessions] = useState<RecordingSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    sendMessage({ type: "GET_RECORDING_STATE" }).then((response) => {
      if (response.ok && "state" in response) setState(response.state)
      setLoading(false)
    })
    sendMessage({ type: "GET_SESSIONS" }).then((response) => {
      if (response.ok && "sessions" in response) setSessions(response.sessions)
    })

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") return
      const stateChange = changes[STORAGE_KEY_RECORDING_STATE]
      if (stateChange?.newValue) setState(stateChange.newValue as RecordingState)
      const sessionsChange = changes[STORAGE_KEY_SESSIONS]
      if (sessionsChange?.newValue) setSessions(sessionsChange.newValue as RecordingSession[])
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const send = async (type: "START_RECORDING" | "STOP_RECORDING" | "DISCARD_RECORDING" | "PAUSE_RECORDING" | "RESUME_RECORDING") => {
    const response = await sendMessage({ type })
    if (response.ok && "state" in response) setState(response.state)
  }

  const handleRetryUpload = async (sessionId: string) => {
    const response = await sendMessage({ type: "RETRY_UPLOAD", sessionId })
    if (response.ok && "sessions" in response) setSessions(response.sessions)
  }

  const isPaused = state.status === "paused"
  const isActive = state.status === "recording" || isPaused
  // 마지막 녹화가 대시보드에 못 올라갔을 때만 한 줄로 알려 줍니다 (목록은 대시보드에서)
  const latest = sessions[0]

  const title = isPaused ? "녹화를 잠시 멈췄어요" : isActive ? "녹화하고 있어요" : "업무를 녹화해서\n매뉴얼로 만들어 볼까요?"
  const desc = isActive
    ? `지금까지 ${state.steps.length}단계를 저장했어요`
    : "창을 조금 줄여서 녹화하면\n화면이 더 선명하게 찍혀요"

  return (
    <div className="pb">
      <style>{STYLES}</style>

      <div className="head">
        <img src={iconUrl} alt="Playbook" />
        <button className="go" onClick={() => openTab("/")}>
          대시보드 <ChevronIcon />
        </button>
      </div>

      {!loading && (
        <>
          <h1 className="title" style={{ whiteSpace: "pre-line" }}>
            {isActive && !isPaused && <span className="rec">● </span>}
            {title}
          </h1>
          <p className="desc" style={{ whiteSpace: "pre-line" }}>{desc}</p>

          <div className="actions">
            {isActive ? (
              <>
                <div className="row">
                  <button className="btn btn-secondary" onClick={() => send(isPaused ? "RESUME_RECORDING" : "PAUSE_RECORDING")}>
                    {isPaused ? "이어서 녹화" : "잠시 멈춤"}
                  </button>
                  <button className="btn btn-danger" onClick={() => send("STOP_RECORDING")}>
                    녹화 완료
                  </button>
                </div>
                <button className="sub" onClick={() => send("DISCARD_RECORDING")}>
                  저장하지 않고 취소
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => send("START_RECORDING")}>
                  녹화 시작
                </button>
                <span className="sub">Ctrl + Shift + E 로도 시작할 수 있어요</span>
              </>
            )}
          </div>

          {!isActive && latest?.uploadStatus === "failed" && (
            <div className="notice">
              마지막 녹화를 대시보드에 올리지 못했어요.{" "}
              <button onClick={() => handleRetryUpload(latest.id)}>다시 시도</button>
            </div>
          )}
          {!isActive && latest?.uploadStatus === "unauthorized" && (
            <div className="notice">
              로그인하면 마지막 녹화가 대시보드에 올라가요.{" "}
              <button onClick={() => openTab("/login")}>로그인</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default IndexPopup
