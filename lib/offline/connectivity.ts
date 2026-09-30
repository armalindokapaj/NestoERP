import { getPlatformServices } from "@/lib/device/registry";

/**
 * Connectivity (MOB-09 §24, §25, §67, §138).
 *
 * "Online" here means the NESTO server answered recently — not just that the
 * radio is on, which is what `navigator.onLine` reports and is wrong behind a
 * captive portal or on one bar of signal. The probe is cheap, runs only when
 * the answer is in doubt, and backs off, so it costs no battery while the
 * device is simply online.
 */

export type ConnectivitySnapshot = {
  online: boolean;
  /** Bumped on every change, so a subscriber can tell "came back" from "still online". */
  changedAt: number;
  /** How many times the device has gone from offline to online this session. */
  restorations: number;
};

const PROBE_PATH = "/api/health/live";
const PROBE_TIMEOUT_MS = 4_000;
const OFFLINE_PROBE_STEPS_MS = [5_000, 15_000, 30_000, 60_000];

type Listener = () => void;

export class ConnectivityService {
  private snapshot: ConnectivitySnapshot;
  private listeners = new Set<Listener>();
  private stops: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private probeStep = 0;
  private started = false;

  constructor(private readonly probe: () => Promise<boolean> = defaultProbe, now: () => number = Date.now) {
    this.now = now;
    this.snapshot = { online: typeof navigator === "undefined" ? true : navigator.onLine !== false, changedAt: now(), restorations: 0 };
  }
  private readonly now: () => number;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = (): ConnectivitySnapshot => this.snapshot;
  getServerSnapshot = (): ConnectivitySnapshot => ({ online: true, changedAt: 0, restorations: 0 });

  private set(online: boolean): void {
    if (online === this.snapshot.online) return;
    this.snapshot = { online, changedAt: this.now(), restorations: this.snapshot.restorations + (online ? 1 : 0) };
    for (const listener of this.listeners) listener();
    if (online) this.clearTimer();
    else this.scheduleProbe();
  }

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    const onOffline = () => this.set(false);
    const onOnline = () => void this.check();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    this.stops.push(() => window.removeEventListener("offline", onOffline), () => window.removeEventListener("online", onOnline));
    // The shell reports network changes and resumes; both mean "ask again" (§67).
    try {
      const lifecycle = getPlatformServices().lifecycle;
      this.stops.push(lifecycle.onNetworkChange((state) => (state.online ? void this.check() : this.set(false))), lifecycle.onResume(() => void this.check()));
    } catch {
      // A browser has no lifecycle service: the window events above are enough.
    }
    const onVisible = () => document.visibilityState === "visible" && void this.check();
    document.addEventListener("visibilitychange", onVisible);
    this.stops.push(() => document.removeEventListener("visibilitychange", onVisible));
    if (!this.snapshot.online) this.scheduleProbe();
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
    for (const stop of this.stops.splice(0)) stop();
  }

  /** A request failed the way an unreachable server fails: believe it, and start probing. */
  reportUnreachable(): void {
    this.set(false);
  }

  async check(): Promise<boolean> {
    const reachable = await this.probe().catch(() => false);
    this.set(reachable);
    return reachable;
  }

  private scheduleProbe(): void {
    if (!this.started || this.timer) return;
    const delay = OFFLINE_PROBE_STEPS_MS[Math.min(this.probeStep, OFFLINE_PROBE_STEPS_MS.length - 1)]!;
    this.probeStep += 1;
    this.timer = setTimeout(async () => {
      this.timer = null;
      // A hidden page does not spend battery on probes; it asks again when it is shown.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return this.scheduleProbe();
      if (!(await this.check())) this.scheduleProbe();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.probeStep = 0;
  }
}

async function defaultProbe(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(PROBE_PATH, { method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let shared: ConnectivityService | null = null;
export function connectivity(): ConnectivityService {
  shared ??= new ConnectivityService();
  return shared;
}
