const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// 🔐 DATABASE CONFIG (HARDCODED)
// ==============================
const pool = new Pool({
  user: "postgres.ufbttlxvzuchacptqkee",
  host: "aws-1-ap-south-1.pooler.supabase.com",
  database: "postgres",
  password: "1lqW1fYbCxK4jgr9",   // 👉 change this
  port: 5432,
});

// ==============================
// ✅ TEST ROUTE
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});


// =====================================================
// ✅ CREATE USER (FROM GOOGLE FORM)
// =====================================================
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

    // 🔐 Generate Unique ID
    const id = uuidv4();

    // 💾 Insert into DB
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

    // 🔗 URL for QR
    const url = `https://google-form-kebh.onrender.com/user/${id}`;

    // 📷 Generate QR Code
    const qr = await QRCode.toDataURL(url);

    // 📊 Generate Barcode
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,
      scale: 3,
      height: 10,
    });

    const barcode = barcodeBuffer.toString("base64");

    res.json({
      success: true,
      id,
      url,
      qr,
      barcode
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Server Error" });
  }
});


// =====================================================
// ✅ USER PAGE (QR SCAN RESULT)
// =====================================================
app.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT full_name, trading_type FROM users WHERE id=$1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.send("<h2>❌ Invalid QR Code</h2>");
    }

    const user = result.rows[0];

    res.send(`
      <div style="text-align:center; font-family:sans-serif;">
        <h2>✅ Verified Student</h2>
        <p><strong>Name:</strong> ${user.full_name}</p>
        <p><strong>Trading Type:</strong> ${user.trading_type}</p>
        <p><strong>Status:</strong> Active</p>
      </div>
    `);

  } catch (err) {
    console.error(err);
    res.send("Error loading user");
  }
});


// =====================================================
// ✅ BARCODE API
// =====================================================
app.get("/barcode/:id", async (req, res) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: req.params.id,
      scale: 3,
      height: 10,
    });

    res.set("Content-Type", "image/png");
    res.send(png);

  } catch (err) {
    res.status(500).send("Error generating barcode");
  }
});


// ==============================
// 🚀 START SERVER
// ==============================
app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
