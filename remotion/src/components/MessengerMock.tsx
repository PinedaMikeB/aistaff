import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { jakarta } from "../fonts";
import { theme } from "../theme";

type BubbleProps = {
  text: string;
  side: "left" | "right";
  delay?: number;
  danger?: boolean;
};

const Bubble: React.FC<BubbleProps> = ({ text, side, delay = 0, danger = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [0.92, 1]);

  return (
    <div
      style={{
        alignSelf: side === "left" ? "flex-start" : "flex-end",
        maxWidth: "82%",
        opacity,
        transform: `scale(${scale})`
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderRadius: side === "left" ? "18px 18px 18px 6px" : "18px 18px 6px 18px",
          background: side === "left" ? theme.panel : danger ? "#fff0f4" : theme.blue,
          color: side === "left" ? theme.ink : danger ? theme.rose : "#fff",
          border: danger ? `1px solid rgba(217,95,131,0.25)` : "none",
          boxShadow: theme.shadow.replace("0.14", "0.08"),
          fontFamily: jakarta,
          fontWeight: 600,
          fontSize: 24,
          lineHeight: 1.35
        }}
      >
        {text}
      </div>
    </div>
  );
};

type MessengerMockProps = {
  startFrame?: number;
  layout?: "compact" | "tall";
};

export const MessengerMock: React.FC<MessengerMockProps> = ({ startFrame = 0, layout = "compact" }) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - startFrame);
  const seenPulse = interpolate(local, [60, 75, 90], [1, 1.06, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        maxWidth: layout === "tall" ? 560 : 620,
        margin: "0 auto",
        background: theme.panel,
        borderRadius: 28,
        border: `1px solid ${theme.line}`,
        boxShadow: theme.shadow,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${theme.line}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: theme.panelSoft
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: theme.blue }} />
        <div style={{ fontFamily: jakarta, fontWeight: 700, fontSize: 22, color: theme.ink }}>Facebook Messenger</div>
      </div>
      <div
        style={{
          padding: 24,
          minHeight: layout === "tall" ? 420 : 280,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          background: "linear-gradient(180deg, #faf9ff 0%, #ffffff 100%)"
        }}
      >
        <Bubble text="Magkano po ang copier rental?" side="left" delay={startFrame + 8} />
        <Bubble text="Saan po ang office location ninyo?" side="right" delay={startFrame + 28} />
        <Bubble text="Cainta po. May colored option?" side="left" delay={startFrame + 48} />
        <div
          style={{
            alignSelf: "flex-end",
            transform: `scale(${seenPulse})`,
            marginTop: 8,
            padding: "10px 16px",
            borderRadius: 999,
            background: "#fff0f4",
            border: `1px solid rgba(217,95,131,0.25)`,
            color: theme.rose,
            fontFamily: jakarta,
            fontWeight: 700,
            fontSize: 20
          }}
        >
          Seen · 2 hours ago
        </div>
      </div>
    </div>
  );
};

