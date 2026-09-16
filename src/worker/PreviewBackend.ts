// LOCAL PREVIEW ONLY: no Firebase, Jitsu, fetch or outbound analytics.
export class Backend {
  readonly preview = true;
  async register(pid: string) {
    const user = { prolificId: pid, uid: `preview-${pid}`, sessionUid: crypto.randomUUID(), active: true };
    await chrome.storage.local.set({ user });
    return user;
  }
  async surveyUrl(): Promise<string> { return 'https://example.invalid/local-preview'; }
  async track(event: string, properties: Record<string, any>) {
    const { previewEvents = [], studyContext: c } = await chrome.storage.local.get(['previewEvents','studyContext']);
    const payload = { ...properties, event_type: event, ts: Date.now(), user_id: c?.prolificId,
      session_id: c?.sessionId, arm: c?.arm, product_category: c?.category, preview: true };
    await chrome.storage.local.set({ previewEvents: [...previewEvents, payload].slice(-500) });
  }
}
