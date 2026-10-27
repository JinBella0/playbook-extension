// 녹화 상태 및 이벤트 데이터 타입 정의
// background(Service Worker) <-> content script <-> popup 간에 공유됩니다.

export type RecordingStatus = "idle" | "recording" | "paused"

export type CapturedEventType =
  | "click"
  | "change"
  | "keydown"
  | "contextmenu"
  | "dragdrop"
  | "tabswitch"

export interface ElementInfo {
  tagName: string
  text: string
  placeholder: string
  ariaLabel: string
  selector: string
  inputValue?: string
  keyPressed?: string
  /** type: "dragdrop"일 때, 드래그된 원본 요소의 텍스트 */
  dragSourceText?: string
}

/** 클릭/입력된 요소의 실제 바운딩 박스 (뷰포트 대비 비율, 0~1) */
export interface BoxRatio {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
}

export interface Coordinates {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
  /** 요소 하이라이트 렌더링을 위한 뷰포트 대비 비율 (0~1) */
  xRatio: number
  yRatio: number
  /** 요소 크기에 맞춘 사각형 하이라이트를 그리기 위한 정보 (없으면 점으로 표시) */
  box?: BoxRatio
}

export interface StepData {
  id: string
  order: number
  type: CapturedEventType
  timestamp: number
  url: string
  pageTitle: string
  /** chrome.tabs.captureVisibleTab 결과 (dataURL) */
  screenshot: string
  coordinates: Coordinates
  element: ElementInfo
  /** 직전 단계 이후 화면에 새로 나타난 글자 (시연이 이 단계에서 무엇을 보여줬는지 설명하는 재료) */
  screenText?: string
}

/** content script가 background로 보내는 원본 캡처 데이터 (id/order/screenshot은 background가 채움) */
export type StepCapturePayload = Omit<StepData, "id" | "order" | "screenshot">

/** 현재 진행 중인 녹화의 실시간 상태 (녹화 중에만 존재) */
export interface RecordingState {
  status: RecordingStatus
  steps: StepData[]
  startedAt?: number
  /** 일시정지된 시각. 재개 시 이 값만큼 startedAt을 밀어 경과시간에서 제외합니다 */
  pausedAt?: number
}

export type UploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "unauthorized"

/** 녹화 완료 후 Local Storage에 영구 저장되는 매뉴얼 세트 */
export interface RecordingSession {
  id: string
  title: string
  createdAt: number
  finishedAt: number
  steps: StepData[]
  /** 대시보드(Supabase) 업로드 상태. 성공 시 dashboardId로 바로 이동 가능 */
  uploadStatus: UploadStatus
  dashboardId?: string
}

export const STORAGE_KEY_RECORDING_STATE = "recordingState"
export const STORAGE_KEY_SESSIONS = "recordingSessions"

export type ExtensionMessage =
  | { type: "GET_RECORDING_STATE" }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "PAUSE_RECORDING" }
  | { type: "RESUME_RECORDING" }
  | { type: "CAPTURE_STEP"; payload: StepCapturePayload }
  | { type: "DISCARD_RECORDING" }
  | { type: "GET_SESSIONS" }
  | { type: "DELETE_SESSION"; sessionId: string }
  | { type: "RETRY_UPLOAD"; sessionId: string }
  | { type: "SET_CONTROL_BAR_HIDDEN"; hidden: boolean }

export type ExtensionResponse =
  | { ok: true; state: RecordingState }
  | { ok: true; sessions: RecordingSession[] }
  | { ok: false; error: string }
