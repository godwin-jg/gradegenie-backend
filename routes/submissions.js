// backend/routes/submissions.js
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs'); 
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require("mammoth");
const OpenAI = require("openai");
const axios = require('axios'); 
const multer = require('multer'); 
const cloudinary = require('cloudinary').v2; 
const PDFDocument = require('pdfkit');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const dotenv = require('dotenv');

dotenv.config();
const router = express.Router();

const storage = multer.memoryStorage(); 
const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // Example: 15MB limit
    // Add fileFilter if needed
});
const uploadSingle = upload.single('submissionFile'); 

// --- Initialize OpenAI Client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });


async function extractTextFromFile(fileBuffer, fileName) {
    let fileContent = '';
    const fileExt = fileName?.split('.').pop()?.toLowerCase() || '';
    console.log(`Extracting text from: ${fileName} (ext: ${fileExt})`);
    try {
        if (!fileBuffer) throw new Error(`No file data provided for ${fileName}`);

        if (fileExt === 'pdf') {
            const data = await pdf(fileBuffer); // pdf-parse works with buffers
            fileContent = data.text;
        } else if (fileExt === 'docx') {
            // mammoth needs a buffer property for memory storage
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            fileContent = result.value;
        } else if (['txt', 'md', 'csv', ''].includes(fileExt)) {
            fileContent = fileBuffer.toString('utf-8'); // Convert buffer to string
        } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(fileExt)) {
             throw new Error(`Cannot analyze content from image file (${fileName}).`);
        } else {
            console.warn(`Attempting plain text read for unknown file type: ${fileName}`);
            try { fileContent = fileBuffer.toString('utf-8'); }
            catch (readError) { throw new Error(`Unsupported file type for content analysis: ${fileName}`); }
        }
        console.log(`Extracted text length: ${fileContent.length} characters`);
    } catch (error) { console.error(`Error during text extraction for ${fileName}:`, error); throw error; }
    return fileContent;
}

async function performAICheck(submissionContent) {
    console.log("Performing AI content check...");
    if (!submissionContent || submissionContent.trim().length < 50) { // Need sufficient text
        console.warn("Content too short for meaningful AI check.");
        return null; // Return null if content is too short
    }
    // Simple prompt for overall likelihood - can be made more complex for section analysis
    const prompt = `
        Analyze the following text and estimate the likelihood that it was primarily written by an AI versus a human. Provide an overall estimated percentage score for human authorship (0-100) and a brief confidence level (High, Medium, Low).

        Format the response *only* as JSON, like this example:
        {
          "score": 85,
          "confidence": "Medium"
        }

        Text to analyze:
        """
        ${submissionContent.substring(0, 4000)}
        """
    `; // Limit input length if necessary

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Or another suitable model
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            response_format: { type: "json_object" }, // Request JSON output
            max_tokens: 100
        });

        const resultJson = completion.choices[0]?.message?.content;
        if (!resultJson) {
            console.warn("AI Check: No content in response.");
            return null;
        }

        const parsedResult = JSON.parse(resultJson);
        console.log("AI Check Result:", parsedResult);

        // Basic validation of the parsed result
        if (typeof parsedResult.score === 'number' && typeof parsedResult.confidence === 'string') {
             return {
                 score: parsedResult.score,
                 confidence: parsedResult.confidence,
                 details: [] // No section details from this simple check
             };
        } else {
            console.warn("AI Check: Parsed result has unexpected format.", parsedResult);
            return null;
        }

    } catch (error) {
        console.error("Error during OpenAI AI check:", error);
        return null; // Return null on error
    }
}

// --- Placeholder Function for Plagiarism Check ---
async function performPlagiarismCheck(submissionContent) {
    console.log("Performing Plagiarism check (Placeholder)...");
    if (!submissionContent || submissionContent.trim().length < 50) {
        console.warn("Content too short for plagiarism check.");
        return null;
    }
    // --- !!! REPLACE THIS WITH ACTUAL API CALL TO YOUR PLAGIARISM SERVICE !!! ---
    // Example: const result = await YourPlagiarismAPI.check(submissionContent);
    // return formattedResult;

    // Simulate finding one match for demonstration
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
    const firstSentence = submissionContent.split('.')[0] || submissionContent.substring(0, 50);

    // Return mock data matching the expected structure
    return {
        score: Math.max(70, Math.floor(Math.random() * 26) + 70), // Simulate 70-95% originality
        matches: [
            // {
            //     text: firstSentence + ".",
            //     source: "Simulated Source - Wikipedia Example",
            //     similarity: Math.random() * 0.1 + 0.85 // Simulate 85-95% match
            // }
        ] // Start with no matches for less clutter, uncomment above to test
    };
}


