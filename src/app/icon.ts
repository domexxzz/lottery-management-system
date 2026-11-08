import { appIconSvg } from "./icon-artwork";

export const size = { width: 64, height: 64 };
export const contentType = "image/svg+xml";

export default function Icon() {
  return new Response(appIconSvg, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": contentType,
    },
  });
}

