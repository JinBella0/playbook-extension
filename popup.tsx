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

function describeStep(step: RecordingSession["steps"][number]): string {
  const label =
    step.element.text || step.element.placeholder || step.element.ariaLabel || step.element.tagName

  switch (step.type) {
    case "click":
      return `클릭: ${label}`
    case "change":
      return `입력(${label}): ${step.element.inputValue ?? ""}`
    case "keydown":
      return `${step.element.keyPressed ?? "Enter"}: ${label}`
    case "contextmenu":
      return `우클릭: ${label}`
    case "dragdrop":
      return `드래그: ${step.element.dragSourceText ?? "?"} → ${label}`
    case "tabswitch":
      return `탭 이동: ${label}`
    default:
      return label
  }
}

/** 에이전틱OS 시연을 녹화해 "시연 서랍"에 넣어 두면, 대시보드 Use Case 페이지가 고객에 맞는 시연으로 PPT를 만듭니다 */
function UsecaseLink() {
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>고객 맞춤 Use Case</p>
      <p style={{ fontSize: 11, color: "#666", margin: "0 0 8px", lineHeight: 1.5 }}>
        에이전틱OS 시연을 녹화한 뒤 매뉴얼 페이지에서 [시연 서랍에 넣기]를 눌러 두면, Use Case 정리본만으로 PPT를 만들 수 있어요.
      </p>
      <button
        onClick={() => chrome.tabs.create({ url: `${DASHBOARD_URL}/usecase` })}
        style={{
          width: "100%",
          padding: "8px 0",
          background: "transparent",
          color: "#334155",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          fontSize: 13,
          cursor: "pointer"
        }}>
        Use Case 만들기
      </button>
    </div>
  )
}