// --- Routes ---
router.post('/', authMiddleware, uploadSingle, async (req, res) => {
    // uploadSingle middleware puts file buffer in req.file.buffer
    const { assignmentId, studentNameManual } = req.body;
    const submittedBy = req.user.id;
    let cloudinaryResult = null; // To store Cloudinary response

    try {
        if (!req.file) { return res.status(400).json({ message: 'Submission file is required.' }); }
        if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) { throw new Error('Invalid or missing assignment ID'); }

        const assignment = await Assignment.findById(assignmentId).select('title description');
        if (!assignment) { throw new Error('Assignment not found'); }
        const assignmentContext = assignment.description || assignment.title || "the assigned topic";

        console.log(`Uploading ${req.file.originalname} to Cloudinary...`);
        // Use upload_stream to handle buffer
        cloudinaryResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: "auto", // Automatically detect type (raw for non-media, image, video)
                    folder: `submissions/${assignmentId}`, // Optional: Organize in folders
                    // public_id: `${submissionId}-${Date.now()}` // Optional: custom public ID
                },
                (error, result) => {
                    if (error) {
                        console.error("Cloudinary Upload Error:", error);
                        return reject(new Error("Failed to upload file to storage."));
                    }
                    resolve(result);
                }
            );
            uploadStream.end(req.file.buffer);
        });

        if (!cloudinaryResult?.secure_url) {
             throw new Error("Cloudinary upload succeeded but did not return a secure URL.");
        }
        console.log("Cloudinary Upload Successful:", cloudinaryResult.public_id, cloudinaryResult.secure_url);

        let submissionContent = '';
        try {
            submissionContent = await extractTextFromFile(req.file.buffer, req.file.originalname);
        } catch (extractionError) {
            console.warn(`Could not process file content for checks: ${extractionError.message}`);
            submissionContent = ''; // Allow submission, but checks might be skipped
        }
        if (!submissionContent || submissionContent.trim().length < 20) {
             console.warn(`Extracted content too short (length: ${submissionContent?.trim().length}). Skipping AI/Plagiarism checks.`);
        }

        // ---- AI Relevance Check  ---
        let relevance = 'SOMEWHAT_RELEVANT'; // Default
        if (submissionContent && submissionContent.trim().length >= 20) { // Only check if content exists
            console.log(`Checking relevance for assignment: "${assignmentContext}"`);
            const relevancePrompt = `Assignment Context: "${assignmentContext}"\n\nSubmission Text Snippet (first 500 chars):\n"""\n${submissionContent.substring(0, 500)}\n"""\n\nBased ONLY on the Context and Snippet, is the submission highly relevant, somewhat relevant, or clearly off-topic? Respond with only one word: HIGHLY_RELEVANT, SOMEWHAT_RELEVANT, or OFF_TOPIC.`;
            try {
                const completion = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: relevancePrompt }], temperature: 0.2, max_tokens: 10 });
                const resultText = completion.choices[0]?.message?.content?.trim().toUpperCase();
                if (resultText === 'OFF_TOPIC') relevance = 'OFF_TOPIC';
                else if (resultText === 'HIGHLY_RELEVANT') relevance = 'HIGHLY_RELEVANT';
                console.log("AI Relevance Check Result:", relevance);
            } catch (aiError) { console.error("OpenAI relevance check failed:", aiError); }
        } else {
            console.log("Skipping relevance check due to insufficient content.");
        }


        // --- Reject if Off-Topic ---
        if (relevance === 'OFF_TOPIC') {
            // If rejected, delete the file from Cloudinary *before* throwing error
            console.log(`Submission rejected as off-topic. Deleting ${cloudinaryResult.public_id} from Cloudinary.`);
            await cloudinary.uploader.destroy(cloudinaryResult.public_id, { resource_type: cloudinaryResult.resource_type });
            throw new Error('Submission rejected: The content does not seem relevant to the assignment topic.');
        }

        // --- Perform AI Content & Plagiarism Checks (if content sufficient) ---
        let aiCheckResultData = null;
        let plagiarismResultData = null;
        if (submissionContent && submissionContent.trim().length >= 50) {
            [aiCheckResultData, plagiarismResultData] = await Promise.all([
                performAICheck(submissionContent),
                performPlagiarismCheck(submissionContent) // Replace placeholder
            ]);
        } else { console.log("Skipping AI/Plagiarism checks due to short/missing content."); }

        // --- Save Submission to DB ---
        console.log(`Proceeding to save submission (Relevance: ${relevance})`);
        let studentName = studentNameManual || null;
        if (!studentName) {
            const studentUser = await User.findById(submittedBy).select('name');
            studentName = studentUser ? studentUser.name : null;
        }

        const newSubmission = new Submission({
            assignmentId, submittedBy, studentName,
            submissionDate: new Date(), status: 'pending',
            content: null, // Not saving full text content in DB anymore
            fileUrl: cloudinaryResult.secure_url, // Save Cloudinary URL
            fileName: req.file.originalname,
            cloudinaryPublicId: cloudinaryResult.public_id, // Store public_id for potential deletion
            cloudinaryResourceType: cloudinaryResult.resource_type, // Store resource type
            score: null, subScores: undefined, overallFeedback: undefined,
            inlineComments: undefined,
            aiCheckerResults: aiCheckResultData,
            plagiarismResults: plagiarismResultData,
            feedback: null,
        });

        const savedSubmission = await newSubmission.save();
        const populatedSubmission = await Submission.findById(savedSubmission._id)
            .populate('submittedBy', 'name email');

        res.status(201).json(populatedSubmission);

    } catch (error) {
        console.error("Error during submission process:", error);

        if (cloudinaryResult?.public_id) {
            try {
                console.warn(`Error occurred after Cloudinary upload. Deleting ${cloudinaryResult.public_id}...`);
                await cloudinary.uploader.destroy(cloudinaryResult.public_id, { resource_type: cloudinaryResult.resource_type });
                console.log(`Cleaned up Cloudinary file: ${cloudinaryResult.public_id}`);
            } catch (cleanupError) {
                console.error("Error deleting Cloudinary file during error handling:", cleanupError);
            }
        }

        if (error.message.startsWith('Submission rejected:') || error.message.startsWith('Could not process file content:') || error.message.startsWith('Invalid or missing assignment ID')) {
            return res.status(400).json({ message: error.message });
        }
        if (error.message === 'Assignment not found') {
            return res.status(404).json({ message: error.message });
        }
        if (error.name === 'ValidationError') { const messages = Object.values(error.errors).map((val) => val.message); return res.status(400).json({ message: 'Validation failed', errors: messages }); }
        res.status(500).json({ message: 'Server error creating submission', error: error.message });
    }
});


