// backend/routes/courses.js
const express = require('express');
const mongoose = require('mongoose');
const Course = require('../models/Course'); 
const User = require('../models/User'); 
const authMiddleware = require('../middleware/authMiddleware'); 

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      title,
      courseCode,
      department,
      semester,
      description,
      syllabusData 
    } = req.body;

    const instructorId = req.user.id;

    if (!title || !courseCode) {
      return res.status(400).json({ message: 'Course Title and Course Code are required.' });
    }

    const newCourse = new Course({
      title,
      courseCode,
      department: department || null,
      semester: semester || null,
      description: description || null,
      instructor: instructorId,
      students: [],
      syllabus: syllabusData || null, // <--- Save the syllabus data
    });

    const savedCourse = await newCourse.save();

    res.status(201).json(savedCourse); 

  } catch (error) {
    console.error("Error creating course:", error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((val) => val.message);
      return res.status(400).json({ message: 'Validation failed', errors: messages });
    }
     if (error.code === 11000) { // Duplicate key error
         const field = Object.keys(error.keyPattern)[0];
         return res.status(409).json({ message: `Course with this ${field} might already exist.` });
     }
    res.status(500).json({ message: 'Server error creating course', error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const instructorId = req.user.id;

        // Find courses created by the logged-in user
        // Sort by creation date, newest first
        // Optionally exclude syllabus or students for list view brevity
        const courses = await Course.find({ instructor: instructorId })
                                    .sort({ createdAt: -1 })
                                    .select('-students -syllabus'); // Exclude large fields

        res.status(200).json(courses);

    } catch (error) {
        console.error("Error fetching courses:", error);
        res.status(500).json({ message: 'Server error fetching courses', error: error.message });
    }
});

router.get('/:courseId', authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid course ID format.' });
        }

        // Find the course, populate instructor name/email
        const course = await Course.findById(courseId)
                                    .populate('instructor', 'name email'); // Populate instructor details

        if (!course) {
            return res.status(404).json({ message: 'Course not found.' });
        }

        // Authorization: Ensure the requester is the instructor
        // Convert both to strings for reliable comparison
        if (course.instructor._id.toString() !== userId.toString()) {
             return res.status(403).json({ message: 'You do not have permission to view this course.' });
        }

        res.status(200).json(course); // Send full course data including syllabus

    } catch (error) {
        console.error("Error fetching course details:", error);
        res.status(500).json({ message: 'Server error fetching course details.', error: error.message });
    }
});


router.get('/:courseId/students', authMiddleware, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: 'Invalid course ID format' });
    }

    const course = await Course.findById(courseId)
                               .select('instructor students')
                               .populate('students', '_id name email');

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (course.instructor.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You do not have permission to view this roster.' });
    }

    res.status(200).json(course.students);

  } catch (error) {
    console.error("Error fetching student roster:", error);
    res.status(500).json({ message: 'Server error fetching student roster', error: error.message });
  }
});

router.put('/:courseId', authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;
        const updates = req.body; // Should contain fields to update, e.g., { title: "...", syllabus: {...} }

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid course ID format.' });
        }

        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found.' });
        }

        if (course.instructor.toString() !== userId.toString()) {
             return res.status(403).json({ message: 'You do not have permission to update this course.' });
        }

        const allowedUpdates = ['title', 'courseCode', 'department', 'semester', 'description', 'syllabus', /* 'schedule' */];
        const finalUpdates = {}; // Use index signature

        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                finalUpdates[key] = updates[key]; // Add allowed update fields to finalUpdates
            }
        });

        delete finalUpdates.instructor;
        delete finalUpdates.students;

        const updatedCourse = await Course.findByIdAndUpdate(
            courseId,
            { $set: finalUpdates }, // Use $set to update only specified fields
            { new: true, runValidators: true } // Return the updated doc, run schema validators
        ).populate('instructor', 'name email'); // Populate instructor for response

        if (!updatedCourse) { // Should not happen if findById worked, but good practice
             return res.status(404).json({ message: 'Course not found after update attempt.' });
        }

        res.status(200).json(updatedCourse);

    } catch (error) {
        console.error("Error updating course:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map((val) => val.message);
            return res.status(400).json({ message: 'Validation failed', errors: messages });
        }
        if (error.code === 11000) {
             const field = Object.keys(error.keyPattern)[0];
             return res.status(409).json({ message: `Course with this ${field} might already exist.` });
        }
        res.status(500).json({ message: 'Server error updating course.', error: error.message });
    }
});


router.delete('/:courseId', authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid course ID format.' });
        }

        const course = await Course.findOne({ _id: courseId, instructor: userId });

        if (!course) {
            // Check if it exists at all
            const courseExists = await Course.findById(courseId).select('_id');
            if (!courseExists) {
                return res.status(404).json({ message: 'Course not found.' });
            } else {
                return res.status(403).json({ message: 'You do not have permission to delete this course.' });
            }
        }

        // TODO: Consider implications - delete associated assignments/submissions?
        // For now, just delete the course document.
        await Course.findByIdAndDelete(courseId);

        res.status(200).json({ message: 'Course deleted successfully.' });

    } catch (error) {
        console.error("Error deleting course:", error);
        res.status(500).json({ message: 'Server error deleting course.', error: error.message });
    }
});


router.post('/:courseId/enroll', authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { studentId } = req.body; 
        const instructorId = req.user.id; 

        if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ message: 'Invalid Course or Student ID format.' });
        }

        const course = await Course.findById(courseId);
        if (!course) { return res.status(404).json({ message: 'Course not found.' }); }

        // Authorization: Only instructor can enroll
        if (course.instructor.toString() !== instructorId.toString()) {
            return res.status(403).json({ message: 'Only the instructor can enroll students.' });
        }

        // Check if student exists
        const student = await User.findById(studentId);
        if (!student) { return res.status(404).json({ message: 'Student not found.' }); }

        // Add student to the course's students array if not already present
        // Use $addToSet to prevent duplicates
        const updatedCourse = await Course.findByIdAndUpdate(
            courseId,
            { $addToSet: { students: studentId } },
            { new: true }
        );

        res.status(200).json({ message: `Student enrolled successfully.`, course: updatedCourse }); // Send back updated course maybe?

    } catch (error) {
        console.error("Error enrolling student:", error);
        res.status(500).json({ message: 'Server error enrolling student.', error: error.message });
    }
});


module.exports = router;
