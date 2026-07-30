import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { jakarta, manrope } from "../fonts";
import { theme } from "../theme";

type MetricProps = {
  value: string;
  label: string;
  delay?: number;
};

const Metric: React.FC<MetricProps> = ({ value, label, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const y = interpolate(progress, [0, 1], [16, 0]);

  return (
    <div style={{ opacity, transform: `translateY(${y}px)`, flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: manrope, fontWeight: 800, fontSize: 34, color: theme.ink }}>{value}</div>
      <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 16, color: theme.muted }}>{label}</div>
    </div>
  );
};

type CheckItemProps = {
  text: string;
  delay?: number;
};

export const CheckItem: React.FC<CheckItemProps> = ({ text, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const x = interpolate(progress, [0, 1], [-18, 0]);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, opacity, transform: `translateX(${x}px)` }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: "rgba(126,198,154,0.18)",
          color: theme.green,
          display: "grid",
          placeItems: "center",
          fontFamily: manrope,
          fontWeight: 800,
          fontSize: 20,
          flexShrink: 0
        }}
      >
        ✓
      </div>
      <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 24, lineHeight: 1.35, color: theme.ink, paddingTop: 2 }}>
        {text}
      </div>
    </div>
  );
};

type DashboardMockProps = {
  startFrame?: number;
};

export const DashboardMock: React.FC<DashboardMockProps> = ({ startFrame = 0 }) => (
  <div
    style={{
      width: "100%",
      maxWidth: 680,
      margin: "0 auto",
      background: theme.panel,
      borderRadius: 28,
      border: `1px solid ${theme.line}`,
      boxShadow: theme.shadow,
      overflow: "hidden"
    }}
  >
    <div style={{ display: "flex", minHeight: 360 }}>
      <div
        style={{
          width: 72,
          background: "#fbfaff",
          borderRight: `1px solid ${theme.line}`,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12
        }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${theme.blue}, ${theme.lavenderStrong})` }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 10, borderRadius: 999, background: i === 0 ? theme.blue : theme.line, opacity: i === 0 ? 1 : 0.7 }} />
        ))}
      </div>
      <div style={{ flex: 1, padding: 22 }}>
        <div style={{ height: 12, width: "42%", borderRadius: 999, background: theme.line, marginBottom: 18 }} />
        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
          <Metric value="28" label="Leads today" delay={startFrame + 6} />
          <Metric value="11" label="Hot leads" delay={startFrame + 12} />
          <Metric value="7" label="Pending quotes" delay={startFrame + 18} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
          <div style={{ borderRadius: 18, background: "#fbfaff", border: `1px solid ${theme.line}`, padding: 18, minHeight: 120 }}>
            <div style={{ fontFamily: manrope, fontWeight: 800, fontSize: 18, color: theme.ink, marginBottom: 8 }}>Quotation-ready</div>
            <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 20, color: theme.ink }}>Colored copier rental</div>
            <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 16, color: theme.muted, marginTop: 6 }}>Cainta · hot lead</div>
          </div>
          <div style={{ borderRadius: 18, background: "rgba(126,198,154,0.12)", border: `1px solid rgba(126,198,154,0.25)`, padding: 18, minHeight: 120 }}>
            <div style={{ fontFamily: manrope, fontWeight: 800, fontSize: 18, color: theme.ink, marginBottom: 8 }}>Needs approval</div>
            <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 20, color: theme.ink }}>Q-2026-00014</div>
            <div style={{ fontFamily: jakarta, fontWeight: 600, fontSize: 16, color: theme.muted, marginTop: 6 }}>Owner review</div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
