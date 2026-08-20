import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { BrandLogo, BodyText, Headline } from "../components/Brand";
import { jakarta, manrope } from "../fonts";
import { closerKnowledgeScenes, type CloserKnowledgeScene } from "../data/closerKnowledgeExplainer";
import { FPS, theme } from "../theme";

type ExplainerProps = {
  layout: "landscape" | "story";
  withVoiceover?: boolean;
};

const dark = {
  bg: "#030a12",
  card: "#0b2232",
  cardSoft: "#102c40",
  line: "#1f6b95",
  cyan: "#39c6ff",
  cyanSoft: "#b9efff",
  muted: "#91afbf",
  white: "#f6fbff"
};

const getSceneStartFrame = (index: number) =>
  Math.round(
    closerKnowledgeScenes
      .slice(0, index)
      .reduce((total, scene) => total + scene.durationSeconds, 0) * FPS
  );

const SceneBackground: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(circle at 76% 22%, rgba(31,107,149,0.42), transparent 34%), radial-gradient(circle at 12% 84%, rgba(57,198,255,0.18), transparent 32%), linear-gradient(135deg, #02060d 0%, #061623 58%, #030a12 100%)"
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "linear-gradient(rgba(57,198,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(57,198,255,0.045) 1px, transparent 1px)",
        backgroundSize: "96px 96px",
        maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), rgba(0,0,0,0.35))"
      }}
    />
  </AbsoluteFill>
);

const FloatingDot: React.FC<{ x: number; y: number; delay: number; size?: number }> = ({ x, y, delay, size = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = interpolate(
    Math.sin(((frame - delay) / fps) * Math.PI),
    [-1, 1],
    [0.45, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: 999,
        background: dark.cyan,
        opacity: pulse,
        boxShadow: `0 0 ${size * 2}px ${dark.cyan}`
      }}
    />
  );
};

