import { GoogleGenAI } from "@google/genai";
import fs from "fs";

async function generateMapBackground() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = "A sophisticated, high-resolution photographic background image designed for a digital dashboard interface. The scene is rendered in luminous, clear, and bright shades of cyan and aqua blue, resembling clear tropical sea waters under direct sunlight. The central element is a detailed, stylized world geographic map, featuring continent contours in bright, glowing turquoise-white lines. The map is overlaid with an extensive, intricate network of glowing turquoise and white data streams, data points, and communication paths shimmering across the globe. Small, crisp, glowing white icons representing computers, smartphones, tablets, and network nodes are scattered at key international locations (e.g., Algiers, Paris, New York, Tokyo), all connected by the radiant blue paths. Clear, glowing white text labels are visible at these hubs (ALGIERS, PARIS, NEW YORK, TOKYO). In the background, there are subtle, faint, glowing data visualization widgets like bright cyan bar charts and animated white progress rings, and drifting geometric patterns (hexagons) and light particles (bokeh). The overall atmosphere is modern, technologically advanced, clean, and serene. The depth of field is shallow, creating depth with a soft blur. A faint, glowing 'BRIDGE PRO' text is visible in the top left corner. The light source is internal to the map and network, giving a cool, shimmering, pulsing glow.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64Data = part.inlineData.data;
        fs.writeFileSync("public/map-bg.png", base64Data, 'base64');
        console.log("Image saved to public/map-bg.png");
        return;
      }
    }
  } catch (error) {
    console.error("Error generating image:", error);
  }
}

generateMapBackground();
