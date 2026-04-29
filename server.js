const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

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
// ✅ SERVE GENERATED FILES
// ==============================
app.use("/temp", express.static(path.join(__dirname, "temp")));

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

    // Generate QR Code as buffer
    const qrBuffer = await QRCode.toBuffer(url);
    const qrPath = path.join(__dirname, "temp", `${id}-qr.png`);
    
    if (!fs.existsSync(path.join(__dirname, "temp"))) {
      fs.mkdirSync(path.join(__dirname, "temp"));
    }

    fs.writeFileSync(qrPath, qrBuffer);

    // Generate Barcode (NARROW & MACHINE-SCANNABLE)
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: url, // Full URL
      scale: 0.8,  // Reduced scale for narrower bars
      width: 1,    // Explicitly set narrow width
      height: 10,  // Shorter height
      includetext: false, // Remove text to save space
      textxalign: "center",
      padding: 1,  // Minimal padding
      backgroundcolor: "ffffff",
      barcolor: "000000",
      guardwhitespace: false, // Remove extra whitespace
      parsealt: true, // Enable parsing for better machine readability
    });

    const barcodePath = path.join(__dirname, "temp", `${id}-barcode.png`);
    fs.writeFileSync(barcodePath, barcodeBuffer);

    res.json({
      success: true,
      id,
      url,
      qr: qrBuffer.toString("base64"),
      barcode: barcodeBuffer.toString("base64"),
      qrPath,
      barcodePath
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ✅ SHARE VIA INTERAKT
// ==============================
app.post("/share-interakt", async (req, res) => {
  try {
    const { id, phone } = req.body;

    const qrUrl = `https://google-form-kebh.onrender.com/temp/${id}-qr.png`;
    const barcodeUrl = `https://google-form-kebh.onrender.com/temp/${id}-barcode.png`;

    const interaktNumber = phone.startsWith("+") ? phone : `+91${phone}`;

    const interaktApiUrl = "https://api.interakt.io/v1";
    const interaktApiKey = "ODRvSkhXcG9HcXYtTkRFODlrZ0NBa0lBeERxRFFJX2ZlWEItbE5ucjFQWTo=";

    // Send QR Code
    const qrResponse = await fetch(`${interaktApiUrl}/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${interaktApiKey}`
      },
      body: JSON.stringify({
        phoneNumber: interaktNumber,
        message: "Your QR Code:",
        mediaUrl: qrUrl
      })
    });

    // Send Barcode
    const barcodeResponse = await fetch(`${interaktApiUrl}/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${interaktApiKey}`
      },
      body: JSON.stringify({
        phoneNumber: interaktNumber,
        message: "Your Barcode:",
        mediaUrl: barcodeUrl
      })
    });

    res.json({
      success: true,
      qrSent: qrResponse.ok,
      barcodeSent: barcodeResponse.ok
    });

  } catch (err) {
    console.error("❌ Interakt Error:", err);
    res.status(500).json({ error: err.message });
  }
});

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
