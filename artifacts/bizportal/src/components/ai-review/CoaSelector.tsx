/**
 * CoaSelector — searchable COA picker for the Change COA dialog.
 *
 * When `candidates` are supplied (from the AI recommendation), the user can
 * pick directly from the ranked list or type a custom code.  Falls back to
 * free-text entry when no candidates are present.
 *
 * No hardcoded COA values — all values come from the caller.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { confidencePct } from "@/lib/ai-review-api";
import type { AICoaCandidate } from "@/lib/ai-review-api";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CoaSelectorProps {
  /** AI-ranked candidate list from the review detail. */
  candidates?: AICoaCandidate[];
  /** Controlled COA code value. */
  coaCode: string;
  /** Controlled COA name value. */
  coaName: string;
  onCoaCodeChange: (code: string) => void;
  onCoaNameChange: (name: string) => void;
}

export function CoaSelector({
  candidates,
  coaCode,
  coaName,
  onCoaCodeChange,
  onCoaNameChange,
}: CoaSelectorProps) {
  const [showCandidates, setShowCandidates] = useState(
    candidates && candidates.length > 0
  );

  const selectCandidate = (c: AICoaCandidate) => {
    onCoaCodeChange(c.coaCode);
    onCoaNameChange(c.coaName ?? "");
    setShowCandidates(false);
  };

  return (
    <div className="space-y-2">
      {/* Manual entry */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Kode COA <span className="text-red-500">*</span>
        </label>
        <Input
          value={coaCode}
          onChange={(e) => onCoaCodeChange(e.target.value)}
          placeholder="Mis. 5-1100"
          className="h-8 text-sm font-mono"
          aria-label="Kode COA"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Nama COA
        </label>
        <Input
          value={coaName}
          onChange={(e) => onCoaNameChange(e.target.value)}
          placeholder="Nama akun..."
          className="h-8 text-sm"
          aria-label="Nama COA"
        />
      </div>

      {/* Candidate shortlist */}
      {candidates && candidates.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors"
            onClick={() => setShowCandidates((v) => !v)}
          >
            {showCandidates ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showCandidates ? "Sembunyikan" : "Pilih dari rekomendasi AI"}
          </button>

          {showCandidates && (
            <div className="mt-1.5 border rounded overflow-hidden divide-y">
              {candidates.map((c, i) => (
                <Button
                  key={i}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-3 py-2 h-auto text-left rounded-none"
                  onClick={() => selectCandidate(c)}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-mono text-xs w-16 shrink-0">{c.coaCode}</span>
                    <span className="text-xs flex-1 text-muted-foreground">{c.coaName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {confidencePct(c.confidence)}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