router.put('/:submissionId', authMiddleware, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;
        const updates = req.body;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) { return res.status(400).json({ message: 'Invalid submission ID format' }); }

        const submission = await Submission.findById(submissionId);
        if (!submission) { return res.status(404).json({ message: 'Submission not found' }); }

        const parentAssignment = await Assignment.findById(submission.assignmentId).select('createdBy');
        if (!parentAssignment || parentAssignment.createdBy.toString() !== userId.toString()) { return res.status(403).json({ message: 'Permission denied.' }); }

        const allowedUpdates = [ 
            'studentName', 'studentId', 'status', 'score', 'subScores',
            'overallFeedback', 'inlineComments', 'feedback',
        ];
        Object.keys(updates).forEach((key) => {
            if (allowedUpdates.includes(key)) {
                 if (key === 'inlineComments' && Array.isArray(updates[key])) { /* ... handle subdoc _id ... */
                     submission[key] = updates[key].map((comment) => ({ ...comment, _id: comment._id || new mongoose.Types.ObjectId() }));
                 } else if (key === 'subScores' && Array.isArray(updates[key])) { /* ... handle subdoc _id ... */
                     submission[key] = updates[key].map((score) => ({ ...score, _id: score._id || new mongoose.Types.ObjectId() }));
                 } else { submission[key] = updates[key]; }
            }
        });
        if (updates.score !== undefined && updates.score !== null && submission.status !== 'graded') { submission.status = 'graded'; }

        const updatedSubmissionDoc = await submission.save();

        const populatedSubmission = await Submission.findById(updatedSubmissionDoc._id)
             .populate('submittedBy', 'name email')
             .populate({ path: 'assignmentId', select: 'title course totalPoints' })
             .lean();

        let fileContent = '';
        let fileReadError = null;
        if (populatedSubmission.fileUrl) {
            console.log(`Downloading content for response from: ${populatedSubmission.fileUrl}`);
             try {
                 // Download the file content as a buffer
                 const response = await axios.get(populatedSubmission.fileUrl, { responseType: 'arraybuffer' });
                 const fileBuffer = Buffer.from(response.data);
                 fileContent = await extractTextFromFile(fileBuffer, populatedSubmission.fileName);
             } catch (downloadError) {
                 console.error(`Error downloading or processing file from Cloudinary URL ${populatedSubmission.fileUrl}:`, downloadError);
                 fileReadError = `Failed to retrieve file content: ${downloadError.message}`;
             }
        } else { fileContent = populatedSubmission.content || ''; } // Fallback


        const responsePayload = {
             ...populatedSubmission,
             content: fileContent, 
             fileReadError: fileReadError,
             assignmentTitle: populatedSubmission.assignmentId?.title || 'N/A',
             studentName: populatedSubmission.submittedBy?.name || populatedSubmission.studentName || 'Unknown',
             inlineComments: (populatedSubmission.inlineComments || []).map((comment) => ({ ...comment, id: comment._id.toString() })),
             subScores: (populatedSubmission.subScores || []).map((score) => ({ ...score, id: score._id.toString() })),
         };
        res.status(200).json({ message: 'Submission updated successfully', submission: responsePayload });

    } catch (error) { 
        console.error("Error updating submission:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map((val) => val.message);
            return res.status(400).json({ message: 'Validation failed', errors: messages });
        }
        res.status(500).json({ message: 'Server error updating submission', error: error.message });
    }
});

