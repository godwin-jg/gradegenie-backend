// backend/routes/aiRoutes.js
const express = require('express');
const dotenv = require('dotenv');
const OpenAI = require("openai");
const authMiddleware = require('../middleware/authMiddleware'); // Protect the route

dotenv.config();
const router = express.Router();

const validateAnalysisRequest = (req, res, next) => {
    const { submissionContent } = req.body;
    if (!submissionContent || typeof submissionContent !== 'string' || submissionContent.trim().length === 0) {
        return res.status(400).json({ message: 'Missing or invalid submissionContent in request body.' });
    }
    next();
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// --- POST /api/ai/analyze-submission ---
router.post('/analyze-submission', authMiddleware, validateAnalysisRequest, async (req, res) => {
    const { submissionContent } = req.body;
    console.log(`AI Analysis requested via OpenAI for content (length: ${submissionContent.length})`);

    // --- Construct the Prompt (Same structured text prompt should work well) ---
    const prompt = `
        Analyze the following student submission text for an assignment. Provide constructive feedback suitable for a teacher reviewing the work. Structure your response *exactly* like the example below, including the section headers (STRENGTHS:, IMPROVEMENTS:, ACTION ITEMS:, INLINE COMMENTS:) and the QUOTE:/COMMENT: format for inline suggestions. Identify 2-4 key areas for inline comments focusing on clarity, argumentation, evidence, or grammar.

        EXAMPLE STRUCTURE:
        STRENGTHS:
        - Strength 1 identified from the text.
        - Strength 2 identified from the text.

        IMPROVEMENTS:
        - Area for improvement 1.
        - Area for improvement 2.

        ACTION ITEMS:
        - Specific action item 1 for the student.
        - Specific action item 2 for the student.

        INLINE COMMENTS:
        ---
        QUOTE: "Exact quote from the text needing a comment (keep it relatively short, like a sentence or phrase)."
        COMMENT: "Your constructive comment about this specific quote."
        ---
        QUOTE: "Another distinct exact quote from the text."
        COMMENT: "Another comment for the second quote."
        ---

        SUBMISSION CONTENT TO ANALYZE:
        """
        ${submissionContent}
        """
    `;

    try {
        console.log("Sending request to OpenAI API...");
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Or "gpt-4", "gpt-4o-mini", etc.
            messages: [
                // Optional: Add a system message to guide the AI's persona/role
                // { role: "system", content: "You are a helpful teaching assistant providing feedback on student submissions." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6, // Adjust temperature for creativity vs consistency (0.0 to 1.0)
            // max_tokens: 1000 // Optional: limit response length
        });

        const aiTextResponse = completion.choices[0]?.message?.content?.trim();

        if (!aiTextResponse) {
            console.error("OpenAI API Error: No text content received in response.", completion);
            throw new Error("AI analysis failed: No response content from OpenAI model.");
        }

        console.log("Received response text from OpenAI API (snippet):", aiTextResponse.substring(0, 200) + "...");

        const parsedFeedback = parseAIResponse(aiTextResponse);
        const locatedComments = locateInlineComments(parsedFeedback.rawInlineComments, submissionContent);

        const finalResponse = {
            suggestedOverallFeedback: {
                strengths: parsedFeedback.strengths,
                improvements: parsedFeedback.improvements,
                actionItems: parsedFeedback.actionItems,
            },
            suggestedInlineComments: locatedComments,
        };

        res.status(200).json(finalResponse);

    } catch (error) {
        console.error("Error during OpenAI analysis:", error);
        let errorMessage = 'Server error during AI analysis.';
         if (error instanceof OpenAI.APIError) {
             errorMessage = `OpenAI API Error: ${error.status} ${error.name} - ${error.message}`;
             res.status(error.status || 500); // Use status from error if available
         } else if (error instanceof Error) {
             errorMessage = error.message;
             res.status(500);
         } else {
             res.status(500);
         }
        res.json({ message: errorMessage, error: error.toString() });
    }
});

function parseAIResponse(text) {
    const feedback = {
        strengths: "",
        improvements: "",
        actionItems: "",
        rawInlineComments: [] // Store { quote, comment } pairs
    };

    try {
        // Use flags to determine current section
        let currentSection = null;
        const lines = text.split('\n');
        let currentComment = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Section Headers
            if (trimmedLine.match(/^STRENGTHS:/i)) { currentSection = 'strengths'; continue; }
            if (trimmedLine.match(/^IMPROVEMENTS:/i)) { currentSection = 'improvements'; continue; }
            if (trimmedLine.match(/^ACTION ITEMS:/i)) { currentSection = 'actionItems'; continue; }
            if (trimmedLine.match(/^INLINE COMMENTS:/i)) { currentSection = 'inline'; continue; }

            // Separator for inline comments
            if (trimmedLine === '---' && currentSection === 'inline') {
                if (currentComment?.quote && currentComment?.comment) {
                    feedback.rawInlineComments.push({...currentComment}); // Push copy
                }
                currentComment = null; // Reset for next block
                continue;
            }

            switch (currentSection) {
                case 'strengths':
                case 'improvements':
                case 'actionItems':
                    if (trimmedLine.startsWith('- ') || (trimmedLine && feedback[currentSection])) {
                        feedback[currentSection] += (feedback[currentSection] ? '\n' : '') + trimmedLine.replace(/^- /, '').trim();
                    } else if (trimmedLine && !feedback[currentSection]){
                         feedback[currentSection] += trimmedLine; // First line without '-'
                    }
                    break;
                case 'inline':
                    const quoteMatch = trimmedLine.match(/^QUOTE:\s*"?(.+?)"?$/i);
                    const commentMatch = trimmedLine.match(/^COMMENT:\s*"?(.+?)"?$/i);

                    if (quoteMatch) {
                         // If starting a new quote block, save previous complete one first
                         if (currentComment?.quote && currentComment?.comment) {
                             feedback.rawInlineComments.push({...currentComment});
                         }
                        currentComment = { quote: quoteMatch[1].trim(), comment: "" };
                    } else if (commentMatch && currentComment) {
                        currentComment.comment = commentMatch[1].trim();
                    } else if (currentComment && !currentComment.comment && trimmedLine) {
                        // Handle case where comment might start on next line without "COMMENT:" prefix (less ideal)
                        currentComment.comment = trimmedLine.trim().replace(/^"|"$/g, '');
                    }
                     else if (currentComment?.comment && trimmedLine) {
                        // Handle multi-line comments (append)
                        currentComment.comment += '\n' + trimmedLine;
                    }
                    break;
                default:
                    break; // Ignore lines before first header
            }
        }
         // Add the last comment block if it exists and is complete
         if (currentComment?.quote && currentComment?.comment && currentSection === 'inline') {
             feedback.rawInlineComments.push({...currentComment});
         }

    } catch (parseError) {
        console.error("Error parsing AI response:", parseError);
    }

    return feedback;
}


function locateInlineComments(rawComments, originalContent) {
    const locatedComments = [];
    let searchStartIndex = 0;

    for (const { quote, comment } of rawComments) {
        if (!quote || !comment) continue;
        const startIndex = originalContent.indexOf(quote, searchStartIndex);

        if (startIndex !== -1) {
            const endIndex = startIndex + quote.length;
            locatedComments.push({ startIndex, endIndex, text: comment });
            searchStartIndex = endIndex; // Advance search position
        } else {
            console.warn(`Could not locate quote in submission content: "${quote.substring(0, 50)}..."`);
        }
    }
    return locatedComments;
}

module.exports = router;