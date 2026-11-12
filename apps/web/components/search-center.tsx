"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { searchResponseSchema, type SearchResult } from "@novel-brain/contracts";
import Link from "next/link";
import { useState } from "react";

import { apiErrorSchema } from "@novel-brain/contracts";

const sourceTypeLabels: Record<SearchResult["sourceType"], string> = {
  entity: "设定",
  fact: "已确认事实",
  timeline_event: "时间线",
  map_node: "地点",
  chapter: "章节",
  setting: "设定",
};

export function SearchCenter({
  workId,
  branchId,
}: Readonly<{ workId: string | undefined; branchId: string | undefined }>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"current" | "all">("current");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const enabled = true;

  async function search() {
    if (!query.trim() || (scope === "current" && (!workId || !branchId))) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        scope === "all"
          ? `/api/v1/search?q=${encodeURIComponent(query.trim())}&limit=20`
          : `/api/v1/works/${workId}/branches/${branchId}/search?q=${encodeURIComponent(query.trim())}&limit=20`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setResults(searchResponseSchema.parse(await response.json()).data);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="search-center">
      <button
        aria-expanded={open}
        aria-label="搜索"
        className="icon-btn small"
        disabled={!enabled}
        onClick={() => setOpen((value) => !value)}
        title={enabled ? "搜索" : "请先进入作品"}
        type="button"
      >
        <Search size={17} aria-hidden="true" />
      </button>
      {open ? (
        <section aria-label="全局搜索" className="search-popover">
          <div className="search-popover-head">
            <Search size={16} aria-hidden="true" />
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void search();
                }
              }}
              placeholder="搜索设定、事实、地点和时间线"
              value={query}
            />
            <button
              aria-label="关闭搜索"
              className="icon-btn small"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="row-actions search-scope">
            <button
              className={`btn small${scope === "current" ? " primary" : ""}`}
              disabled={!workId || !branchId}
              onClick={() => setScope("current")}
              type="button"
            >
              当前作品
            </button>
            <button
              className={`btn small${scope === "all" ? " primary" : ""}`}
              onClick={() => setScope("all")}
              type="button"
            >
              全部作品
            </button>
          </div>
          <button
            className="btn small"
            disabled={loading || !query.trim()}
            onClick={() => void search()}
            type="button"
          >
            {loading ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
            搜索
          </button>
          {error ? <div className="search-state error">{error}</div> : null}
          {!error && !loading && results.length === 0 ? (
            <div className="search-state">输入关键词开始搜索。</div>
          ) : null}
          <div className="search-results">
            {results.map((result) => (
              <Link
                href={searchResultHref(result)}
                key={`${result.workId}:${result.sourceType}:${result.sourceId}`}
                onClick={() => setOpen(false)}
              >
                <strong>{result.title}</strong>
                <span>{result.snippet || "无摘要"}</span>
                <small>{sourceTypeLabels[result.sourceType]}</small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function searchResultHref(result: SearchResult): string {
  return result.sourceType === "chapter" || result.sourceType === "fact"
    ? `/workspace/${result.workId}/write`
    : `/workspace/${result.workId}/settings`;
}

async function readError(response: Response): Promise<string> {
  try {
    return apiErrorSchema.parse(await response.json()).error.message;
  } catch {
    return `搜索失败（${response.status}）`;
  }
}
