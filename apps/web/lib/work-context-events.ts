const WORK_CONTEXT_REFRESH_EVENT = "novel-brain:work-context-refresh";

export function requestWorkContextRefresh(): void {
  window.dispatchEvent(new Event(WORK_CONTEXT_REFRESH_EVENT));
}

export function subscribeWorkContextRefresh(listener: () => void): () => void {
  window.addEventListener(WORK_CONTEXT_REFRESH_EVENT, listener);
  return () => window.removeEventListener(WORK_CONTEXT_REFRESH_EVENT, listener);
}
