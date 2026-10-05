import React, { useState, useMemo } from "react";
import type { AdsHierarchyCampaign } from "../../types";

export interface HierarchyTabProps {
  readonly campaigns: readonly AdsHierarchyCampaign[];
}

type SortField = "createdTime" | "spend" | "purchases" | "cpa" | "roas";
type SortDirection = "asc" | "desc";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number) => n.toString().padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr;
  }
}

export function HierarchyTab({ campaigns }: HierarchyTabProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE">("ALL");
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({
    [campaigns[0]?.id || ""]: true,
  });
  const [sortField, setSortField] = useState<SortField>("createdTime");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const toggleCampaign = (id: string) => {
    setExpandedCampaigns((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Filter & Sort
  const processedCampaigns = useMemo(() => {
    let result = [...campaigns];

    // Status filter
    if (statusFilter === "ACTIVE") {
      result = result.filter((c) => c.status === "ACTIVE" || c.effectiveStatus === "ACTIVE");
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.id.includes(q) ||
          c.adsets.some((as) => as.name.toLowerCase().includes(q) || as.ads.some((ad) => ad.name.toLowerCase().includes(q)))
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortField === "createdTime") {
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : 0;
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : 0;
        if (timeA !== timeB) {
          return sortDirection === "desc" ? timeB - timeA : timeA - timeB;
        }
        return Number(b.spend) - Number(a.spend);
      }
      let valA = Number(a[sortField]) || 0;
      let valB = Number(b[sortField]) || 0;
      return sortDirection === "desc" ? valB - valA : valA - valB;
    });

    return result;
  }, [campaigns, statusFilter, searchQuery, sortField, sortDirection]);

  return (
    <div className="space-y-4">
      {/* Controls Bar: Search, Status Filter, Counter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search box */}
          <div className="relative">
            <span className="absolute left-2.5 top-2 text-slate-500 text-xs">🔍</span>
            <input
              type="text"
              placeholder="Tìm theo tên hoặc ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-56"
            />
          </div>

          {/* Status Toggle */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                statusFilter === "ALL"
                  ? "bg-slate-800 text-cyan-300 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Tất cả ({campaigns.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("ACTIVE")}
              className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                statusFilter === "ACTIVE"
                  ? "bg-slate-800 text-emerald-300 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Chỉ Đang chạy
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-400">
          Hiển thị <strong>{processedCampaigns.length}</strong> chiến dịch Meta
        </div>
      </div>

      {/* Main Hierarchy Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-mono border-b border-slate-800 select-none">
            <tr>
              <th className="py-3 px-4 min-w-[240px]">Chiến dịch / Nhóm QC / Quảng cáo</th>
              <th
                onClick={() => handleSort("createdTime")}
                className="py-3 px-3 cursor-pointer hover:text-cyan-300 transition"
              >
                Ngày tạo {sortField === "createdTime" && (sortDirection === "desc" ? "↓" : "↑")}
              </th>
              <th className="py-3 px-3">Trạng thái</th>
              <th className="py-3 px-3">Ngân sách</th>
              <th
                onClick={() => handleSort("spend")}
                className="py-3 px-3 text-right cursor-pointer hover:text-cyan-300 transition"
              >
                Chi tiêu {sortField === "spend" && (sortDirection === "desc" ? "↓" : "↑")}
              </th>
              <th
                onClick={() => handleSort("purchases")}
                className="py-3 px-3 text-right cursor-pointer hover:text-cyan-300 transition"
              >
                Purchases {sortField === "purchases" && (sortDirection === "desc" ? "↓" : "↑")}
              </th>
              <th
                onClick={() => handleSort("cpa")}
                className="py-3 px-3 text-right cursor-pointer hover:text-cyan-300 transition"
              >
                CPA {sortField === "cpa" && (sortDirection === "desc" ? "↓" : "↑")}
              </th>
              <th
                onClick={() => handleSort("roas")}
                className="py-3 px-3 text-right cursor-pointer hover:text-cyan-300 transition"
              >
                ROAS {sortField === "roas" && (sortDirection === "desc" ? "↓" : "↑")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono text-xs">
            {processedCampaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                  Không tìm thấy chiến dịch nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              processedCampaigns.map((camp) => {
                const isExpanded = expandedCampaigns[camp.id];
                return (
                  <React.Fragment key={camp.id}>
                    {/* Campaign Level Row */}
                    <tr className="bg-slate-900/90 hover:bg-slate-850 transition">
                      <td className="py-3 px-4 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCampaign(camp.id)}
                          className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                        <span className="font-sans font-bold text-slate-100 flex items-center gap-1.5">
                          <span>📦</span>
                          <span>{camp.name}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                        {formatDate(camp.createdTime)}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            camp.status === "ACTIVE"
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {camp.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">${camp.dailyBudget || "—"}/ngày</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-100">${camp.spend}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-400">{camp.purchases}</td>
                      <td className="py-3 px-3 text-right text-cyan-300">${camp.cpa || "—"}</td>
                      <td className="py-3 px-3 text-right text-indigo-400 font-bold">{camp.roas || "—"}×</td>
                    </tr>

                    {/* Ad Sets & Ads */}
                    {isExpanded &&
                      (() => {
                        const sortedAdsets = [...camp.adsets].sort((a, b) => {
                          if (sortField === "createdTime") {
                            const timeA = a.createdTime ? new Date(a.createdTime).getTime() : 0;
                            const timeB = b.createdTime ? new Date(b.createdTime).getTime() : 0;
                            if (timeA !== timeB) return sortDirection === "desc" ? timeB - timeA : timeA - timeB;
                            return Number(b.spend) - Number(a.spend);
                          }
                          let valA = Number(a[sortField]) || 0;
                          let valB = Number(b[sortField]) || 0;
                          return sortDirection === "desc" ? valB - valA : valA - valB;
                        });

                        return sortedAdsets.map((adset) => {
                          const sortedAds = [...adset.ads].sort((a, b) => {
                            if (sortField === "createdTime") {
                              const timeA = a.createdTime ? new Date(a.createdTime).getTime() : 0;
                              const timeB = b.createdTime ? new Date(b.createdTime).getTime() : 0;
                              if (timeA !== timeB) return sortDirection === "desc" ? timeB - timeA : timeA - timeB;
                              return Number(b.spend) - Number(a.spend);
                            }
                            let valA = Number(a[sortField]) || 0;
                            let valB = Number(b[sortField]) || 0;
                            return sortDirection === "desc" ? valB - valA : valA - valB;
                          });

                          return (
                            <React.Fragment key={adset.id}>
                              {/* AdSet Row */}
                              <tr className="bg-slate-900/40 text-slate-300 hover:bg-slate-850/60 transition">
                                <td className="py-2.5 px-4 pl-9 flex items-center gap-2">
                                  <span className="text-blue-400 text-xs">📁</span>
                                  <span className="font-sans font-semibold text-slate-200">{adset.name}</span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 font-mono text-[10px]">
                                  {formatDate(adset.createdTime)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="text-[10px] text-slate-400">{adset.effectiveStatus}</span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-500">
                                  {adset.dailyBudget ? `$${adset.dailyBudget}/ngày` : "Thừa hưởng"}
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-200">${adset.spend}</td>
                                <td className="py-2.5 px-3 text-right text-emerald-400">{adset.purchases}</td>
                                <td className="py-2.5 px-3 text-right text-cyan-300">${adset.cpa || "—"}</td>
                                <td className="py-2.5 px-3 text-right text-indigo-400">{adset.roas || "—"}×</td>
                              </tr>

                              {/* Ads under AdSet */}
                              {sortedAds.map((ad) => (
                                <tr
                                  key={ad.id}
                                  className="bg-slate-950/60 text-slate-400 hover:bg-slate-900/60 transition text-[11px]"
                                >
                                  <td className="py-2 px-4 pl-14 flex items-center gap-2">
                                    <span className="text-slate-600">↳</span>
                                    <span className="text-slate-300">{ad.name}</span>
                                  </td>
                                  <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">
                                    {formatDate(ad.createdTime)}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="text-[9px] text-slate-500">{ad.effectiveStatus}</span>
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">—</td>
                                  <td className="py-2 px-3 text-right text-slate-300">${ad.spend}</td>
                                  <td className="py-2 px-3 text-right text-emerald-400">{ad.purchases}</td>
                                  <td className="py-2 px-3 text-right text-cyan-400">${ad.cpa || "—"}</td>
                                  <td className="py-2 px-3 text-right text-indigo-400">{ad.roas || "—"}×</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        });
                      })()}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
