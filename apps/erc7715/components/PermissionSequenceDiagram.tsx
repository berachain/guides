"use client";

import { useId } from "react";

/**
 * Phase 2 sequence: DApp → provider → wallet → user approval → response.
 * Inline SVG (~300px tall) for use beside the request form.
 */
export function PermissionSequenceDiagram() {
  const rid = useId().replace(/:/g, "");
  const arrowId = `${rid}-arrowhead`;

  return (
    <figure className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] p-3 text-zinc-300">
      <svg
        aria-label="Sequence diagram for wallet_requestExecutionPermissions"
        className="h-[300px] w-full max-w-full"
        role="img"
        viewBox="0 0 420 300"
      >
        <defs>
          <marker
            id={arrowId}
            markerHeight="7"
            markerWidth="10"
            orient="auto"
            refX="9"
            refY="3.5"
          >
            <polygon fill="currentColor" points="0 0, 10 3.5, 0 7" />
          </marker>
        </defs>

        <text className="fill-zinc-100 text-[11px] font-semibold" x="8" y="22">
          DApp
        </text>
        <line
          className="stroke-[#2A2A2A]"
          x1="40"
          x2="40"
          y1="28"
          y2="280"
          strokeWidth="1"
        />

        <text
          className="fill-zinc-100 text-[11px] font-semibold"
          x="100"
          y="22"
        >
          window.ethereum
        </text>
        <line
          className="stroke-[#2A2A2A]"
          x1="150"
          x2="150"
          y1="28"
          y2="280"
          strokeWidth="1"
        />

        <text
          className="fill-zinc-100 text-[11px] font-semibold"
          x="200"
          y="22"
        >
          Wallet
        </text>
        <line
          className="stroke-[#2A2A2A]"
          x1="230"
          x2="230"
          y1="28"
          y2="280"
          strokeWidth="1"
        />

        <text
          className="fill-zinc-100 text-[11px] font-semibold"
          x="280"
          y="22"
        >
          User
        </text>
        <line
          className="stroke-[#2A2A2A]"
          x1="300"
          x2="300"
          y1="28"
          y2="280"
          strokeWidth="1"
        />

        <path
          className="fill-none stroke-[#F5A623] stroke-[1.5]"
          d="M 40 52 L 150 52"
          markerEnd={`url(#${arrowId})`}
        />
        <text className="fill-zinc-400 text-[9px]" x="44" y="46">
          request()
        </text>
        <text className="fill-zinc-500 text-[8px]" x="44" y="64">
          method: wallet_requestExecutionPermissions
        </text>
        <text className="fill-zinc-500 text-[8px]" x="44" y="76">
          params: PermissionRequest[] (JSON-RPC array)
        </text>

        <path
          className="fill-none stroke-[#F5A623] stroke-[1.5]"
          d="M 150 96 L 230 96"
          markerEnd={`url(#${arrowId})`}
        />
        <text className="fill-zinc-400 text-[9px]" x="158" y="90">
          forward JSON-RPC
        </text>

        <path
          className="fill-none stroke-zinc-400 stroke-[1.5]"
          d="M 230 130 L 300 130"
          markerEnd={`url(#${arrowId})`}
        />
        <text className="fill-zinc-400 text-[9px]" x="238" y="124">
          prompt: rules + permission + to
        </text>

        <path
          className="fill-none stroke-zinc-400 stroke-[1.5]"
          d="M 300 168 L 230 168"
          markerEnd={`url(#${arrowId})`}
          strokeDasharray="4 3"
        />
        <text className="fill-zinc-400 text-[9px]" x="238" y="162">
          approve / reject (4001)
        </text>

        <path
          className="fill-none stroke-[#22C55E] stroke-[1.5]"
          d="M 230 206 L 150 206"
          markerEnd={`url(#${arrowId})`}
        />
        <text className="fill-zinc-400 text-[9px]" x="158" y="200">
          result: PermissionResponse[]
        </text>

        <path
          className="fill-none stroke-[#22C55E] stroke-[1.5]"
          d="M 150 240 L 40 240"
          markerEnd={`url(#${arrowId})`}
        />
        <text className="fill-zinc-400 text-[9px]" x="48" y="234">
          Promise resolves
        </text>
        <text className="fill-zinc-500 text-[8px]" x="48" y="252">
          + context, delegationManager, dependencies[]
        </text>

        <text className="fill-zinc-400 text-[8px] italic" x="8" y="292">
          Payload shape per ERC-7715 (chainId, to, permission, rules?)
        </text>
      </svg>
    </figure>
  );
}
