"use client";
import { useEffect, useRef, useState } from "react";
import type { Job } from "@/shared/b3";
import { api, message } from "./api";
export const jobLabels: Record<string, string> = { queued: "等待处理", running: "正在处理", retry: "等待恢复", succeeded: "已完成", failed: "未完成" };
export function useJob(householdId: string, jobId: string, onDone: () => void) {
  const [value, setValue] = useState<{ id: string; job: Job } | null>(null); const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const finished = useRef(""); const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!jobId) return; let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const job = await api<Job>("households/" + householdId + "/jobs/" + jobId);
        if (!active) return; setValue({ id: jobId, job }); setError("");
        if (["succeeded", "failed"].includes(job.state)) { if (finished.current !== job.id + ":" + job.state) { finished.current = job.id + ":" + job.state; done.current(); } }
        else timer = setTimeout(poll, 1200);
      } catch (e) { if (active) setError(message(e)); }
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [householdId, jobId, reload]);
  return { job: value?.id === jobId ? value.job : null, error, reload: () => { finished.current = ""; setReload((v) => v + 1); } };
}
export function JobState({ job, error }: { job: Job | null; error?: string }) {
  return <>{error && <p className="error" role="alert">{error}</p>}{job && <p className={job.state === "failed" ? "error" : "notice"} role="status">{jobLabels[job.state] ?? job.state}{job.errorMessage ? "：" + job.errorMessage : ""}{job.durationMs !== null && <span className="small"> · 耗时 {(job.durationMs / 1000).toFixed(1)} 秒</span>}</p>}</>;
}
