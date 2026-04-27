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
// ✅ SUPABASE DATABASE (FIXED)
// ==============================
const pool = new Pool({
  user: "postgres.ufbttlxvzuchacptqkee",
  host: "aws-1-ap-south-1.pooler.supabase.com",
  database: "postgres",
  password: "1lqW1fYbCxK4jgr9",
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});


// ==============================
// ✅ TEST ROUTE
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});


// =====================================================
// ✅ CREATE USER
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

    const qr = await QRCode.toDataURL(url);

    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,
      scale: 3,
      height: 10,
    });

    res.json({
      success: true,
      id,
      url,
      qr,
      barcode: barcodeBuffer.toString("base64")
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// ✅ USER PAGE
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
// 🚀 START SERVER (FIXED FOR RENDER)
// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