router.get('/:submissionId', authMiddleware, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) { return res.status(400).json({ message: 'Invalid submission ID' }); }

        // Fetch submission metadata from DB
        const submission = await Submission.findById(submissionId)
            .populate('submittedBy', 'name email')
            .populate({ path: 'assignmentId', select: 'title course createdBy totalPoints' })
            .lean();

        if (!submission) { return res.status(404).json({ message: 'Submission not found' }); }

        // Authorization Check
        const isSubmitter = submission.submittedBy?._id.toString() === userId.toString();
        const isAssignmentCreator = submission.assignmentId?.createdBy?.toString() === userId.toString();
        if (!isSubmitter && !isAssignmentCreator) { return res.status(403).json({ message: 'Permission denied.' }); }

        // --- Download and Extract Content from Cloudinary URL ---
        let fileContent = '';
        let fileReadError = null;

        if (submission.fileUrl) {
            console.log(`Downloading content from Cloudinary URL: ${submission.fileUrl}`);
            try {
                // Use axios to download the file content as a buffer
                const response = await axios.get(submission.fileUrl, {
                    responseType: 'arraybuffer' // Important: Get data as a buffer
                });
                const fileBuffer = Buffer.from(response.data); // Convert response data to Node.js Buffer

                // Extract text using the helper function
                fileContent = await extractTextFromFile(fileBuffer, submission.fileName);

            } catch (downloadError) {
                console.error(`Error downloading or processing file from Cloudinary URL ${submission.fileUrl}:`, downloadError);
                fileReadError = `Failed to retrieve or process file content: ${downloadError.message}`;
                fileContent = ''; // Ensure content is empty on error
            }
        } else {
            // Fallback to content stored in DB if no fileUrl exists
            console.log(`No fileUrl associated with submission ${submissionId}. Using DB content.`);
            fileContent = submission.content || ''; // Use DB content field if available
            if (!fileContent) {
                 fileReadError = "No file was associated with this submission, and no text content was found in the database.";
            }
        }
        // --- End Download and Extract ---

        // Prepare response payload
        const responsePayload = {
            ...submission,
            content: fileContent, // Inject the extracted/read content
            fileReadError: fileReadError,
            assignmentTitle: submission.assignmentId?.title || 'Assignment Title Missing',
            studentName: submission.submittedBy?.name || submission.studentName || 'Unknown Student',
            inlineComments: (submission.inlineComments || []).map((comment) => ({ ...comment, id: comment._id.toString(), _id: undefined })),
            subScores: (submission.subScores || []).map((score) => ({ ...score, id: score._id.toString(), _id: undefined })),
            assignmentId: submission.assignmentId?._id,
        };

        res.status(200).json(responsePayload);

    } catch (error) {
         console.error("Error fetching submission details:", error);
         res.status(500).json({ message: 'Server error fetching submission details', error: error.message });
    }
});

