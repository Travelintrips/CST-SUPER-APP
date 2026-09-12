/**
 * PPJK Phase 10 — AI Assistant (HS Code, duty estimation, compliance)
 */
import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Send, Bot, User } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "Rekomendasikan HS Code untuk komoditi ini",
  "Estimasi Bea Masuk, PPN, dan PPh untuk order ini",
  "Dokumen apa yang wajib untuk importasi ini?",
  "Cek risiko jalur merah untuk komoditi ini",
  "Simulasi tarif untuk undername impor",
];

interface Props {
  orderId: number;
}

export function PpjkAiAssistant({ orderId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: async (query: string) => {
      const r = await fetch(`/api/ppjk/orders/${orderId}/ai-assist`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "AI error");
      return data as { answer: string };
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: Error) => {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${e.message}` }]);
    },
  });

  function sendMessage(q?: string) {
    const query = q ?? input.trim();
    if (!query) return;
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    mutation.mutate(query);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Chat area */}
      <div className="min-h-[200px] max-h-[400px] overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <Sparkles className="w-8 h-8 text-blue-400" />
            <p className="text-sm font-medium text-muted-foreground">AI Customs Assistant</p>
            <p className="text-xs text-muted-foreground">Tanyakan tentang HS Code, estimasi bea masuk, dokumen, atau regulasi kepabeanan</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-blue-600" />
                </div>
              )}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-white border text-foreground rounded-bl-sm"
              }`}>
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
              {msg.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-white" />
                </div>
              )}
            </div>
          ))
        )}
        {mutation.isPending && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="bg-white border rounded-xl rounded-bl-sm px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="text-xs px-2.5 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Tanyakan tentang kepabeanan, HS Code, dokumen..."
          className="flex-1 text-sm"
          disabled={mutation.isPending}
        />
        <Button
          size="sm"
          onClick={() => sendMessage()}
          disabled={mutation.isPending || !input.trim()}
          className="gap-1.5"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
