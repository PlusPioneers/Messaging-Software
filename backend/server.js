const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors({
    origin: '*', // In production, specify your domain
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files (your booking widget)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
const db = new sqlite3.Database('./bookings.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create tables if they don't exist
db.serialize(() => {
    // Doctors table
    db.run(`
        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            department TEXT NOT NULL,
            contact TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Doctor availability table
    db.run(`
        CREATE TABLE IF NOT EXISTS doctor_availability (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_id INTEGER NOT NULL,
            day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            slot_duration INTEGER DEFAULT 30, -- minutes
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (doctor_id) REFERENCES doctors (id)
        )
    `);

    // Doctor blocked dates table
    db.run(`
        CREATE TABLE IF NOT EXISTS doctor_blocked_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_id INTEGER NOT NULL,
            blocked_date TEXT NOT NULL,
            reason TEXT,
            FOREIGN KEY (doctor_id) REFERENCES doctors (id)
        )
    `);

    // Updated bookings table
    db.run(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_name TEXT NOT NULL,
            patient_email TEXT,
            patient_phone TEXT NOT NULL,
            doctor_id INTEGER NOT NULL,
            appointment_date TEXT NOT NULL,
            appointment_time TEXT NOT NULL,
            is_followup INTEGER DEFAULT 0,
            notes TEXT,
            status TEXT DEFAULT 'confirmed',
            booking_reference TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (doctor_id) REFERENCES doctors (id)
        )
    `);

    // Insert sample doctors if none exist
    db.get('SELECT COUNT(*) as count FROM doctors', (err, row) => {
        if (!err && row.count === 0) {
            const sampleDoctors = [
                ['Dr. Sarah Johnson', 'Cardiology', '+1-555-0101'],
                ['Dr. Michael Chen', 'Neurology', '+1-555-0102'],
                ['Dr. Emily Rodriguez', 'Pediatrics', '+1-555-0103'],
                ['Dr. David Kim', 'Orthopedics', '+1-555-0104'],
                ['Dr. Lisa Thompson', 'Dermatology', '+1-555-0105']
            ];

            const stmt = db.prepare('INSERT INTO doctors (name, department, contact) VALUES (?, ?, ?)');
            sampleDoctors.forEach(doctor => {
                stmt.run(doctor);
            });
            stmt.finalize();

            // Add sample availability for each doctor
            setTimeout(() => {
                db.all('SELECT id FROM doctors', (err, doctors) => {
                    if (!err) {
                        const availStmt = db.prepare(`
                            INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration) 
                            VALUES (?, ?, ?, ?, ?)
                        `);
                        
                        doctors.forEach(doctor => {
                            // Monday to Friday, 9 AM to 5 PM, 30-minute slots
                            for (let day = 1; day <= 5; day++) {
                                availStmt.run([doctor.id, day, '09:00', '17:00', 30]);
                            }
                        });
                        availStmt.finalize();
                    }
                });
            }, 100);
        }
    });
});

// Email configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'essstellers@gmail.com',
        pass: 'thahir2005@'
    }
});

// Generate booking reference
function generateBookingReference() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Medical booking system is working!' });
});

// Get all doctors
app.get('/api/doctors', (req, res) => {
    db.all('SELECT * FROM doctors WHERE is_active = 1 ORDER BY name', (err, doctors) => {
        if (err) {
            console.error('Error fetching doctors:', err);
            return res.status(500).json({ success: false, message: 'Error fetching doctors' });
        }
        res.json({ success: true, doctors });
    });
});

// Add new doctor
app.post('/api/doctors', (req, res) => {
    const { name, department, contact } = req.body;
    
    if (!name || !department) {
        return res.status(400).json({ success: false, message: 'Name and department are required' });
    }

    db.run(
        'INSERT INTO doctors (name, department, contact) VALUES (?, ?, ?)',
        [name, department, contact || ''],
        function(err) {
            if (err) {
                console.error('Error adding doctor:', err);
                return res.status(500).json({ success: false, message: 'Error adding doctor' });
            }
            res.json({ success: true, doctorId: this.lastID });
        }
    );
});

// Update doctor
app.put('/api/doctors/:id', (req, res) => {
    const { id } = req.params;
    const { name, department, contact, is_active } = req.body;
    
    db.run(
        'UPDATE doctors SET name = ?, department = ?, contact = ?, is_active = ? WHERE id = ?',
        [name, department, contact, is_active !== undefined ? is_active : 1, id],
        function(err) {
            if (err) {
                console.error('Error updating doctor:', err);
                return res.status(500).json({ success: false, message: 'Error updating doctor' });
            }
            res.json({ success: true });
        }
    );
});

