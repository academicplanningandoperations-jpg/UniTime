
import { GoogleGenAI } from "@google/genai";
import { ScheduleEntry, Course, Faculty, Room, StudentGroup } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // Corrected: Always use named parameter { apiKey: ... } and process.env.API_KEY directly
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async suggestSchedule(
    courses: Course[], 
    faculty: Faculty[], 
    rooms: Room[], 
    groups: StudentGroup[]
  ): Promise<string> {
    const prompt = `
      As a university scheduling expert, suggest an optimized weekly timetable for the following resources:
      Courses: ${JSON.stringify(courses)}
      Faculty: ${JSON.stringify(faculty)}
      Rooms: ${JSON.stringify(rooms)}
      Student Groups: ${JSON.stringify(groups)}

      Please provide a high-level strategy for scheduling these without clashes. 
      Identify potential bottlenecks (e.g., room capacity vs course popularity) and suggest specific slots.
      Format the response in clear Markdown with headings.
    `;

    try {
      // Corrected: Using gemini-3-pro-preview for complex reasoning/optimization tasks
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
      });
      // Corrected: response.text is a property, not a method
      return response.text || "Could not generate suggestion.";
    } catch (error) {
      console.error("Gemini Suggestion Error:", error);
      return "Error contacting AI service.";
    }
  }

  async resolveClash(clashDetails: string): Promise<string> {
    const prompt = `
      A scheduling clash was detected: ${clashDetails}
      Suggest three possible ways to resolve this conflict professionally. 
      Consider faculty preferences, room availability, and student convenience.
    `;

    try {
      // Corrected: Using gemini-3-pro-preview for complex reasoning tasks
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
      });
      // Corrected: response.text is a property, not a method
      return response.text || "Could not resolve clash.";
    } catch (error) {
      console.error("Gemini Clash Resolution Error:", error);
      return "Error contacting AI service.";
    }
  }
}

export const geminiService = new GeminiService();
