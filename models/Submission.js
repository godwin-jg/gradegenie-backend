const mongoose = require('mongoose');

const inlineCommentSchema = new mongoose.Schema({
    // Frontend uses 'id', but Mongoose uses '_id'. We'll map this in backend/frontend.
    // No need to explicitly define _id here unless customizing.
    startIndex: { type: Number, required: true },
    endIndex: { type: Number, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }, // Store as Date
    author: { type: String, required: true }, // Store instructor name or ID
    isAIGenerated: { type: Boolean, default: false },
}, { _id: true }); // Ensure subdocuments get their own _id

// --- Sub-schema for Sub Scores (Rubric Items) ---
const subScoreSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g., "Content"
    score: { type: Number, required: true, default: 0 },
    maxScore: { type: Number, required: true },
    rationale: { type: String, default: '' },
}, { _id: true });

// --- Sub-schema for Overall Feedback ---
const overallFeedbackSchema = new mongoose.Schema({
    strengths: { type: String, default: '' },
    improvements: { type: String, default: '' },
    actionItems: { type: String, default: '' },
}, { _id: false }); // Typically don't need a separate _id for this grouping

// --- Sub-schemas for AI Checker Results ---
const aiCheckerDetailSchema = new mongoose.Schema({
    section: { type: String },
    aiProbability: { type: Number },
    humanProbability: { type: Number },
}, { _id: false });

const aiCheckerResultSchema = new mongoose.Schema({
    score: { type: Number }, // Overall human-written score %
    confidence: { type: String }, // e.g., "High"
    details: [aiCheckerDetailSchema],
}, { _id: false });

// --- Sub-schemas for Plagiarism Results ---
const plagiarismMatchSchema = new mongoose.Schema({
    text: { type: String },
    source: { type: String },
    similarity: { type: Number }, // e.g., 0.92
}, { _id: true }); // Matches might need unique IDs

const plagiarismResultSchema = new mongoose.Schema({
    score: { type: Number }, 
    matches: [plagiarismMatchSchema],
}, { _id: false });


// --- Main Submission Schema ---
const submissionSchema = new mongoose.Schema({
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true,
    index: true,
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  studentName: {
    type: String,
    trim: true,
    required: false, 
    default: null,
  },
  studentId: { 
    type: String,
    trim: true,
    required: false,
  },
  submissionDate: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'graded', 'late'], // Added 'late' as a possibility
    default: 'pending',
  },
  content: { 
    type: String,
    required: false, // Usually required for review
    default: '',
  },
  score: { 
    type: Number,
    default: null,
  },
  subScores: {
    type: [subScoreSchema],
    default: undefined, // Use undefined so it doesn't create empty array by default
  },
  overallFeedback: {
    type: overallFeedbackSchema,
    default: undefined,
  },
  inlineComments: {
    type: [inlineCommentSchema],
    default: undefined,
  },
  fileUrl: {
    type: String,
    trim: true,
    default: null,
  },
  fileName: {
    type: String,
    trim: true,
    default: null,
  },
  aiCheckerResults: { 
    type: aiCheckerResultSchema,
    default: null,
  },
  plagiarismResults: { 
    type: plagiarismResultSchema,
    default: null,
  },
  // --- KEPT: General Feedback String (can coexist or be replaced by overallFeedback) ---
  feedback: { 
    type: String,
    default: null,
  }
}, {
    timestamps: true, // Adds createdAt, updatedAt
    // Optionally minimize storing empty objects/arrays if not explicitly set
    minimize: true
});

module.exports = mongoose.model('Submission', submissionSchema);