// Get doctor availability
app.get('/api/doctors/:id/availability', (req, res) => {
    const { id } = req.params;
    
    db.all(
        'SELECT * FROM doctor_availability WHERE doctor_id = ? AND is_active = 1',
        [id],
        (err, availability) => {
            if (err) {
                console.error('Error fetching availability:', err);
                return res.status(500).json({ success: false, message: 'Error fetching availability' });
            }
            res.json({ success: true, availability });
        }
    );
});

// Set doctor availability
app.post('/api/doctors/:id/availability', (req, res) => {
    const { id } = req.params;
    const { availability } = req.body;
    
    // First, deactivate all existing availability
    db.run('UPDATE doctor_availability SET is_active = 0 WHERE doctor_id = ?', [id], (err) => {
        if (err) {
            console.error('Error updating availability:', err);
            return res.status(500).json({ success: false, message: 'Error updating availability' });
        }
        
        // Insert new availability
        const stmt = db.prepare(`
            INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration) 
            VALUES (?, ?, ?, ?, ?)
        `);
        
        availability.forEach(slot => {
            stmt.run([id, slot.day_of_week, slot.start_time, slot.end_time, slot.slot_duration || 30]);
        });
        
        stmt.finalize((err) => {
            if (err) {
                console.error('Error inserting availability:', err);
                return res.status(500).json({ success: false, message: 'Error setting availability' });
            }
            res.json({ success: true });
        });
    });
});

// Get available time slots for a doctor on a specific date
app.get('/api/doctors/:id/slots/:date', (req, res) => {
    const { id, date } = req.params;
    
    const selectedDate = new Date(date);
    const dayOfWeek = selectedDate.getDay();
    
    // Get doctor's availability for this day
    db.get(
        'SELECT * FROM doctor_availability WHERE doctor_id = ? AND day_of_week = ? AND is_active = 1',
        [id, dayOfWeek],
        (err, availability) => {
            if (err) {
                console.error('Error fetching availability:', err);
                return res.status(500).json({ success: false, message: 'Error checking availability' });
            }
            
            if (!availability) {
                return res.json({ success: true, availableSlots: [] });
            }
            
            // Check if date is blocked
            db.get(
                'SELECT * FROM doctor_blocked_dates WHERE doctor_id = ? AND blocked_date = ?',
                [id, date],
                (err, blocked) => {
                    if (err) {
                        console.error('Error checking blocked dates:', err);
                        return res.status(500).json({ success: false, message: 'Error checking availability' });
                    }
                    
                    if (blocked) {
                        return res.json({ success: true, availableSlots: [] });
                    }
                    
                    // Generate time slots
                    const slots = generateTimeSlots(availability.start_time, availability.end_time, availability.slot_duration);
                    
                    // Get booked slots
                    db.all(
                        'SELECT appointment_time FROM bookings WHERE doctor_id = ? AND appointment_date = ? AND status != "cancelled"',
                        [id, date],
                        (err, bookedSlots) => {
                            if (err) {
                                console.error('Error fetching booked slots:', err);
                                return res.status(500).json({ success: false, message: 'Error checking availability' });
                            }
                            
                            const bookedTimes = bookedSlots.map(slot => slot.appointment_time);
                            const availableSlots = slots.filter(slot => !bookedTimes.includes(slot));
                            
                            res.json({ success: true, availableSlots });
                        }
                    );
                }
            );
        }
    );
});

// Generate time slots helper function
function generateTimeSlots(startTime, endTime, duration) {
    const slots = [];
    const start = new Date(`2000-01-01 ${startTime}`);
    const end = new Date(`2000-01-01 ${endTime}`);
    
    let current = new Date(start);
    while (current < end) {
        slots.push(current.toTimeString().slice(0, 5));
        current.setMinutes(current.getMinutes() + duration);
    }
    
    return slots;
}

