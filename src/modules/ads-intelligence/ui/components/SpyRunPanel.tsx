import { useEffect, useState } from "react";

import type { AdsIntelligenceClient, SpyJob } from "../../types";

import { SpyRunLog } from "./SpyRunLog";

const PHASES = [{ id: "profile", label: "Xác minh store" }, { id: "discovery", label: "Tìm đối thủ" }, { id: "ads", label: "Thu thập quảng cáo" }, { id: "media", label: "Kiểm tra media" }, { id: "analysis", label: "Phân tích" }, { id: "publish", label: "Lưu kết quả" }];
const ERRORS: Readonly<Record<string, string>> = {
  SPY_LOG_WRITE_FAILED: "Không ghi được nhật ký trên backend; chưa công bố kết quả mới.",
  SPY_PERMISSION_REQUIRED: "CLI đã từ chối quyền chạy công cụ trong chế độ nền. Cần cấu hình quyền cho lệnh MCP trên máy backend rồi chạy lại; kết quả cũ vẫn được giữ nguyên.",
  SPY_RUNNER_RESPONSE_INVALID: "Không đọc được phản hồi có cấu trúc từ CLI; chưa công bố kết quả.",
  SPY_RESEARCH_MISSING: "CLI đã kết thúc nhưng chưa gửi dữ liệu nghiên cứu qua công cụ lưu kết quả. Thư viện cũ được giữ nguyên.",
  SPY_LOGIN_REQUIRED: "CLI cần đăng nhập lại trên máy chạy backend.", SPY_TIMEOUT: "Đã dừng vì vượt 90 phút. Kết quả cũ được giữ nguyên.",
  SPY_RUNNER_FAILED: "CLI không hoàn thành. Kiểm tra đăng nhập, model và kết nối của công cụ.",
  SPY_EXECUTION_FAILED: "Agent chưa trả kết quả nghiên cứu hợp lệ; không thay kết quả cũ.",
  SPY_COVERAGE_INCOMPLETE: "Kết quả chưa có trạng thái thu thập cho từng đối thủ; chưa được đưa lên thư viện.",
  SPY_MEDIA_UNVERIFIED: "Một số mẫu chưa được kiểm tra ảnh/video; chưa thay thư viện hiện tại.",
  SPY_RESEARCH_INVALID: "Kết quả không khớp store hoặc lượt chạy hiện tại; chưa được công bố.",
  SPY_SERVER_RESTARTED: "Backend đã khởi động lại. Lượt cũ bị gián đoạn; bạn có thể chạy lại.",
};

export function SpyRunPanel({ client, storeId }: { readonly client: AdsIntelligenceClient; readonly storeId: string }): React.JSX.Element {
  const [job, setJob] = useState<SpyJob | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        if (!client.getSpyJob) return;
        const snapshot = await client.getSpyJob(storeId);
        if (!disposed) setJob(snapshot.job);
      } catch {
        // Graceful
      }
    })();
    return () => { disposed = true; };
  }, [client, storeId, reload]);

  useEffect(() => {
    if (!client.getSpyJob) return;
    let disposed = false;
    let fetching = false;
    const timer = window.setInterval(() => {
      if (fetching) return;
      fetching = true;
      void client.getSpyJob?.(storeId).then(snapshot => {
        if (!disposed && snapshot.job) {
          setJob(snapshot.job);
        }
      }).finally(() => { fetching = false; });
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [client, storeId]);

  const isRunning = job?.status === "running";
  return <section aria-label="Chạy nghiên cứu đối thủ" className="space-y-4 rounded-2xl border border-indigo-900/60 bg-slate-950/70 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-100">Nghiên cứu đối thủ</h3><p className="text-xs text-slate-400">Store: <strong className="text-cyan-300">{storeId}</strong> · Tìm tối đa 10 đối thủ đúng sản phẩm, kiểm tra quảng cáo và lưu lên thư viện.</p></div><span className="rounded border border-purple-800 px-2 py-1 text-xs text-purple-300">Skill spy-competitors · MCP ffp-ads</span></div>
    <div className="rounded-xl border border-indigo-900/30 bg-slate-950/80 p-3.5 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <span className="text-cyan-400">💡</span>
          <span>Thực thi thông qua AI Agent trên máy tính cá nhân (0đ phí AI API):</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setReload(value => value + 1);
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-cyan-300 hover:text-white hover:border-cyan-500 transition cursor-pointer flex items-center gap-1.5"
        >
          <span>🔄</span>
          <span>Tải lại dữ liệu</span>
        </button>
      </div>
      <p className="text-slate-400 leading-relaxed text-[11px]">
        Tác vụ Spy đối thủ được thực hiện độc lập bởi <strong>Google Antigravity CLI (<code className="text-cyan-300">agy</code>)</strong> hoặc <strong>OpenAI Codex CLI (<code className="text-cyan-300">codex</code>)</strong> đang chạy trên máy tính của bạn thông qua giao thức MCP để tận dụng tối đa gói thuê bao có sẵn.
      </p>
      <div className="pt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-slate-400">Lệnh quét đối thủ mới từ terminal máy bạn:</span>
        <code className="px-2 py-0.5 rounded bg-black/70 border border-slate-800 text-cyan-300 font-mono select-all">
          agy &quot;Quét và phân tích đối thủ cho store {storeId}&quot;
        </code>
      </div>
    </div>

    {job && <div aria-live="polite" className="space-y-2 text-xs text-slate-400">
      <p>{job.storeId} · {job.runner} / {job.model} · Bắt đầu {new Date(job.startedAt).toLocaleString("vi-VN")}</p>
      {isRunning && <><ol className="flex flex-wrap gap-2">{PHASES.map(phase => <li key={phase.id} aria-current={job.phase === phase.id ? "step" : undefined} className={`rounded px-2 py-1 ${job.phase === phase.id ? "bg-cyan-950 text-cyan-200" : "bg-slate-900"}`}>{phase.label}</li>)}</ol><p>Bước do agent báo cáo. Bạn có thể chuyển tab hoặc tải lại trang; backend tiếp tục chạy. Kết quả cũ được giữ trong lúc nghiên cứu.</p></>}
      {(job.status === "completed" || job.status === "partial") && <p className="text-cyan-200">{job.status === "completed" ? "Hoàn tất" : "Đã kết thúc lượt chạy, còn thiếu bằng chứng ở một số đối thủ"}: {job.adCount ?? 0} quảng cáo / {job.brandsWithAds ?? 0} thương hiệu; {job.selectedCount ?? 0} đối thủ được chọn. {job.published ? "Kết quả tự cập nhật bên dưới trong tối đa 15 giây." : "Chưa thay kết quả cũ; lượt mới chưa có quảng cáo xác minh."}</p>}
      {job.status === "cancelled" && <p>Đã dừng. Không công bố kết quả của lượt này.</p>}
      {(job.status === "failed" || job.status === "interrupted") && <p className="text-amber-300">{ERRORS[job.errorCode ?? ""] ?? "Lượt Spy chưa hoàn tất. Kết quả cũ vẫn được giữ nguyên."}</p>}
    </div>}
    {job && <SpyRunLog key={job.id} job={job} />}
  </section>;
}