router.get('/:submissionId/report', authMiddleware, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({ message: 'Invalid submission ID' });
        }

        // 1. Fetch Submission Data (including populated fields)
        const submission = await Submission.findById(submissionId)
            .populate('submittedBy', 'name email') // Get student info
            .populate({ // Get assignment info
                path: 'assignmentId',
                select: 'title course createdBy totalPoints'
            })
            .lean(); 

        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        // 2. Authorization Check (Student or Teacher)
        const isSubmitter = submission.submittedBy?._id.toString() === userId.toString();
        const isAssignmentCreator = submission.assignmentId?.createdBy?.toString() === userId.toString();
        if (!isSubmitter && !isAssignmentCreator) {
            return res.status(403).json({ message: 'Permission denied.' });
        }

        // 3. Prepare Data for PDF
        const assignmentTitle = submission.assignmentId?.title || 'N/A';
        const studentName = submission.submittedBy?.name || submission.studentName || 'Unknown Student';
        const courseName = submission.assignmentId?.course || 'N/A';
        const submissionDate = submission.submissionDate ? new Date(submission.submissionDate).toLocaleDateString() : 'N/A';
        const finalScore = submission.score ?? 'Not Graded';
        const totalPoints = submission.assignmentId?.totalPoints ?? 100;

        // 4. Create PDF Document
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        // 5. Set Response Headers for PDF Download
        const filename = `SubmissionReport_${studentName.replace(/\s+/g, '_')}_${assignmentTitle.replace(/\s+/g, '_')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        // res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // 6. Pipe PDF stream to response
        doc.pipe(res);

        // 7. Add Content to PDF
        // Header
        doc.fontSize(18).font('Helvetica-Bold').text(`Submission Report`, { align: 'center' });
        doc.fontSize(14).font('Helvetica').text(assignmentTitle, { align: 'center' });
        doc.moveDown(1.5);

        // Submission Info
        doc.fontSize(11).font('Helvetica-Bold').text('Student: ', { continued: true }).font('Helvetica').text(studentName);
        doc.font('Helvetica-Bold').text('Course: ', { continued: true }).font('Helvetica').text(courseName);
        doc.font('Helvetica-Bold').text('Submitted On: ', { continued: true }).font('Helvetica').text(submissionDate);
        doc.font('Helvetica-Bold').text('Final Score: ', { continued: true }).font('Helvetica').text(`${finalScore} / ${totalPoints}`);
        doc.moveDown(1.5);

        // Overall Feedback
        if (submission.overallFeedback) {
            doc.fontSize(13).font('Helvetica-Bold').text('Overall Feedback', { underline: true });
            doc.moveDown(0.5);
            if (submission.overallFeedback.strengths) {
                doc.fontSize(11).font('Helvetica-Bold').text('Strengths:').font('Helvetica').text(submission.overallFeedback.strengths).moveDown(0.5);
            }
            if (submission.overallFeedback.improvements) {
                doc.fontSize(11).font('Helvetica-Bold').text('Areas for Improvement:').font('Helvetica').text(submission.overallFeedback.improvements).moveDown(0.5);
            }
            if (submission.overallFeedback.actionItems) {
                doc.fontSize(11).font('Helvetica-Bold').text('Action Items:').font('Helvetica').text(submission.overallFeedback.actionItems).moveDown(0.5);
            }
            doc.moveDown(1);
        }

        // Grading Rubric / Sub-Scores
        if (submission.subScores && submission.subScores.length > 0) {
            doc.fontSize(13).font('Helvetica-Bold').text('Grading Rubric / Details', { underline: true });
            doc.moveDown(0.5);
            submission.subScores.forEach(item => {
                doc.fontSize(11).font('Helvetica-Bold').text(`${item.name} (${item.score} / ${item.maxScore})`);
                if (item.rationale) {
                    doc.font('Helvetica').fontSize(10).text(`Rationale: ${item.rationale}`, { indent: 15 });
                }
                doc.moveDown(0.7);
            });
            doc.moveDown(1);
        }
        // Inline Comments
        // if (submission.inlineComments && submission.inlineComments.length > 0) {
        //     doc.fontSize(13).font('Helvetica-Bold').text('Inline Comments', { underline: true });
        //     doc.moveDown(0.5);
        //     // Sort comments by position in text
        //     const sortedComments = [...submission.inlineComments].sort((a, b) => (a.startIndex || 0) - (b.startIndex || 0));

        //     sortedComments.forEach((comment, index) => {
        //         doc.fontSize(11).font('Helvetica-Bold').text(`Comment ${index + 1}:`);

        //         // --- Add the quoted text ---
        //         if (fileContent && typeof comment.startIndex === 'number' && typeof comment.endIndex === 'number') {
        //              const quote = fileContent.substring(comment.startIndex, comment.endIndex);
        //              if (quote) {
        //                  doc.fontSize(10).font('Helvetica-Oblique')
        //                     .fillColor('grey') // Make quote visually distinct
        //                     .text(`"${quote}"`, { indent: 15 })
        //                     .fillColor('black'); // Reset color
        //              } else {
        //                   doc.fontSize(10).font('Helvetica-Oblique').fillColor('grey').text(`[Text segment not found for comment]`, { indent: 15 }).fillColor('black');
        //              }
        //         } else {
        //              doc.fontSize(10).font('Helvetica-Oblique').fillColor('grey').text(`[Original text unavailable or comment position invalid]`, { indent: 15 }).fillColor('black');
        //         }
        //         // --------------------------

        //         doc.fontSize(10).font('Helvetica').text(comment.text, { indent: 15 });
        //         doc.fontSize(9).font('Helvetica').text(`- ${comment.author} (${new Date(comment.timestamp).toLocaleDateString()})`, { align: 'right' });
        //         doc.moveDown(0.7);
        //     });
        //     doc.moveDown(1);
        // }

        // Inline Comments (Simplified List)
        if (submission.inlineComments && submission.inlineComments.length > 0) {
            doc.fontSize(13).font('Helvetica-Bold').text('Inline Comments', { underline: true });
            doc.moveDown(0.5);
            submission.inlineComments.forEach((comment, index) => {
                doc.fontSize(11).font('Helvetica-Bold').text(`Comment ${index + 1}:`);
                // Ideally, fetch content here to show quote, but keeping it simple for now

                // doc.fontSize(10).font('Helvetica-Oblique').text(`Regarding text near index ${comment.startIndex}`, { indent: 15 });
                doc.fontSize(10).font('Helvetica').text(comment.text, { indent: 15 });
                doc.fontSize(9).font('Helvetica').text(`- ${comment.author} (${new Date(comment.timestamp).toLocaleDateString()})`, { align: 'right' });
                doc.moveDown(0.7);
            });
            doc.moveDown(1);
        }

        // AI & Plagiarism Summary
        if (submission.aiCheckerResults || submission.plagiarismResults) {
             doc.fontSize(13).font('Helvetica-Bold').text('Analysis Results', { underline: true });
             doc.moveDown(0.5);
             if(submission.aiCheckerResults) {
                 doc.fontSize(11).font('Helvetica-Bold').text('AI Content Check: ', { continued: true })
                    .font('Helvetica').text(`~${submission.aiCheckerResults.score}% Human Likelihood (Confidence: ${submission.aiCheckerResults.confidence})`);
                 doc.moveDown(0.5);
             }
              if(submission.plagiarismResults) {
                 doc.fontSize(11).font('Helvetica-Bold').text('Plagiarism Check: ', { continued: true })
                    .font('Helvetica').text(`${submission.plagiarismResults.score}% Originality Score`);
                 // Optionally list matches if needed
                 doc.moveDown(0.5);
             }
        }

        doc.end();
        console.log(`Generated PDF report for submission ${submissionId}`);

    } catch (error) {
        console.error("Error generating PDF report:", error);
        if (!res.headersSent) {
             res.status(500).json({ message: 'Server error generating PDF report', error: error.message });
        } else {
            // If stream already started, we can't send JSON, just end the response
            res.end();
        }
    }
});

router.delete('/:submissionId', authMiddleware, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({ message: 'Invalid submission ID format' });
        }

        const submission = await Submission.findById(submissionId);
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const parentAssignment = await Assignment.findById(submission.assignmentId).select('createdBy');
        if (!parentAssignment || parentAssignment.createdBy.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Permission denied.' });
        }

        // Delete the file from Cloudinary
        if (submission.cloudinaryPublicId) {
            await cloudinary.uploader.destroy(submission.cloudinaryPublicId, { resource_type: submission.cloudinaryResourceType });
            console.log(`Deleted file from Cloudinary: ${submission.cloudinaryPublicId}`);
        }

        // Delete the submission document from MongoDB
        await Submission.deleteOne({ _id: submissionId });

        res.status(200).json({ message: 'Submission deleted successfully' });

    } catch (error) {
        console.error("Error deleting submission:", error);
        res.status(500).json({ message: 'Server error deleting submission', error: error.message });
    }
});


module.exports = router;
