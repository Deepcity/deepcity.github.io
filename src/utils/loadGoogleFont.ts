import { readFile } from "node:fs/promises";

const LOCAL_FALLBACK_FONT =
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";

function toArrayBuffer(buffer: ArrayBufferView) {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  return copy.buffer;
}

async function loadGoogleFont(
  font: string,
  text: string,
  weight: number
): Promise<ArrayBuffer> {
  const API = `https://fonts.googleapis.com/css2?family=${font}:wght@${weight}&text=${encodeURIComponent(text)}`;

  const css = await (
    await fetch(API, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
      },
    })
  ).text();

  const resource = css.match(
    /src: url\((.+?)\) format\('(opentype|truetype)'\)/
  );

  if (!resource) throw new Error("Failed to download dynamic font");

  const res = await fetch(resource[1]);

  if (!res.ok) {
    throw new Error("Failed to download dynamic font. Status: " + res.status);
  }

  return res.arrayBuffer();
}

async function loadGoogleFonts(
  text: string
): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: number; style: string }>
> {
  const fontsConfig = [
    {
      name: "IBM Plex Mono",
      font: "IBM+Plex+Mono",
      weight: 400,
      style: "normal",
    },
    {
      name: "IBM Plex Mono",
      font: "IBM+Plex+Mono",
      weight: 700,
      style: "bold",
    },
  ];

  try {
    const fonts = await Promise.all(
      fontsConfig.map(async ({ name, font, weight, style }) => {
        const data = await loadGoogleFont(font, text, weight);
        return { name, data, weight, style };
      })
    );

    return fonts;
  } catch {
    // OG generation should still succeed in offline CI or restricted sandboxes.
    const localFont = await readFile(LOCAL_FALLBACK_FONT);
    const data = toArrayBuffer(localFont);
    return fontsConfig.map(({ name, weight, style }) => ({
      name,
      data,
      weight,
      style,
    }));
  }
}

export default loadGoogleFonts;