function IndexPopup() {
  const [state, setState] = useState<RecordingState>(DEFAULT_STATE)
  const [sessions, setSessions] = useState<RecordingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refreshSessions = async () => {
    const response = await sendMessage({ type: "GET_SESSIONS" })
    if (response.ok && "sessions" in response) setSessions(response.sessions)
  }

  useEffect(() => {
    sendMessage({ type: "GET_RECORDING_STATE" }).then((response) => {
      if (response.ok && "state" in response) setState(response.state)
      setLoading(false)
    })
    refreshSessions()

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

  const handleStart = async () => {
    const response = await sendMessage({ type: "START_RECORDING" })
    if (response.ok && "state" in response) setState(response.state)
  }

  const handleStop = async () => {
    const response = await sendMessage({ type: "STOP_RECORDING" })
    if (response.ok && "state" in response) setState(response.state)
    refreshSessions()
  }

  const handleDiscard = async () => {
    const response = await sendMessage({ type: "DISCARD_RECORDING" })
    if (response.ok && "state" in response) setState(response.state)
  }

  const handleTogglePause = async () => {
    const response = await sendMessage({
      type: state.status === "paused" ? "RESUME_RECORDING" : "PAUSE_RECORDING"
    })
    if (response.ok && "state" in response) setState(response.state)
  }

  const handleDeleteSession = async (sessionId: string) => {
    const response = await sendMessage({ type: "DELETE_SESSION", sessionId })
    if (response.ok && "sessions" in response) setSessions(response.sessions)
  }

  const handleCopySteps = async (session: RecordingSession) => {
    await navigator.clipboard.writeText(JSON.stringify(session.steps, null, 2))
    setCopiedId(session.id)
    setTimeout(() => setCopiedId((current) => (current === session.id ? null : current)), 1500)
  }

  const handleRetryUpload = async (sessionId: string) => {
    const response = await sendMessage({ type: "RETRY_UPLOAD", sessionId })
    if (response.ok && "sessions" in response) setSessions(response.sessions)
  }

  const handleOpenDashboard = (dashboardId: string) => {
    chrome.tabs.create({ url: `${DASHBOARD_URL}/manual/${dashboardId}` })
  }

  const handleOpenLogin = () => {
    chrome.tabs.create({ url: `${DASHBOARD_URL}/login` })
  }

  const isPaused = state.status === "paused"
  const isActive = state.status === "recording" || isPaused

  return (
    <div
      style={{
        width: 300,
        padding: 16,
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif"
      }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Playbook 자동 매뉴얼 생성기</h2>
      <p style={{ fontSize: 12, color: "#666", margin: "0 0 16px" }}>
        녹화를 시작하면 클릭/입력 동작이 자동으로 캡처됩니다. 단축키 Ctrl+Shift+E로 시작/종료할 수 있어요.
      </p>

      {!loading && !isActive && (
        <p
          style={{
            fontSize: 11,
            color: "#92400e",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 6,
            padding: "8px 10px",
            margin: "0 0 12px",
            lineHeight: 1.4
          }}>
          💡 팁: 브라우저 창을 전체화면보다 조금 작게 줄여서 녹화하면, 버튼/글자가 화면에서 더 크게
          잡혀서 스크린샷이 훨씬 선명하게 나와요.
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: 13 }}>불러오는 중...</p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12
            }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: isPaused ? "#a1a1aa" : isActive ? "#e11d48" : "#94a3b8",
                display: "inline-block"
              }}
            />
            <span style={{ fontSize: 13 }}>
              {isPaused ? "일시정지됨" : isActive ? "녹화 중..." : "대기 중"}
            </span>
            <span style={{ fontSize: 13, marginLeft: "auto", color: "#666" }}>
              {state.steps.length} 단계
            </span>
          </div>

          {isActive ? (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleTogglePause}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "transparent",
                    color: "#334155",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: "pointer"
                  }}>
                  {isPaused ? "재개" : "일시정지"}
                </button>
                <button
                  onClick={handleStop}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "#e11d48",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: "pointer"
                  }}>
                  녹화 완료
                </button>
              </div>
              <button
                onClick={handleDiscard}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 0",
                  background: "transparent",
                  color: "#666",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: "pointer"
                }}>
                저장하지 않고 취소
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                cursor: "pointer"
              }}>
              녹화 시작 (Start Recording)
            </button>
          )}

          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, color: "#666", margin: "0 0 6px" }}>
              완료된 매뉴얼 ({sessions.length})
            </p>
            {sessions.length === 0 ? (
              <p style={{ fontSize: 12, color: "#999" }}>아직 저장된 매뉴얼이 없습니다.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 260, overflowY: "auto" }}>
                {sessions.map((session) => {
                  const isExpanded = expandedId === session.id
                  return (
                    <li key={session.id} style={{ padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : session.id)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "#1e293b"
                          }}>
                          {isExpanded ? "▾" : "▸"} {session.title}
                        </button>
                        <span style={{ color: "#999" }}>{session.steps.length}단계</span>
                        <button
                          onClick={() => handleCopySteps(session)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#2563eb",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0
                          }}>
                          {copiedId === session.id ? "복사됨!" : "JSON 복사"}
                        </button>
                        <button
                          onClick={() => handleDeleteSession(session.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#e11d48",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0
                          }}>
                          삭제
                        </button>
                      </div>

                      <div style={{ marginTop: 4, fontSize: 11 }}>
                        {session.uploadStatus === "uploading" && (
                          <span style={{ color: "#999" }}>대시보드에 업로드 중...</span>
                        )}
                        {session.uploadStatus === "uploaded" && session.dashboardId && (
                          <button
                            onClick={() => handleOpenDashboard(session.dashboardId!)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#16a34a",
                              cursor: "pointer",
                              fontSize: 11,
                              padding: 0
                            }}>
                            ✓ 대시보드에서 열기
                          </button>
                        )}
                        {session.uploadStatus === "failed" && (
                          <span style={{ color: "#e11d48" }}>
                            업로드 실패 (대시보드 서버 확인){" "}
                            <button
                              onClick={() => handleRetryUpload(session.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#2563eb",
                                cursor: "pointer",
                                fontSize: 11,
                                padding: 0,
                                textDecoration: "underline"
                              }}>
                              재시도
                            </button>
                          </span>
                        )}
                        {session.uploadStatus === "unauthorized" && (
                          <span style={{ color: "#b45309" }}>
                            로그인이 필요해요{" "}
                            <button
                              onClick={handleOpenLogin}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#2563eb",
                                cursor: "pointer",
                                fontSize: 11,
                                padding: 0,
                                textDecoration: "underline"
                              }}>
                              로그인하기
                            </button>{" "}
                            ·{" "}
                            <button
                              onClick={() => handleRetryUpload(session.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#2563eb",
                                cursor: "pointer",
                                fontSize: 11,
                                padding: 0,
                                textDecoration: "underline"
                              }}>
                              재시도
                            </button>
                          </span>
                        )}
                      </div>

                      {isExpanded && (
                        <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: "#475569" }}>
                          {session.steps.map((step) => (
                            <li key={step.id} style={{ marginBottom: 2 }}>
                              {describeStep(step)}
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <UsecaseLink />
        </>
      )}
    </div>
  )
}

export default IndexPopup
