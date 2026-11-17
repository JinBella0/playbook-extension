import { getDashboardAccessToken } from "~lib/auth"
import type {
  ExtensionMessage,
  ExtensionResponse,
  RecordingSession,
  RecordingState,
  StepCapturePayload,
  StepData
} from "~lib/types"
import type { PageSnapshot } from "~lib/snapshot"
import type { RecordedSnapshots } from "~lib/types"
import { STORAGE_KEY_RECORDING_SNAPSHOTS, STORAGE_KEY_RECORDING_STATE, STORAGE_KEY_SESSIONS } from "~lib/types"

const DEFAULT_STATE: RecordingState = {
  status: "idle",
  steps: []
}

const DASHBOARD_URL = process.env.PLASMO_PUBLIC_DASHBOARD_URL || "http://localhost:3000"

async function getState(): Promise<RecordingState> {
  const result = await chrome.storage.local.get(STORAGE_KEY_RECORDING_STATE)
  return result[STORAGE_KEY_RECORDING_STATE] ?? DEFAULT_STATE
}

async function setState(state: RecordingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_RECORDING_STATE]: state })
}

async function getSessions(): Promise<RecordingSession[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS)
  return result[STORAGE_KEY_SESSIONS] ?? []
}

async function setSessions(sessions: RecordingSession[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions })
}

/** 현재 활성 탭의 화면을 캡처합니다 (JPEG dataURL) */
async function captureActiveTab(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 80
  })
}

async function updateBadge(state: RecordingState): Promise<void> {
  if (state.status === "recording") {
    await chrome.action.setBadgeBackgroundColor({ color: "#e11d48" })
    await chrome.action.setBadgeText({ text: String(state.steps.length) })
  } else if (state.status === "paused") {
    await chrome.action.setBadgeBackgroundColor({ color: "#a1a1aa" })
    await chrome.action.setBadgeText({ text: "❚❚" })
  } else {
    await chrome.action.setBadgeText({ text: "" })
  }
}

async function handleStartRecording(): Promise<RecordingState> {
  // 직전 녹화의 화면 저장본을 아직 꺼내는 중이면, 비우기 전에 기다립니다
  await snapshotTaking
  await clearSnapshots()
  const newState: RecordingState = {
    status: "recording",
    steps: [],
    startedAt: Date.now()
  }
  await setState(newState)
  await updateBadge(newState)
  return newState
}

async function handlePauseRecording(): Promise<RecordingState> {
  const current = await getState()
  if (current.status !== "recording") return current

  const newState: RecordingState = { ...current, status: "paused", pausedAt: Date.now() }
  await setState(newState)
  await updateBadge(newState)
  return newState
}

async function handleResumeRecording(): Promise<RecordingState> {
  const current = await getState()
  if (current.status !== "paused") return current

  // 일시정지된 시간만큼 startedAt을 밀어서, 경과시간 표시에 정지 시간이 포함되지 않도록 합니다
  const pausedDuration = current.pausedAt ? Date.now() - current.pausedAt : 0
  const newState: RecordingState = {
    ...current,
    status: "recording",
    startedAt: (current.startedAt ?? Date.now()) + pausedDuration,
    pausedAt: undefined
  }
  await setState(newState)
  await updateBadge(newState)
  return newState
}

const EMPTY_SNAPSHOTS: RecordedSnapshots = { assets: {}, pages: {} }

async function getSnapshots(): Promise<RecordedSnapshots> {
  const result = await chrome.storage.local.get(STORAGE_KEY_RECORDING_SNAPSHOTS)
  return result[STORAGE_KEY_RECORDING_SNAPSHOTS] ?? EMPTY_SNAPSHOTS
}

async function setSnapshots(snapshots: RecordedSnapshots): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_RECORDING_SNAPSHOTS]: snapshots })
}

// 단계 화면 저장본은 빠르게 연달아 들어오므로, 읽고-쓰기가 서로 덮어쓰지 않게 한 줄로 세워 처리합니다
let snapshotQueue: Promise<unknown> = Promise.resolve()

function queueSnapshotWrite(work: () => Promise<void>): Promise<void> {
  const next = snapshotQueue.then(work, work)
  snapshotQueue = next.catch(() => undefined)
  return next
}

