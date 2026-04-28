const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https");

const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// ✅ SUPABASE DATABASE (FIXED)
// ==============================
const pool = new Pool({
  user: "postgres.ufbttlxvzuchacptqkee",
  host: "aws-1-ap-south-1.pooler.supabase.com",
  database: "postgres",
  password: "1lqW1fYbCxK4jgr9",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// ==============================
// ✅ TEST ROUTE
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});

// ==============================
// ✅ CREATE USER (WITH QR & BARCODE)
// ==============================
app.post("/create", async (req, res) => {
  try {
    const {
      fullName,
      address,
      email,
      phone,
      dob,
      date,
      tradingMarket,
      tradingType,
      source,
      softwareUsed,
      previousCourse,
      level,
      amount,
      paymentMode
    } = req.body;

    console.log("📩 Incoming Data:", req.body);

    const id = uuidv4();

    await pool.query(
      `INSERT INTO users(
        id, full_name, address, email, phone, dob, date,
        trading_market, trading_type, source,
        software_used, previous_course, level,
        amount, payment_mode
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, fullName, address, email, phone, dob, date,
        tradingMarket, tradingType, source,
        softwareUsed, previousCourse, level,
        amount, paymentMode
      ]
    );

    const url = `https://google-form-kebh.onrender.com/user/${id}`;

    // Generate QR Code
    const qr = await QRCode.toDataURL(url);

    // Generate Barcode (smaller and scannable)
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id.substring(0, 12),
      scale: 2,
      height: 5,
      includetext: false,
      textxalign: "center",
    });

    // Save QR and Barcode to temporary files
    const qrPath = path.join(__dirname, "temp", `${id}-qr.png`);
    const barcodePath = path.join(__dirname, "temp", `${id}-barcode.png`);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "temp"))) {
      fs.mkdirSync(path.join(__dirname, "temp"));
    }

    // Save files
    fs.writeFileSync(qrPath, qr.split(",")[1], "base64");
    fs.writeFileSync(barcodePath, barcodeBuffer, "base64");

    // Upload to Google Drive (or cloud storage)
    const qrUrl = await uploadToGoogleDrive(qrPath, `${id}-qr.png`);
    const barcodeUrl = await uploadToGoogleDrive(barcodePath, `${id}-barcode.png`);

    res.json({
      success: true,
      id,
      url,
      qr,
      barcode: barcodeBuffer.toString("base64"),
      qrUrl,
      barcodeUrl
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ✅ SHARE VIA INTERAKT (FIXED WITH SSL HANDLING)
// ==============================
app.post("/share-interakt", async (req, res) => {
  try {
    const { phone, qrUrl, barcodeUrl } = req.body;

    // Convert phone to international format
    const interaktNumber = phone.startsWith("+") ? phone : `+91${phone}`;

    // Interakt API Configuration
    const interaktApiUrl = "https://api.interakt.io/v1";
    const interaktApiKey = "ODRvSkhXcG9HcXYtTkRFODlrZ0NBa0lBeERxRFFJX2ZlWEItbE5ucjFQWTo=";

    // SSL workaround (temporary fix)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false // Not recommended for production
    });

    // Debug: Log the request
    console.log("🔍 Sending to Interakt:", {
      url: `${interaktApiUrl}/whatsapp/send`,
      phone: interaktNumber,
      qrUrl,
      barcodeUrl
    });

    // Send QR Code via Interakt
    const qrResponse = await axios.post(
      `${interaktApiUrl}/whatsapp/send`,
      {
        phoneNumber: interaktNumber,
        message: "Your QR Code:",
        mediaUrl: qrUrl
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${interaktApiKey}`
        },
        httpsAgent,
        timeout: 30000
      }
    );

    // Send Barcode via Interakt
    const barcodeResponse = await axios.post(
      `${interaktApiUrl}/whatsapp/send`,
      {
        phoneNumber: interaktNumber,
        message: "Your Barcode:",
        mediaUrl: barcodeUrl
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${interaktApiKey}`
        },
        httpsAgent,
        timeout: 30000
      }
    );

    // Log results
    console.log("📱 QR Sent:", qrResponse.status === 200);
    console.log("📱 Barcode Sent:", barcodeResponse.status === 200);

    res.json({
      success: true,
      qrSent: qrResponse.status === 200,
      barcodeSent: barcodeResponse.status === 200
    });

  } catch (err) {
    console.error("❌ Interakt Error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ✅ UPLOAD TO GOOGLE DRIVE (IMPLEMENTATION NEEDED)
// ==============================
async function uploadToGoogleDrive(filePath, filename) {
  try {
    // TODO: Replace with actual Google Drive API integration
    // Example:
    // 1. Set up Google Cloud Console project
    // 2. Create Service Account & download credentials
    // 3. Install Google Drive API: `npm install @googleapis/drive`
    // 4. Implement upload logic
    
    // For now, return a placeholder URL
    return `https://drive.google.com/uc?id=${uuidv4()}`;
    
  } catch (err) {
    console.error("❌ Google Drive Upload Error:", err);
    return null;
  }
}

// ==============================
// ✅ USER PAGE (DISPLAYS USER DETAILS)
// ==============================
app.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.send("<h2>❌ Invalid QR Code</h2>");
    }

    const user = result.rows[0];

    res.send(`
      <div style="text-align:center; font-family:sans-serif; padding:20px; max-width:600px; margin:0 auto;">
        <h2>✅ Verified Student</h2>
        <p><strong>Name:</strong> ${user.full_name}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Phone:</strong> ${user.phone}</p>
        <p><strong>Address:</strong> ${user.address}</p>
        <p><strong>Date of Birth:</strong> ${user.dob}</p>
        <p><strong>Trading Market:</strong> ${user.trading_market}</p>
        <p><strong>Trading Type:</strong> ${user.trading_type}</p>
        <p><strong>Source:</strong> ${user.source}</p>
        <p><strong>Software Used:</strong> ${user.software_used}</p>
        <p><strong>Previous Course:</strong> ${user.previous_course}</p>
        <p><strong>Level:</strong> ${user.level}</p>
        <p><strong>Amount Paid:</strong> ${user.amount}</p>
        <p><strong>Payment Mode:</strong> ${user.payment_mode}</p>
        <hr>
        <p><small>Scan this QR/Barcode again to reload</small></p>
      </div>
    `);

  } catch (err) {
    console.error(err);
    res.send("Error loading user");
  }
});

// ==============================
// 🚀 START SERVER (FIXED FOR RENDER)
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
