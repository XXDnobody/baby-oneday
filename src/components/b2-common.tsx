"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, message, newKey } from "./api";
export const localToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const stamp = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "尚未确认";
export function useResource<T>(path: string, tick: number, enabled = true) {
  const [value, setValue] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api<T>(path).then((data) => { if (active) { setValue({ path, data }); setError(""); } }).catch((e: unknown) => { if (active) { setError(message(e)); if (e instanceof ApiError && [401, 403, 404, 410].includes(e.status)) setValue(null); } });
    return () => { active = false; };
  }, [path, tick, retry, enabled]);
  return { data: value?.path === path ? value.data : null, error, reload: () => setRetry((n) => n + 1) };
}
export function useTask() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const pending = useRef(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  async function run(input: unknown, action: (key: string) => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: newKey() };
    try { await action(request.current.key); request.current = null; }
    catch (e) { setError(message(e)); }
    finally { pending.current = false; setBusy(false); }
  }
  return { busy, error, run, setError };
}
export function LoadState({ error, retry }: { error: string; retry?: () => void }) {
  return error ? <div className="error" role="alert">{error}{retry && <button className="text-button" onClick={retry}>重试读取</button>}</div> : <p className="muted" role="status">正在读取…</p>;
}
