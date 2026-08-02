"use client";

import { useEffect, useMemo, useState } from "react";
import rawData from "./findings.json";

type Axis = "x" | "y" | "width" | "height";

interface Mismatch {
  variant: string;
  path: string;
  axis: Axis;
  expected: number;
  actual: number;
  delta: number;
}

interface Finding {
  id: string;
  seed: number;
  index: number;
  mode: string;
  nodes: number;
  properties: string[];
  mismatches: Mismatch[];
  tree: unknown;
}

interface BatchData {
  generatedAt: string;
  batchCreatedAt: string;
  chrome: string;
  total: number;
  engineFixed: number;
  open: Finding[];
}

interface MarksResponse {
  marks?: Array<{ findingId: string; fixed: boolean }>;
  error?: string;
}

const data = rawData as BatchData;
const PAGE_SIZE = 80;

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function variantLabel(variant: string): string {
  return variant.replaceAll("_", " ").replace("box", "-box");
}

function maxDelta(finding: Finding): number {
  return Math.max(...finding.mismatches.map((mismatch) => Math.abs(mismatch.delta)));
}

function triageCommand(finding: Finding): string {
  return `pnpm fuzz-triage '${JSON.stringify(finding.tree)}'`;
}

export function MatrixDashboard() {
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [property, setProperty] = useState("all");
  const [mode, setMode] = useState("all");
  const [axis, setAxis] = useState("all");
  const [markFilter, setMarkFilter] = useState("unmarked");
  const [sort, setSort] = useState("delta");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [copied, setCopied] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading saved marks…");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marks")
      .then(async (response) => {
        const body = (await response.json()) as MarksResponse;
        if (!response.ok) throw new Error(body.error ?? "Could not load marks");
        if (cancelled) return;
        setMarks(new Set((body.marks ?? []).filter((mark) => mark.fixed).map((mark) => mark.findingId)));
        setStatusMessage("Marks are synced");
      })
      .catch(() => {
        if (!cancelled) setStatusMessage("Saved marks are temporarily unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const propertyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const finding of data.open) {
      for (const name of finding.properties) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const modeOptions = useMemo(() => [...new Set(data.open.map((finding) => finding.mode))].sort(), []);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const result = data.open.filter((finding) => {
      if (property !== "all" && !finding.properties.includes(property)) return false;
      if (mode !== "all" && finding.mode !== mode) return false;
      if (axis !== "all" && !finding.mismatches.some((mismatch) => mismatch.axis === axis)) return false;
      const isMarked = marks.has(finding.id);
      if (markFilter === "marked" && !isMarked) return false;
      if (markFilter === "unmarked" && isMarked) return false;
      if (!normalized) return true;
      const haystack = [
        finding.id,
        finding.mode,
        ...finding.properties,
        ...finding.mismatches.flatMap((mismatch) => [mismatch.variant, mismatch.path, mismatch.axis]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });

    return result.sort((a, b) => {
      if (sort === "mismatches") return b.mismatches.length - a.mismatches.length || a.id.localeCompare(b.id);
      if (sort === "id") return a.id.localeCompare(b.id);
      return maxDelta(b) - maxDelta(a) || b.mismatches.length - a.mismatches.length;
    });
  }, [axis, markFilter, marks, mode, property, search, sort]);

  function updateView(setter: (value: string) => void, value: string): void {
    setter(value);
    setVisibleCount(PAGE_SIZE);
  }

  async function toggleMark(findingId: string): Promise<void> {
    const nextFixed = !marks.has(findingId);
    const previous = new Set(marks);
    const next = new Set(marks);
    if (nextFixed) next.add(findingId);
    else next.delete(findingId);
    setMarks(next);
    setPending((current) => new Set(current).add(findingId));

    try {
      const response = await fetch("/api/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, fixed: nextFixed }),
      });
      const body = (await response.json()) as MarksResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not save mark");
      setStatusMessage("Marks are synced");
    } catch {
      setMarks(previous);
      setStatusMessage("That mark was not saved — try again");
    } finally {
      setPending((current) => {
        const updated = new Set(current);
        updated.delete(findingId);
        return updated;
      });
    }
  }

  function toggleExpanded(findingId: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }

  async function copyCommand(finding: Finding): Promise<void> {
    await navigator.clipboard.writeText(triageCommand(finding));
    setCopied(finding.id);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const enginePercent = Math.round((data.engineFixed / data.total) * 100);
  const markedPercent = data.open.length === 0 ? 100 : Math.round((marks.size / data.open.length) * 100);
  const visible = filtered.slice(0, visibleCount);
  const generated = new Date(data.generatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main>
      <header className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-inner">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            bento-layout · frozen Chrome batch
          </div>
          <div className="hero-heading">
            <div>
              <h1>Fuzz batch matrix</h1>
              <p>
                Every remaining geometry disagreement, with Chrome’s frozen verdict beside the engine result.
              </p>
            </div>
            <div className="snapshot-chip">
              <span>Snapshot</span>
              <strong>{generated}</strong>
            </div>
          </div>

          <section className="stats" aria-label="Batch progress">
            <article>
              <span>Frozen target</span>
              <strong>{data.total}</strong>
              <small>{data.chrome}</small>
            </article>
            <article>
              <span>Engine fixed</span>
              <strong>{data.engineFixed}</strong>
              <small>{enginePercent}% of the batch</small>
            </article>
            <article className="stat-open">
              <span>Open in snapshot</span>
              <strong>{data.open.length}</strong>
              <small>Expected ≠ actual</small>
            </article>
            <article className="stat-marked">
              <span>Marked fixed</span>
              <strong>{marks.size}</strong>
              <small>{markedPercent}% of open · {statusMessage}</small>
            </article>
          </section>

          <div className="progress-rail" aria-label={`${enginePercent}% engine fixed`}>
            <span style={{ width: `${enginePercent}%` }} />
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="toolbar">
          <label className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Search findings</span>
            <input
              value={search}
              onChange={(event) => updateView(setSearch, event.target.value)}
              placeholder="Search ID, property, path, axis…"
            />
            {search && (
              <button type="button" onClick={() => updateView(setSearch, "")} aria-label="Clear search">×</button>
            )}
          </label>

          <label>
            <span>Property</span>
            <select value={property} onChange={(event) => updateView(setProperty, event.target.value)}>
              <option value="all">All properties</option>
              {propertyOptions.map(([name, count]) => (
                <option key={name} value={name}>{name} · {count}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Mode</span>
            <select value={mode} onChange={(event) => updateView(setMode, event.target.value)}>
              <option value="all">All modes</option>
              {modeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label>
            <span>Axis</span>
            <select value={axis} onChange={(event) => updateView(setAxis, event.target.value)}>
              <option value="all">All axes</option>
              <option value="x">x</option>
              <option value="y">y</option>
              <option value="width">width</option>
              <option value="height">height</option>
            </select>
          </label>

          <label>
            <span>Sort</span>
            <select value={sort} onChange={(event) => updateView(setSort, event.target.value)}>
              <option value="delta">Largest delta</option>
              <option value="mismatches">Most mismatches</option>
              <option value="id">Finding ID</option>
            </select>
          </label>
        </div>

        <div className="result-bar">
          <div className="segmented" aria-label="Mark filter">
            <button className={markFilter === "unmarked" ? "active" : ""} onClick={() => updateView(setMarkFilter, "unmarked")}>
              To verify <span>{data.open.length - marks.size}</span>
            </button>
            <button className={markFilter === "marked" ? "active" : ""} onClick={() => updateView(setMarkFilter, "marked")}>
              Marked <span>{marks.size}</span>
            </button>
            <button className={markFilter === "all" ? "active" : ""} onClick={() => updateView(setMarkFilter, "all")}>
              All <span>{data.open.length}</span>
            </button>
          </div>
          <p><strong>{filtered.length}</strong> findings match</p>
        </div>

        <div className="matrix-shell">
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="mark-column">Fixed</th>
                  <th>Finding</th>
                  <th>Properties</th>
                  <th>Mismatch</th>
                  <th className="numeric expected-heading">Chrome expected</th>
                  <th className="numeric actual-heading">Engine actual</th>
                  <th className="numeric">Δ</th>
                  <th><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((finding) => {
                  const primary = finding.mismatches[0] as Mismatch;
                  const isMarked = marks.has(finding.id);
                  const isExpanded = expanded.has(finding.id);
                  return (
                    <FindingRows
                      key={finding.id}
                      finding={finding}
                      primary={primary}
                      isMarked={isMarked}
                      isPending={pending.has(finding.id)}
                      isExpanded={isExpanded}
                      copied={copied === finding.id}
                      onToggleMark={() => void toggleMark(finding.id)}
                      onToggleExpanded={() => toggleExpanded(finding.id)}
                      onCopy={() => void copyCommand(finding)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="empty-state">
              <strong>No findings match these filters.</strong>
              <span>Clear a filter or switch the mark view.</span>
            </div>
          )}

          {visibleCount < filtered.length && (
            <button className="load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
            </button>
          )}
        </div>

        <footer>
          <p>Frozen verdict: {data.chrome} · {new Date(data.batchCreatedAt).toLocaleDateString()}</p>
          <p>Checkboxes track verification; regenerate the snapshot after engine fixes to refresh actual geometry.</p>
        </footer>
      </section>
    </main>
  );
}

interface FindingRowsProps {
  finding: Finding;
  primary: Mismatch;
  isMarked: boolean;
  isPending: boolean;
  isExpanded: boolean;
  copied: boolean;
  onToggleMark: () => void;
  onToggleExpanded: () => void;
  onCopy: () => void;
}

function FindingRows({
  finding,
  primary,
  isMarked,
  isPending,
  isExpanded,
  copied,
  onToggleMark,
  onToggleExpanded,
  onCopy,
}: FindingRowsProps) {
  return (
    <>
      <tr className={`${isMarked ? "marked-row" : ""} ${isExpanded ? "expanded-row" : ""}`}>
        <td className="mark-cell">
          <label className="check-wrap">
            <input
              type="checkbox"
              checked={isMarked}
              disabled={isPending}
              onChange={onToggleMark}
              aria-label={`Mark ${finding.id} fixed`}
            />
            <span aria-hidden="true">✓</span>
          </label>
        </td>
        <td>
          <button type="button" className="finding-id" onClick={onToggleExpanded}>{finding.id}</button>
          <div className="finding-meta">
            <span className={`mode mode-${finding.mode}`}>{finding.mode}</span>
            <span>{finding.nodes} {finding.nodes === 1 ? "node" : "nodes"}</span>
            <span>{finding.mismatches.length} {finding.mismatches.length === 1 ? "diff" : "diffs"}</span>
          </div>
        </td>
        <td>
          <div className="property-list">
            {finding.properties.slice(0, 3).map((name) => <span key={name}>{name}</span>)}
            {finding.properties.length > 3 && <span className="more-tag">+{finding.properties.length - 3}</span>}
          </div>
        </td>
        <td>
          <div className="mismatch-place">
            <strong>{primary.path} · {primary.axis}</strong>
            <span>{variantLabel(primary.variant)}</span>
            {finding.mismatches.length > 1 && <small>+{finding.mismatches.length - 1} more</small>}
          </div>
        </td>
        <td className="numeric expected-value">{formatNumber(primary.expected)}</td>
        <td className="numeric actual-value">{formatNumber(primary.actual)}</td>
        <td className={`numeric delta-value ${primary.delta > 0 ? "positive" : "negative"}`}>
          {primary.delta > 0 ? "+" : ""}{formatNumber(primary.delta)}
        </td>
        <td className="expand-cell">
          <button
            type="button"
            className="expand-button"
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${finding.id}`}
          >
            {isExpanded ? "−" : "+"}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="detail-row">
          <td colSpan={8}>
            <div className="detail-panel">
              <div className="detail-heading">
                <div>
                  <span>Complete mismatch matrix</span>
                  <strong>{finding.mismatches.length} geometry checks differ</strong>
                </div>
                <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy triage command"}</button>
              </div>
              <div className="detail-table-wrap">
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>Variant</th>
                      <th>Node path</th>
                      <th>Axis</th>
                      <th className="numeric">Chrome expected</th>
                      <th className="numeric">Engine actual</th>
                      <th className="numeric">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finding.mismatches.map((mismatch, index) => (
                      <tr key={`${mismatch.variant}-${mismatch.path}-${mismatch.axis}-${index}`}>
                        <td>{variantLabel(mismatch.variant)}</td>
                        <td><code>{mismatch.path}</code></td>
                        <td><code>{mismatch.axis}</code></td>
                        <td className="numeric expected-value">{formatNumber(mismatch.expected)}</td>
                        <td className="numeric actual-value">{formatNumber(mismatch.actual)}</td>
                        <td className="numeric delta-value">
                          {mismatch.delta > 0 ? "+" : ""}{formatNumber(mismatch.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <code className="triage-command">{triageCommand(finding)}</code>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
