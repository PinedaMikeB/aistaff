import { loadFont } from "@remotion/google-fonts/Manrope";
import { loadFont as loadJakarta } from "@remotion/google-fonts/PlusJakartaSans";

export const { fontFamily: manrope } = loadFont("normal", {
  weights: ["600", "700", "800"],
  subsets: ["latin"]
});

export const { fontFamily: jakarta } = loadJakarta("normal", {
  weights: ["500", "600", "700"],
  subsets: ["latin"]
});
