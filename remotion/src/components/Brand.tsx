import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { jakarta, manrope } from "../fonts";
import { theme } from "../theme";

type BrandLogoProps = {
  height?: number;
};

export const BrandLogo: React.FC<BrandLogoProps> = ({ height = 44 }) => (
  <Img
    src={staticFile("logo.png")}
    style={{ height, width: "auto", objectFit: "contain", display: "block" }}
  />
);

type GradientBackgroundProps = {
  variant?: "soft" | "hero";
};

export const GradientBackground: React.FC<GradientBackgroundProps> = ({ variant = "soft" }) => (
  <AbsoluteFill
    style={{
      background:
        variant === "hero"
          ? `radial-gradient(circle at 20% 10%, ${theme.lavender} 0%, transparent 42%), radial-gradient(circle at 85% 20%, rgba(94,120,216,0.18) 0%, transparent 36%), linear-gradient(180deg, ${theme.bg} 0%, ${theme.bgDeep} 100%)`
          : `linear-gradient(180deg, ${theme.bg} 0%, ${theme.bgDeep} 100%)`
    }}
  />
);

type FadeSlideProps = {
  children: React.ReactNode;
  delay?: number;
  direction?: "up" | "down";
};

export const FadeSlide: React.FC<FadeSlideProps> = ({ children, delay = 0, direction = "up" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const offset = interpolate(progress, [0, 1], [direction === "up" ? 28 : -28, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  return (
    <div style={{ opacity, transform: `translateY(${offset}px)` }}>
      {children}
    </div>
  );
};

type HeadlineProps = {
  children: React.ReactNode;
  size?: number;
  align?: "left" | "center";
  color?: string;
};

export const Headline: React.FC<HeadlineProps> = ({
  children,
  size = 56,
  align = "left",
  color = theme.ink
}) => (
  <div
    style={{
      fontFamily: manrope,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.08,
      letterSpacing: -0.5,
      color,
      textAlign: align
    }}
  >
    {children}
  </div>
);

type BodyTextProps = {
  children: React.ReactNode;
  size?: number;
  align?: "left" | "center";
  muted?: boolean;
};

export const BodyText: React.FC<BodyTextProps> = ({
  children,
  size = 28,
  align = "left",
  muted = false
}) => (
  <div
    style={{
      fontFamily: jakarta,
      fontWeight: 600,
      fontSize: size,
      lineHeight: 1.35,
      color: muted ? theme.muted : theme.ink,
      textAlign: align
    }}
  >
    {children}
  </div>
);

type PillProps = {
  children: React.ReactNode;
};

export const Pill: React.FC<PillProps> = ({ children }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "10px 18px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.82)",
      border: `1px solid ${theme.line}`,
      fontFamily: jakarta,
      fontWeight: 700,
      fontSize: 22,
      color: theme.blue
    }}
  >
    {children}
  </div>
);