/** 단계 화면 저장본 하나를 녹화 중 저장소에 더합니다 (녹화 중이 아니면 버림) */
function handleStepSnapshot(snapshotId: string, snapshot: PageSnapshot): Promise<void> {
  return queueSnapshotWrite(async () => {
    const state = await getState()
    if (state.status === "idle") return
    const current = await getSnapshots()
    await setSnapshots({
      assets: { ...current.assets, ...snapshot.assets },
      pages: { ...current.pages, [snapshotId]: snapshot.html }
    })
  })
}

const SNAPSHOT_WAIT_MS = 3_000

/** 녹화에 쓰인 단계 화면 저장본만 꺼내고 저장소를 비웁니다 (없으면 undefined) */
async function takeRecordedSnapshots(steps: StepData[]): Promise<RecordedSnapshots | undefined> {
  // 마지막 단계 화면은 정리(이미지 받기)가 끝나기 전에 녹화가 끝날 수 있어, 잠깐 기다립니다
  const wanted = steps.map((step) => step.snapshotId).filter((id): id is string => Boolean(id))
  const deadline = Date.now() + SNAPSHOT_WAIT_MS
  while (Date.now() < deadline) {
    const { pages } = await getSnapshots()
    if (wanted.every((id) => pages[id])) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  let taken: RecordedSnapshots | undefined
  return queueSnapshotWrite(async () => {
    const current = await getSnapshots()
    const pages: Record<string, string> = {}
    for (const step of steps) {
      if (step.snapshotId && current.pages[step.snapshotId]) pages[step.snapshotId] = current.pages[step.snapshotId]
    }
    taken = Object.keys(pages).length > 0 ? { assets: current.assets, pages } : undefined
    await setSnapshots(EMPTY_SNAPSHOTS)
  }).then(() => taken)
}

function clearSnapshots(): Promise<void> {
  return queueSnapshotWrite(() => setSnapshots(EMPTY_SNAPSHOTS))
}

/** 녹화 완료를 처리하는 중인지. 완료 버튼을 여러 번 눌러도 한 번만 처리합니다 */
let stopping = false
/** 직전 녹화의 화면 저장본을 꺼내는 중이면 그 작업. 새 녹화가 저장본을 비우기 전에 기다립니다 */
let snapshotTaking: Promise<unknown> = Promise.resolve()

/**
 * 녹화를 종료하고, 수집된 steps를 완료된 매뉴얼 세션으로 Local Storage에 확정 저장합니다.
 * 업로드는 몇 초 걸리므로, 녹화 상태는 먼저 끝내(컨트롤 바가 바로 사라짐) 사용자가 다시 누르거나
 * 그사이 클릭이 단계로 찍히지 않게 합니다
 */
async function handleStopRecording(): Promise<RecordingState> {
  if (stopping) return getState()
  stopping = true
  try {
    // 완료 직전에 누른 클릭의 단계가 찍히는 중이면 마저 기다립니다
    await Promise.allSettled([...capturesInFlight])
    const current = await getState()
    const idle: RecordingState = { status: "idle", steps: [] }
    await setState(idle)
    await updateBadge(idle)
    if (current.status !== "idle" && current.steps.length > 0) {
      const snapshots = takeRecordedSnapshots(current.steps)
      snapshotTaking = snapshots.catch(() => undefined)
      await saveAndUpload(current, await snapshots)
    }
    return idle
  } finally {
    stopping = false
  }
}

/** 끝난 녹화를 세션으로 저장하고 대시보드에 올린 뒤, 결과 페이지(또는 로그인 페이지)를 엽니다 */
async function saveAndUpload(current: RecordingState, snapshots: RecordedSnapshots | undefined) {
  const finishedAt = Date.now()
  const session: RecordingSession = {
    id: crypto.randomUUID(),
    title: `매뉴얼 ${new Date(finishedAt).toLocaleString("ko-KR")}`,
    createdAt: current.startedAt ?? finishedAt,
    finishedAt,
    steps: current.steps,
    snapshots,
    uploadStatus: "uploading"
  }
  const sessions = await getSessions()
  await setSessions([session, ...sessions])

  const result = await uploadSessionToDashboard(session)
  await patchSession(
    session.id,
    result.ok
      ? { uploadStatus: "uploaded", dashboardId: result.dashboardId }
      : { uploadStatus: result.reason === "unauthorized" ? "unauthorized" : "failed" }
  )

  // 녹화 완료 -> 결과 페이지로 자동 이동 (기획: 녹화 종료 후 대시보드로 이동해 확인/수정)
  if (result.ok) {
    await chrome.tabs.create({ url: `${DASHBOARD_URL}/manual/${result.dashboardId}` })
  } else if (result.reason === "unauthorized") {
    await chrome.tabs.create({ url: `${DASHBOARD_URL}/login` })
  }
}

/** 저장하지 않고 현재 녹화 중인 내용을 폐기합니다 */
async function handleDiscardRecording(): Promise<RecordingState> {
  await clearSnapshots()
  const newState: RecordingState = { status: "idle", steps: [] }
  await setState(newState)
  await updateBadge(newState)
  return newState
}

/** 녹화 시작/정지 단축키 토글 (idle -> 시작, 그 외 -> 종료) */
async function handleToggleRecording(): Promise<RecordingState> {
  const current = await getState()
  return current.status === "idle" ? handleStartRecording() : handleStopRecording()
}

async function handleDeleteSession(sessionId: string): Promise<RecordingSession[]> {
  const sessions = await getSessions()
  const filtered = sessions.filter((session) => session.id !== sessionId)
  await setSessions(filtered)
  return filtered
}

type UploadResult =
  | { ok: true; dashboardId: string }
  | { ok: false; reason: "unauthorized" | "error" }

/**
 * 대시보드(Next.js -> Supabase)에 완료된 세션을 업로드합니다.
 * 확장 프로그램의 background fetch는 쿠키(SameSite/서드파티 차단)를 실어 보낼 수 없으므로,
 * chrome.cookies로 직접 읽은 로그인 토큰을 Authorization 헤더로 보냅니다
 * (사용자가 브라우저에서 대시보드에 로그인해둔 상태여야 합니다).
 */
async function uploadSessionToDashboard(session: RecordingSession): Promise<UploadResult> {
  try {
    const accessToken = await getDashboardAccessToken()
    if (!accessToken) return { ok: false, reason: "unauthorized" }
    const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }

    // 1) 대시보드 서버는 요청 하나에 4.5MB까지만 받으므로(넘으면 413), 무거운 스크린샷·화면 저장본은
    //    서명된 주소를 받아 Storage에 직접 올리고 서버에는 주소만 보냅니다
    const blobs = new Map<string, Blob>()
    for (const step of session.steps) {
      if (step.screenshot.startsWith("data:")) blobs.set(step.id, await (await fetch(step.screenshot)).blob())
    }
    const hasSnapshots = !!session.snapshots && Object.keys(session.snapshots.pages).length > 0

    const urlsResponse = await fetch(`${DASHBOARD_URL}/api/sessions/upload-urls`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        screenshots: [...blobs].map(([stepId, blob]) => ({ stepId, contentType: blob.type || "image/jpeg" })),
        snapshots: hasSnapshots
      })
    })
    if (urlsResponse.status === 401) return { ok: false, reason: "unauthorized" }
    if (!urlsResponse.ok) return { ok: false, reason: "error" }
    const urls: {
      sessionId: string
      screenshots: Record<string, { signedUrl: string; publicUrl: string }>
      snapshot: { signedUrl: string } | null
    } = await urlsResponse.json()

    const put = async (signedUrl: string, body: Blob, contentType: string) => {
      const response = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, "x-upsert": "true" },
        body
      })
      if (!response.ok) throw new Error(`Storage 업로드 실패 (${response.status})`)
    }
    await Promise.all(
      [...blobs].map(([stepId, blob]) => put(urls.screenshots[stepId].signedUrl, blob, blob.type || "image/jpeg"))
    )
    if (hasSnapshots && urls.snapshot) {
      const gzipped = new Blob([JSON.stringify(session.snapshots)])
        .stream()
        .pipeThrough(new CompressionStream("gzip"))
      await put(urls.snapshot.signedUrl, await new Response(gzipped).blob(), "application/gzip")
    }

    // 2) 주소로 바뀐 단계 정보만 보내 세션을 만듭니다
    const steps = session.steps.map((step) =>
      urls.screenshots[step.id] ? { ...step, screenshot: urls.screenshots[step.id].publicUrl } : step
    )
    const response = await fetch(`${DASHBOARD_URL}/api/sessions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: urls.sessionId,
        title: session.title,
        steps,
        snapshotsUploaded: hasSnapshots && !!urls.snapshot
      })
    })
    if (response.status === 401) return { ok: false, reason: "unauthorized" }
    if (!response.ok) return { ok: false, reason: "error" }
    const data = await response.json()
    return { ok: true, dashboardId: data.id }
  } catch (error) {
    console.error("[playbook] 대시보드 업로드 실패 (대시보드가 실행 중인지 확인하세요):", error)
    return { ok: false, reason: "error" }
  }
}

async function patchSession(
  sessionId: string,
  patch: Partial<RecordingSession>
): Promise<RecordingSession[]> {
  const sessions = await getSessions()
  const updated = sessions.map((session) =>
    session.id === sessionId ? { ...session, ...patch } : session
  )
  await setSessions(updated)
  return updated
}

async function handleRetryUpload(sessionId: string): Promise<RecordingSession[]> {
  const sessions = await getSessions()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return sessions

  await patchSession(sessionId, { uploadStatus: "uploading" })
  const result = await uploadSessionToDashboard(session)
  return patchSession(
    sessionId,
    result.ok
      ? { uploadStatus: "uploaded", dashboardId: result.dashboardId }
      : { uploadStatus: result.reason === "unauthorized" ? "unauthorized" : "failed" }
  )
}

/** 녹화 중일 때 하나의 step을 캡처(스크린샷 포함)해 저장하는 공용 로직 */
/**
 * 녹화 컨트롤 바가 매뉴얼/Use Case 화면에 찍히지 않도록, 캡처하는 순간에만 잠깐 숨깁니다.
 * (컨트롤 바가 다시 그려진 뒤에 응답하므로 숨겨진 화면이 찍힙니다)
 */
const CONTROL_BAR_TIMEOUT_MS = 300

async function captureWithoutControlBar(windowId: number): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, windowId })
  const setHidden = async (hidden: boolean) => {
    if (tab?.id === undefined) return
    const message: ExtensionMessage = { type: "SET_CONTROL_BAR_HIDDEN", hidden }
    // 컨트롤 바가 없는 페이지(chrome:// 등)는 응답이 없고, 응답이 늦는 페이지도 있어
    // 최대 CONTROL_BAR_TIMEOUT_MS만 기다립니다 (기다리다 캡처 자체가 멈추면 단계가 기록되지 않음)
    await Promise.race([
      chrome.tabs.sendMessage(tab.id, message).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, CONTROL_BAR_TIMEOUT_MS))
    ])
  }

  await setHidden(true)
  try {
    return await captureActiveTab(windowId)
  } finally {
    await setHidden(false)
  }
}

async function appendCapturedStep(
  partial: Omit<StepData, "id" | "order" | "screenshot">,
  windowIdForCapture: number
): Promise<RecordingState> {
  const before = await getState()
  if (before.status !== "recording" || stopping) return before

  let screenshot = ""
  try {
    screenshot = await captureWithoutControlBar(windowIdForCapture)
  } catch (error) {
    console.error("[playbook] 스크린샷 캡처 실패:", error)
  }

  // 화면을 찍는 동안 녹화가 끝났거나 새 녹화가 시작됐으면 이 단계는 버립니다.
  // (예전 상태를 그대로 덮어쓰면, 이미 끝난 녹화가 다시 "녹화 중"으로 되살아남)
  // 같은 녹화면 그사이 추가된 단계를 잃지 않도록 지금 상태에 이어 붙입니다
  const current = await getState()
  if (current.status !== "recording" || current.startedAt !== before.startedAt) return current

  const step: StepData = {
    ...partial,
    id: crypto.randomUUID(),
    order: current.steps.length + 1,
    screenshot
  }

  const newState: RecordingState = { ...current, steps: [...current.steps, step] }
  await setState(newState)
  await updateBadge(newState)
  return newState
}

/** 진행 중인 단계 캡처들. 녹화 완료 시 마지막 클릭의 단계가 다 찍힐 때까지 기다리는 데 씁니다 */
const capturesInFlight = new Set<Promise<unknown>>()

async function handleCaptureStep(
  payload: StepCapturePayload,
  senderWindowId: number | undefined
): Promise<RecordingState> {
  if (senderWindowId === undefined) return getState()
  const capture = appendCapturedStep(payload, senderWindowId)
  capturesInFlight.add(capture)
  try {
    return await capture
  } finally {
    capturesInFlight.delete(capture)
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse: (response: ExtensionResponse) => void) => {
    ;(async () => {
      try {
        switch (message.type) {
          case "GET_RECORDING_STATE": {
            const state = await getState()
            sendResponse({ ok: true, state })
            return
          }
          case "START_RECORDING": {
            const state = await handleStartRecording()
            sendResponse({ ok: true, state })
            return
          }
          case "STOP_RECORDING": {
            const state = await handleStopRecording()
            sendResponse({ ok: true, state })
            return
          }
          case "PAUSE_RECORDING": {
            const state = await handlePauseRecording()
            sendResponse({ ok: true, state })
            return
          }
          case "RESUME_RECORDING": {
            const state = await handleResumeRecording()
            sendResponse({ ok: true, state })
            return
          }
          case "DISCARD_RECORDING": {
            const state = await handleDiscardRecording()
            sendResponse({ ok: true, state })
            return
          }
          case "CAPTURE_STEP": {
            const state = await handleCaptureStep(message.payload, sender.tab?.windowId)
            sendResponse({ ok: true, state })
            return
          }
          case "STEP_SNAPSHOT": {
            await handleStepSnapshot(message.snapshotId, message.snapshot)
            sendResponse({ ok: true, state: await getState() })
            return
          }
          case "GET_SESSIONS": {
            const sessions = await getSessions()
            sendResponse({ ok: true, sessions })
            return
          }
          case "DELETE_SESSION": {
            const sessions = await handleDeleteSession(message.sessionId)
            sendResponse({ ok: true, sessions })
            return
          }
          case "RETRY_UPLOAD": {
            const sessions = await handleRetryUpload(message.sessionId)
            sendResponse({ ok: true, sessions })
            return
          }
          default:
            sendResponse({ ok: false, error: "알 수 없는 메시지 타입입니다." })
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()

    // 비동기 응답을 위해 true 반환
    return true
  }
)

// 다른 탭으로 전환하거나 새 탭/창으로 이동하는 것도 하나의 "단계"로 기록합니다
// (클릭 이벤트가 없는 브라우저 레벨 동작이라 content script가 아닌 여기서 감지)
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await appendCapturedStep(
      {
        type: "tabswitch",
        timestamp: Date.now(),
        url: tab.url ?? "",
        pageTitle: tab.title ?? "",
        coordinates: {
          x: 0,
          y: 0,
          viewportWidth: 16,
          viewportHeight: 9,
          xRatio: 0.5,
          yRatio: 0.5
        },
        element: {
          tagName: "TAB",
          text: tab.title ? `${tab.title} 탭` : "새 탭",
          placeholder: "",
          ariaLabel: "",
          selector: ""
        }
      },
      windowId
    )
  } catch (error) {
    console.error("[playbook] 탭 전환 캡처 실패:", error)
  }
})

// 단축키(기본 Ctrl+Shift+E)로 녹화 시작/종료 토글
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-recording") {
    handleToggleRecording()
  }
})

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[playbook] Extension installed. 초기 상태를 설정합니다.")
  setState(DEFAULT_STATE)
  // 처음 설치했을 때만 로그인 화면을 엽니다 (업데이트 때는 열지 않음).
  // 로그인하면 대시보드 홈으로 가고, 거기서 처음 한 번 둘러보기 안내가 뜹니다. 이미 로그인돼 있으면 바로 홈으로 넘어갑니다
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: `${DASHBOARD_URL}/login` })
  }
})
