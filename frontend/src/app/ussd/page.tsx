"use client";

import { useState } from "react";

export default function UssdPage() {
  const [step, setStep] = useState(0);
  const [screen, setScreen] = useState("Dial a USSD code to begin.\n\nExample: *384*NBC43#");
  const [input, setInput] = useState("");
  const [placeholder, setPlaceholder] = useState("*384*NBC43#");

  function reset() {
    setStep(0);
    setInput("");
    setPlaceholder("*384*NBC43#");
  }

  function send() {
    const val = input.trim();
    if (!val) return;

    // Initial dial
    if (step === 0 && val.startsWith("*") && val.endsWith("#")) {
      const match = val.match(/\*384\*(\w+)#/);
      if (!match) {
        setScreen("Invalid code. Try *384*NBC43#");
        setInput("");
        return;
      }
      const code = match[1].toUpperCase();
      setStep(1);
      setScreen(
        `Vehicle: ${code}\nRoute: CBD → Kasarani\nTo: Kasarani Stage\nFare: Ksh 60\n\n1. Pay now\n2. Cancel`
      );
      setInput("");
      setPlaceholder("Enter 1 or 2");
      return;
    }

    if (step === 1) {
      if (val === "2") {
        setScreen("Cancelled. No charge made.");
        reset();
        return;
      }
      if (val === "1") {
        setStep(2);
        setScreen("Enter your Safaricom number\n(e.g. 0712345678):");
        setInput("");
        setPlaceholder("0712345678");
        return;
      }
      setScreen("Invalid option.\n\n1. Pay now\n2. Cancel");
      setInput("");
      return;
    }

    if (step === 2) {
      setStep(3);
      setScreen(
        `Confirm payment:\nKsh 60 → Kasarani Stage\nPhone: ${val}\n\n1. Confirm\n2. Cancel`
      );
      setInput("");
      setPlaceholder("Enter 1 or 2");
      return;
    }

    if (step === 3) {
      if (val === "2") {
        setScreen("Cancelled. No charge made.");
        reset();
        return;
      }
      if (val === "1") {
        setScreen(
          "Ksh 60 payment initiated.\nEnter M-Pesa PIN on your phone.\nDo NOT close until complete.\n\n✓ Session ended"
        );
        reset();
        return;
      }
      setScreen("Invalid input.\n\n1. Confirm\n2. Cancel");
      setInput("");
      return;
    }

    setInput("");
  }

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <h1 className="text-xl font-bold mb-1">USSD Experience</h1>
      <p className="text-sm text-gray-500 mb-5">
        See how feature phone passengers pay &mdash; no internet needed
      </p>

      {/* Phone simulator */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-800 px-4 py-3 flex justify-between text-xs text-gray-400">
          <span>Safaricom 📶</span>
          <span>3:42 PM</span>
        </div>

        <pre className="bg-[#1A1A2E] text-[#00FF41] font-mono text-sm leading-relaxed p-5 min-h-[200px] whitespace-pre-wrap">
          {screen}
        </pre>

        <div className="bg-[#111] p-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={placeholder}
            className="flex-1 bg-[#0D0D1A] border border-gray-700 text-[#00FF41] font-mono px-3 py-2.5 rounded-md text-sm focus:outline-none focus:border-[#00FF41]"
          />
          <button
            onClick={send}
            className="bg-[#00FF41] text-[#1A1A2E] px-5 py-2.5 rounded-md font-bold text-sm cursor-pointer"
          >
            Send
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mt-4">
        <div className="font-semibold text-base mb-1">How it works</div>
        <div className="text-xs text-gray-500 mb-4">
          Any GSM phone, any network &mdash; no data needed
        </div>
        <div className="space-y-3">
          <Row label="Step 1" value="Dial *384*NBC43#" />
          <Row label="Step 2" value="See route & fare → Press 1" />
          <Row label="Step 3" value="Enter phone → Confirm (1)" />
          <Row label="Step 4" value="Enter M-Pesa PIN on phone" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
