import type { ReactNode } from "react";

type ActorKey = "client" | "api" | "thirdweb" | "berachain";

const ACTOR_COL: Record<ActorKey, number> = {
  client: 1,
  api: 2,
  thirdweb: 3,
  berachain: 4,
};

type MessageProps = {
  from: ActorKey;
  to: ActorKey;
  label: string;
  dashed?: boolean;
};

function Message({ from, to, label, dashed }: MessageProps) {
  const fromCol = ACTOR_COL[from];
  const toCol = ACTOR_COL[to];
  const start = Math.min(fromCol, toCol);
  const end = Math.max(fromCol, toCol);
  const direction = fromCol < toCol ? "right" : "left";

  return (
    <div className="seq-row">
      <div
        className={`seq-msg seq-msg-${direction}${dashed ? " dashed" : ""}`}
        style={{ gridColumn: `${start} / ${end + 1}` }}
      >
        <span className="seq-msg-label">{label}</span>
        <span className="seq-msg-arrow" />
      </div>
    </div>
  );
}

type SelfMessageProps = {
  at: ActorKey;
  label: string;
  dashed?: boolean;
};

function SelfMessage({ at, label, dashed }: SelfMessageProps) {
  return (
    <div className="seq-row">
      <div
        className={`seq-self${dashed ? " dashed" : ""}`}
        style={{ gridColumn: ACTOR_COL[at] }}
      >
        <span className="seq-self-loop" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

type AltBranch = {
  label: string;
  children: ReactNode;
};

function AltBlock({ branches }: { branches: AltBranch[] }) {
  return (
    <div className="seq-alt">
      {branches.map((branch, index) => (
        <div key={branch.label} className="seq-alt-branch">
          <div className="seq-alt-label">
            <span className="seq-alt-keyword">
              {index === 0 ? "alt" : "else"}
            </span>
            {branch.label}
          </div>
          <div className="seq-alt-body">{branch.children}</div>
        </div>
      ))}
    </div>
  );
}

export function SequenceDiagram() {
  return (
    <div className="seq-diagram">
      <div className="seq-scroll">
        <div className="seq-actors">
          <div className="seq-actor seq-actor-client">
            <strong>Client</strong>
            <span>frontend</span>
          </div>
          <div className="seq-actor seq-actor-api">
            <strong>API server</strong>
            <span>x402 endpoint</span>
          </div>
          <div className="seq-actor seq-actor-thirdweb">
            <strong>Thirdweb</strong>
            <span>wallet + facilitator</span>
          </div>
          <div className="seq-actor seq-actor-berachain">
            <strong>Berachain</strong>
            <span>HONEY ERC-20</span>
          </div>
        </div>

        <div className="seq-body">
          <div className="seq-lifelines" aria-hidden="true">
            <div />
            <div />
            <div />
            <div />
          </div>

          <Message from="client" to="api" label="GET /data" />
          <Message
            from="api"
            to="client"
            label="402 + payment required (amount, recipient, HONEY)"
            dashed
          />

          <SelfMessage at="client" label="evaluate price vs threshold" />

          <AltBlock
            branches={[
              {
                label: "approved",
                children: (
                  <>
                    <Message
                      from="client"
                      to="thirdweb"
                      label="signAndSendTransaction(recipient, amount)"
                    />
                    <Message
                      from="thirdweb"
                      to="berachain"
                      label="broadcast HONEY ERC-20 transfer"
                    />
                    <Message
                      from="berachain"
                      to="thirdweb"
                      label="tx confirmed + txHash"
                      dashed
                    />
                    <Message
                      from="thirdweb"
                      to="client"
                      label="txHash"
                      dashed
                    />

                    <Message
                      from="client"
                      to="api"
                      label="GET /data + X-Payment-Token: txHash"
                    />
                    <Message from="api" to="thirdweb" label="verify txHash" />
                    <Message
                      from="thirdweb"
                      to="berachain"
                      label="confirm tx on-chain"
                    />
                    <Message
                      from="berachain"
                      to="thirdweb"
                      label="valid"
                      dashed
                    />
                    <Message
                      from="thirdweb"
                      to="api"
                      label="confirmed"
                      dashed
                    />
                    <Message
                      from="api"
                      to="client"
                      label="200 OK + data payload"
                      dashed
                    />
                  </>
                ),
              },
              {
                label: "rejected",
                children: (
                  <SelfMessage
                    at="client"
                    label="show confirmation dialog"
                    dashed
                  />
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