// Create new booking
app.post('/api/bookings', (req, res) => {
    const {
        patientName,
        patientEmail,
        patientPhone,
        doctorId,
        appointmentDate,
        appointmentTime,
        isFollowup,
        notes
    } = req.body;

    // Validate required fields
    if (!patientName || !patientPhone || !doctorId || !appointmentDate || !appointmentTime) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: patientName, patientPhone, doctorId, appointmentDate, appointmentTime'
        });
    }

    // Check if the selected date is not in the past
    const selectedDate = new Date(appointmentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
        return res.status(400).json({
            success: false,
            message: 'Cannot book appointments in the past'
        });
    }

    // Check if slot is available
    db.get(
        'SELECT id FROM bookings WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != "cancelled"',
        [doctorId, appointmentDate, appointmentTime],
        (err, existingBooking) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Database error occurred'
                });
            }

            if (existingBooking) {
                return res.status(409).json({
                    success: false,
                    message: 'This time slot is already booked. Please choose a different time.'
                });
            }

            const bookingReference = generateBookingReference();

            // Insert new booking
            db.run(
                `INSERT INTO bookings (patient_name, patient_email, patient_phone, doctor_id, 
                 appointment_date, appointment_time, is_followup, notes, booking_reference) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [patientName, patientEmail || '', patientPhone, doctorId, appointmentDate, 
                 appointmentTime, isFollowup ? 1 : 0, notes || '', bookingReference],
                function(err) {
                    if (err) {
                        console.error('Insert error:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Failed to save booking'
                        });
                    }

                    // Get doctor info for confirmation
                    db.get('SELECT name FROM doctors WHERE id = ?', [doctorId], (err, doctor) => {
                        if (err) {
                            console.error('Error fetching doctor:', err);
                        }

                        const doctorName = doctor ? doctor.name : 'Unknown Doctor';

                        // Send confirmation email if email provided
                        if (patientEmail) {
                            const mailOptions = {
                                from: 'essstellers@gmail.com',
                                to: patientEmail,
                                subject: 'Appointment Confirmation',
                                html: `
                                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                        <h2 style="color: #2563eb;">Appointment Confirmed</h2>
                                        <p>Dear <strong>${patientName}</strong>,</p>
                                        <p>Your appointment has been successfully booked with the following details:</p>
                                        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb;">
                                            <ul style="list-style: none; padding: 0;">
                                                <li><strong>Booking Reference:</strong> ${bookingReference}</li>
                                                <li><strong>Doctor:</strong> ${doctorName}</li>
                                                <li><strong>Date:</strong> ${appointmentDate}</li>
                                                <li><strong>Time:</strong> ${appointmentTime}</li>
                                                <li><strong>Follow-up:</strong> ${isFollowup ? 'Yes' : 'No'}</li>
                                                ${notes ? `<li><strong>Notes:</strong> ${notes}</li>` : ''}
                                            </ul>
                                        </div>
                                        <p>Please arrive 15 minutes before your scheduled appointment time.</p>
                                        <p style="font-size: 12px; color: #64748b;">
                                            If you need to cancel or reschedule, please contact us with your booking reference: ${bookingReference}
                                        </p>
                                    </div>
                                `
                            };

                            transporter.sendMail(mailOptions, (emailErr, info) => {
                                if (emailErr) {
                                    console.log('Email sending failed:', emailErr.message);
                                } else {
                                    console.log('Confirmation email sent:', info.messageId);
                                }
                            });
                        }

                        res.json({
                            success: true,
                            message: 'Appointment booked successfully!',
                            bookingId: this.lastID,
                            bookingReference: bookingReference,
                            doctorName: doctorName
                        });
                    });
                }
            );
        }
    );
});

// Get all bookings with doctor information
app.get('/api/bookings', (req, res) => {
    const query = `
        SELECT b.*, d.name as doctor_name, d.department 
        FROM bookings b 
        JOIN doctors d ON b.doctor_id = d.id 
        ORDER BY b.appointment_date DESC, b.appointment_time DESC
    `;
    
    db.all(query, [], (err, bookings) => {
        if (err) {
            console.error('Error fetching bookings:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching bookings' 
            });
        }
        res.json({
            success: true,
            bookings: bookings
        });
    });
});

// Update booking status
app.put('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const { status, appointmentDate, appointmentTime, doctorId } = req.body;
    
    let updateQuery = 'UPDATE bookings SET ';
    let updateParams = [];
    let updateFields = [];
    
    if (status) {
        if (!['confirmed', 'cancelled', 'completed', 'needs_followup'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be: confirmed, cancelled, completed, or needs_followup'
            });
        }
        updateFields.push('status = ?');
        updateParams.push(status);
    }
    
    if (appointmentDate) {
        updateFields.push('appointment_date = ?');
        updateParams.push(appointmentDate);
    }
    
    if (appointmentTime) {
        updateFields.push('appointment_time = ?');
        updateParams.push(appointmentTime);
    }
    
    if (doctorId) {
        updateFields.push('doctor_id = ?');
        updateParams.push(doctorId);
    }
    
    if (updateFields.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No fields to update'
        });
    }
    
    updateQuery += updateFields.join(', ') + ' WHERE id = ?';
    updateParams.push(id);
    
    db.run(updateQuery, updateParams, function(err) {
        if (err) {
            console.error('Update error:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error updating booking' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Booking updated successfully' 
        });
    });
});

// Search bookings
app.get('/api/bookings/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({
            success: false,
            message: 'Search query is required'
        });
    }
    
    const searchQuery = `
        SELECT b.*, d.name as doctor_name, d.department 
        FROM bookings b 
        JOIN doctors d ON b.doctor_id = d.id 
        WHERE b.patient_name LIKE ? OR b.patient_phone LIKE ? OR b.booking_reference LIKE ?
        ORDER BY b.appointment_date DESC, b.appointment_time DESC
    `;
    
    const searchTerm = `%${query}%`;
    
    db.all(searchQuery, [searchTerm, searchTerm, searchTerm], (err, bookings) => {
        if (err) {
            console.error('Error searching bookings:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error searching bookings' 
            });
        }
        res.json({
            success: true,
            bookings: bookings
        });
    });
});

// Get booking by reference
app.get('/api/bookings/reference/:ref', (req, res) => {
    const { ref } = req.params;
    
    const query = `
        SELECT b.*, d.name as doctor_name, d.department 
        FROM bookings b 
        JOIN doctors d ON b.doctor_id = d.id 
        WHERE b.booking_reference = ?
    `;
    
    db.get(query, [ref], (err, booking) => {
        if (err) {
            console.error('Error fetching booking:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching booking' 
            });
        }
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }
        
        res.json({
            success: true,
            booking: booking
        });
    });
});

// Block doctor date
app.post('/api/doctors/:id/block-date', (req, res) => {
    const { id } = req.params;
    const { date, reason } = req.body;
    
    db.run(
        'INSERT INTO doctor_blocked_dates (doctor_id, blocked_date, reason) VALUES (?, ?, ?)',
        [id, date, reason || 'Unavailable'],
        function(err) {
            if (err) {
                console.error('Error blocking date:', err);
                return res.status(500).json({ success: false, message: 'Error blocking date' });
            }
            res.json({ success: true });
        }
    );
});

// Export bookings to CSV
app.get('/api/bookings/export', (req, res) => {
    const query = `
        SELECT 
            b.booking_reference,
            b.patient_name,
            b.patient_phone,
            b.patient_email,
            d.name as doctor_name,
            d.department,
            b.appointment_date,
            b.appointment_time,
            CASE WHEN b.is_followup = 1 THEN 'Yes' ELSE 'No' END as is_followup,
            b.status,
            b.notes,
            b.created_at
        FROM bookings b 
        JOIN doctors d ON b.doctor_id = d.id 
        ORDER BY b.appointment_date DESC, b.appointment_time DESC
    `;
    
    db.all(query, [], (err, bookings) => {
        if (err) {
            console.error('Error exporting bookings:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error exporting bookings' 
            });
        }
        
        // Convert to CSV
        const headers = [
            'Booking Reference', 'Patient Name', 'Phone', 'Email', 'Doctor', 'Department',
            'Date', 'Time', 'Follow-up', 'Status', 'Notes', 'Created At'
        ];
        
        let csv = headers.join(',') + '\n';
        
        bookings.forEach(booking => {
            const row = [
                booking.booking_reference,
                `"${booking.patient_name}"`,
                booking.patient_phone,
                booking.patient_email || '',
                `"${booking.doctor_name}"`,
                `"${booking.department}"`,
                booking.appointment_date,
                booking.appointment_time,
                booking.is_followup,
                booking.status,
                `"${(booking.notes || '').replace(/"/g, '""')}"`,
                booking.created_at
            ];
            csv += row.join(',') + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=bookings.csv');
        res.send(csv);
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Medical booking system running on http://localhost:${PORT}`);
    console.log(`Admin panel available at http://localhost:${PORT}/admin.html`);
    console.log(`Booking widget available at http://localhost:${PORT}/booking-widget.html`);
    console.log(`API test endpoint: http://localhost:${PORT}/api/test`);
});

// Gracefully close database connection on exit
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});