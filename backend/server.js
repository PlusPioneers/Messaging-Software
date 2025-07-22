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

// Create bookings table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        service_type TEXT NOT NULL,
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
    } else {
        console.log('Bookings table ready.');
    }
});

// Email configuration (you'll need to update these settings)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // Use Gmail SMTP for testing
    port: 587,
    secure: false,
    auth: {
        user: 'essstellers@gmail.com', // Replace with your Gmail
        pass: 'thahir2005@'     // Replace with Gmail App Password
    }
});

// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Backend is working!' });
});

// Create new booking
app.post('/api/bookings', (req, res) => {
    console.log('Received booking request:', req.body);
    
    const {
        customerName,
        customerEmail,
        customerPhone,
        serviceType,
        appointmentDate,
        appointmentTime,
        notes
    } = req.body;

    // Validate required fields
    if (!customerName || !customerEmail || !serviceType || !appointmentDate || !appointmentTime) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: customerName, customerEmail, serviceType, appointmentDate, appointmentTime'
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
        'SELECT id FROM bookings WHERE appointment_date = ? AND appointment_time = ? AND status != "cancelled"',
        [appointmentDate, appointmentTime],
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

            // Insert new booking
            db.run(
                `INSERT INTO bookings (customer_name, customer_email, customer_phone, service_type, 
                 appointment_date, appointment_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [customerName, customerEmail, customerPhone || '', serviceType, appointmentDate, appointmentTime, notes || ''],
                function(err) {
                    if (err) {
                        console.error('Insert error:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Failed to save booking'
                        });
                    }

                    console.log('Booking saved with ID:', this.lastID);

                    // Send confirmation email (optional - may fail if email not configured)
                    const mailOptions = {
                        from: 'your-email@gmail.com',
                        to: customerEmail,
                        subject: 'Appointment Confirmation',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #333;">Appointment Confirmed</h2>
                                <p>Dear <strong>${customerName}</strong>,</p>
                                <p>Your appointment has been successfully booked with the following details:</p>
                                <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                    <ul style="list-style: none; padding: 0;">
                                        <li><strong>Service:</strong> ${serviceType}</li>
                                        <li><strong>Date:</strong> ${appointmentDate}</li>
                                        <li><strong>Time:</strong> ${appointmentTime}</li>
                                        ${notes ? `<li><strong>Notes:</strong> ${notes}</li>` : ''}
                                    </ul>
                                </div>
                                <p>We look forward to seeing you!</p>
                                <p style="font-size: 12px; color: #666;">
                                    If you need to cancel or reschedule, please contact us as soon as possible.
                                </p>
                            </div>
                        `
                    };

                    transporter.sendMail(mailOptions, (emailErr, info) => {
                        if (emailErr) {
                            console.log('Email sending failed:', emailErr.message);
                            // Don't fail the booking if email fails
                        } else {
                            console.log('Confirmation email sent:', info.messageId);
                        }
                    });

                    res.json({
                        success: true,
                        message: 'Booking confirmed successfully!',
                        bookingId: this.lastID
                    });
                }
            );
        }
    );
});

// Get all bookings (for admin)
app.get('/api/bookings', (req, res) => {
    db.all(
        'SELECT * FROM bookings ORDER BY appointment_date DESC, appointment_time DESC',
        [],
        (err, bookings) => {
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
        }
    );
});

// Update booking status
app.put('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status || !['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid status. Must be: pending, confirmed, cancelled, or completed'
        });
    }
    
    db.run(
        'UPDATE bookings SET status = ? WHERE id = ?',
        [status, id],
        function(err) {
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
                message: 'Booking status updated successfully' 
            });
        }
    );
});

// Get available slots for a specific date
app.get('/api/available-slots/:date', (req, res) => {
    const { date } = req.params;
    
    // Define all possible time slots
    const allSlots = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
        '16:00', '16:30', '17:00'
    ];
    
    db.all(
        'SELECT appointment_time FROM bookings WHERE appointment_date = ? AND status != "cancelled"',
        [date],
        (err, bookedSlots) => {
            if (err) {
                console.error('Error fetching booked slots:', err);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error checking availability' 
                });
            }
            
            const bookedTimes = bookedSlots.map(slot => slot.appointment_time);
            const availableSlots = allSlots.filter(slot => !bookedTimes.includes(slot));
            
            res.json({ 
                success: true,
                availableSlots: availableSlots,
                bookedSlots: bookedTimes
            });
        }
    );
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin panel will be available at http://localhost:${PORT}/admin`);
    console.log(`🎯 API test endpoint: http://localhost:${PORT}/api/test`);
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
