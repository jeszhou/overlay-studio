import { useEffect } from "react";

export interface ProjectFont {
  family: string;
  weight?: string;
  url: string;
}

export function ProjectFonts({ assets }: { assets?: ProjectFont[] }) {
  useEffect(() => {
    const faces: FontFace[] = [];
    for (const font of assets ?? []) {
      if (!font.url.startsWith("/_projects/")) continue;
      try {
        const face = new FontFace(font.family, "url(" + JSON.stringify(font.url) + ")", {
          weight: /^[1-9]00$/.test(font.weight ?? "") ? font.weight : "400",
          display: "swap",
        });
        document.fonts.add(face);
        faces.push(face);
      } catch {
        // One unavailable custom font must not interrupt project recovery.
      }
    }
    return () => {
      for (const face of faces) document.fonts.delete(face);
    };
  }, [assets]);
  return null;
}