const MiniWorkspace: React.FC<{ scene: CloserKnowledgeScene; layout: "landscape" | "story" }> = ({ scene, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 180 } });
  const cardY = interpolate(progress, [0, 1], [36, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  const sections = {
    brain: ["Platform prompt", "Tenant knowledge", "Approved media", "Closer replies"],
    workspace: ["Dashboard", "Knowledge Base", "AI Studio", "Inquiries"],
    identity: ["Company profile", "Contact details", "Service area", "Ideal lead"],
    pricing: ["Products", "Prices", "Promos", "Never invent"],
    media: ["Photos", "Posters", "Price cards", "PDFs"],
    rules: ["Tone", "Language", "Qualification", "Handoff"],
    channels: ["Messenger", "Website chat", "Same source", "Latest update"],
    loop: ["Edit knowledge", "Test Closer", "Review leads", "Improve answers"]
  }[scene.visual];

  return (
    <div
      style={{
        opacity,
        translate: `0 ${cardY}px`,
        width: layout === "story" ? "100%" : 700,
        minHeight: layout === "story" ? 520 : 610,
        borderRadius: 32,
        border: `1px solid rgba(57,198,255,0.34)`,
        background: "linear-gradient(145deg, rgba(16,44,64,0.96), rgba(4,16,26,0.94))",
        boxShadow: "0 30px 90px rgba(0,0,0,0.45)",
        padding: 34,
        position: "relative",
        overflow: "hidden"
      }}
    >
      <FloatingDot x={42} y={44} delay={4} size={14} />
      <FloatingDot x={layout === "story" ? 560 : 610} y={96} delay={12} size={10} />
      <FloatingDot x={layout === "story" ? 480 : 520} y={layout === "story" ? 420 : 508} delay={22} size={8} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          paddingBottom: 26,
          borderBottom: "1px solid rgba(185,239,255,0.14)"
        }}
      >
        <div style={{ fontFamily: manrope, color: dark.white, fontWeight: 800, fontSize: 30 }}>AIStaff workspace</div>
        <div
          style={{
            fontFamily: jakarta,
            color: dark.cyanSoft,
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: 2,
            textTransform: "uppercase"
          }}
        >
          {scene.eyebrow}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 22, paddingTop: 30 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {["Dashboard", "Knowledge Base", "AI Studio", "Settings"].map((item) => (
            <div
              key={item}
              style={{
                height: 48,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                paddingLeft: 16,
                fontFamily: jakarta,
                fontWeight: 800,
                fontSize: 17,
                color: item === "Knowledge Base" || scene.visual === "rules" && item === "AI Studio" ? "#07111a" : dark.cyanSoft,
                background: item === "Knowledge Base" || scene.visual === "rules" && item === "AI Studio" ? "linear-gradient(135deg, #b9efff, #39c6ff)" : "rgba(255,255,255,0.06)",
                border: "1px solid rgba(185,239,255,0.12)"
              }}
            >
              {item}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontFamily: manrope,
              fontSize: 28,
              fontWeight: 800,
              color: dark.white,
              marginBottom: 2
            }}
          >
            {scene.title}
          </div>
          {sections.map((item, index) => {
            const rowProgress = spring({
              frame: frame - 8 - index * 5,
              fps,
              config: { damping: 180 }
            });
            return (
              <div
                key={item}
                style={{
                  opacity: interpolate(rowProgress, [0, 1], [0, 1]),
                  translate: `${interpolate(rowProgress, [0, 1], [24, 0])}px 0`,
                  minHeight: 62,
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(185,239,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 18px",
                  fontFamily: jakarta,
                  color: dark.cyanSoft,
                  fontWeight: 800,
                  fontSize: 20
                }}
              >
                <span>{item}</span>
                <span style={{ color: dark.cyan }}>✓</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const SceneCopy: React.FC<{ scene: CloserKnowledgeScene; layout: "landscape" | "story" }> = ({ scene, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 200 } });

  return (
    <div
      style={{
        opacity: interpolate(progress, [0, 1], [0, 1]),
        translate: `0 ${interpolate(progress, [0, 1], [34, 0])}px`,
        maxWidth: layout === "story" ? "100%" : 720
      }}
    >
      <div
        style={{
          fontFamily: jakarta,
          color: dark.cyan,
          fontWeight: 800,
          letterSpacing: 5,
          fontSize: layout === "story" ? 22 : 20,
          marginBottom: 26
        }}
      >
        {scene.eyebrow}
      </div>
      <Headline size={layout === "story" ? 68 : 78} color={dark.white}>
        {scene.title}
      </Headline>
      <div style={{ height: 24 }} />
      <BodyText size={layout === "story" ? 31 : 32} muted>
        {scene.subtitle}
      </BodyText>
      <div style={{ height: 38 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {scene.bullets.map((bullet, index) => {
          const itemProgress = spring({
            frame: frame - 12 - index * 5,
            fps,
            config: { damping: 190 }
          });
          return (
            <div
              key={bullet}
              style={{
                opacity: interpolate(itemProgress, [0, 1], [0, 1]),
                translate: `${interpolate(itemProgress, [0, 1], [-22, 0])}px 0`,
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontFamily: jakarta,
                color: dark.cyanSoft,
                fontSize: layout === "story" ? 26 : 25,
                fontWeight: 800
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: dark.cyan,
                  boxShadow: `0 0 22px ${dark.cyan}`
                }}
              />
              {bullet}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Scene: React.FC<{ scene: CloserKnowledgeScene; layout: "landscape" | "story"; withVoiceover: boolean }> = ({
  scene,
  layout,
  withVoiceover
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const endFade = interpolate(
    frame,
    [Math.max(1, scene.durationSeconds * fps - 12), scene.durationSeconds * fps],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.7, 0, 0.84, 0) }
  );

  return (
    <AbsoluteFill style={{ opacity: endFade }}>
      {withVoiceover ? <Audio src={staticFile(scene.audioFile)} volume={1} /> : null}
      <SceneBackground />
      <AbsoluteFill
        style={{
          padding: layout === "story" ? "62px 56px 78px" : "58px 76px",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <BrandLogo height={layout === "story" ? 46 : 48} />
          <div
            style={{
              fontFamily: jakarta,
              color: dark.muted,
              fontSize: layout === "story" ? 20 : 18,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase"
            }}
          >
            How to feed Closer
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: layout === "story" ? "1fr" : "0.9fr 1.1fr",
            alignItems: "center",
            gap: layout === "story" ? 42 : 66,
            paddingTop: layout === "story" ? 42 : 24
          }}
        >
          <SceneCopy scene={scene} layout={layout} />
          <MiniWorkspace scene={scene} layout={layout} />
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: "rgba(185,239,255,0.12)",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, ((Number(scene.id.split("-")[1]) || 1) / closerKnowledgeScenes.length) * 100)}%`,
              background: `linear-gradient(90deg, ${dark.cyanSoft}, ${dark.cyan})`
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CloserKnowledgeExplainer: React.FC<ExplainerProps> = ({
  layout,
  withVoiceover = true
}) => (
  <AbsoluteFill style={{ background: theme.navy }}>
    {closerKnowledgeScenes.map((scene, index) => (
      <Sequence
        key={scene.id}
        from={getSceneStartFrame(index)}
        durationInFrames={Math.round(scene.durationSeconds * FPS)}
      >
        <Scene scene={scene} layout={layout} withVoiceover={withVoiceover} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
