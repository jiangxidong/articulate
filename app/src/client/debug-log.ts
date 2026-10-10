// Debug log for one call. Uploaded to the Worker every 30 s and when the call ends, so test calls can be read
// back from /api/logs without copy-paste.

const UPLOAD_EVERY_MS = 30_000;

export type Log = (msg: string) => void;

export class DebugLog {
  readonly id: string;
  readonly startedAt = Date.now();
  private readonly t0 = performance.now();
  private lines: string[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private uploadedLength = -1;

  constructor() {
    const d = new Date(this.startedAt);
    const p = (n: number) => String(n).padStart(2, "0");
    this.id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  }

  readonly log: Log = (msg) => {
    const line = `${((performance.now() - this.t0) / 1000).toFixed(2).padStart(7)}  ${msg}`;
    this.lines.push(line);
  };

  startUploading() {
    this.timer = setInterval(() => void this.upload(), UPLOAD_EVERY_MS);
    addEventListener("pagehide", this.beacon);
  }

  async stopUploading() {
    clearInterval(this.timer);
    removeEventListener("pagehide", this.beacon);
    await this.upload();
  }

  private body() {
    return JSON.stringify({ id: this.id, startedAt: this.startedAt, userAgent: navigator.userAgent, text: this.lines.join("\n") });
  }

  async upload() {
    if (this.lines.length === this.uploadedLength) return;
    const length = this.lines.length;
    try {
      const r = await fetch("/api/logs", { method: "POST", headers: { "content-type": "application/json" }, body: this.body() });
      if (r.ok) this.uploadedLength = length;
      else this.log(`log upload failed: HTTP ${r.status}`);
    } catch (e) {
      this.log(`log upload failed: ${(e as Error).message}`);
    }
  }

  private beacon = () => {
    this.log("pagehide → beacon upload");
    navigator.sendBeacon("/api/logs", new Blob([this.body()], { type: "application/json" }));
  };
}
