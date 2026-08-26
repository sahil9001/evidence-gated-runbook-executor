"use client";

import { useState, type KeyboardEvent } from "react";
import { Tag, X } from "lucide-react";

interface SignalTagInputProps {
  readonly signals: readonly string[];
  readonly onChange: (signals: string[]) => void;
  readonly suggestions?: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * A tag-style input for incident signals: type a signal, press Enter or
 * comma to add it as a chip, Backspace on an empty field pops the last one.
 * Free text rather than a fixed checkbox set — signals aren't a closed
 * vocabulary the frontend owns, they're whatever an operator observed, so
 * `suggestions` (drawn from known runbook triggers) only assists via a
 * datalist, it never constrains input.
 */
export function SignalTagInput({ signals, onChange, suggestions = [] }: SignalTagInputProps) {
  const [draft, setDraft] = useState("");

  function commitDraft(): void {
    const normalized = normalize(draft);
    setDraft("");
    if (normalized.length === 0) return;
    if (signals.includes(normalized)) return;
    onChange([...signals, normalized]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && signals.length > 0) {
      onChange(signals.slice(0, -1));
    }
  }

  function removeSignal(signal: string): void {
    onChange(signals.filter((existing) => existing !== signal));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition focus-within:border-signal focus-within:ring-2 focus-within:ring-signal/30">
        {signals.map((signal) => (
          <span
            key={signal}
            className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-xs font-semibold text-signal"
          >
            <Tag className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {signal}
            <button
              type="button"
              onClick={() => removeSignal(signal)}
              aria-label={`Remove signal ${signal}`}
              className="ml-0.5 rounded-full p-0.5 text-signal/70 transition hover:bg-signal/10 hover:text-signal"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          placeholder={signals.length === 0 ? "Add a signal (e.g. timeout) and press Enter" : "Add another…"}
          aria-label="Add a signal"
          list="known-signal-suggestions"
          className="min-w-[140px] flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-neutral-400"
        />
      </div>
      <datalist id="known-signal-suggestions">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </div>
  );
}
