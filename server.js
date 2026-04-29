const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { createCanvas, loadImage } = require("canvas");

const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// ✅ DATABASE
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
// ✅ TEMP FOLDER
// ==============================
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

app.use("/temp", express.static(tempDir));

// ==============================
// 🏠 HOME
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});

// ==============================
// 🎟️ GENERATE FINAL IMAGE
// ==============================
async function generateFinalImage(id) {
  const qrPath = path.join(tempDir, `${id}-qr.png`);
  const barcodePath = path.join(tempDir, `${id}-barcode.png`);

  const qr = await loadImage(qrPath);
  const barcode = await loadImage(barcodePath);

  const canvas = createCanvas(700, 900);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 700, 900);

  ctx.fillStyle = "#000";
  ctx.font = "bold 34px Arial";
  ctx.fillText("ENTRY PASS", 220, 60);

  ctx.drawImage(qr, 200, 120, 300, 300);
  ctx.drawImage(barcode, 100, 480, 500, 150);

  ctx.font = "20px Arial";
  ctx.fillText("Scan QR or Barcode at Entry", 160, 750);

  const finalPath = path.join(tempDir, `${id}-final.png`);
  fs.writeFileSync(finalPath, canvas.toBuffer("image/png"));

  return `https://google-form-kebh.onrender.com/temp/${id}-final.png`;
}

// ==============================
// 👤 CREATE USER
// ==============================
app.post("/create", async (req, res) => {
  try {
    const {
      fullName, address, email, phone, dob, date,
      tradingMarket, tradingType, source,
      softwareUsed, previousCourse, level,
      amount, paymentMode
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

    // QR
    const qrBuffer = await QRCode.toBuffer(url);
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    // Barcode
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: url,
      scale: 5,
      height: 20,
      includetext: true
    });
    fs.writeFileSync(path.join(tempDir, `${id}-barcode.png`), barcodeBuffer);

    res.json({ success: true, id });

  } catch (err) {
    console.error("❌ CREATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📲 SHARE INTERAKT
// ==============================
app.post("/share-interakt", async (req, res) => {
  try {
    const { id, phone } = req.body;

    // ✅ Get user
    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // Generate image
    const finalImageUrl = await generateFinalImage(id);

    const phoneNumber = phone.replace("+91", "").replace("+", "");

    // ✅ Interakt API
    const response = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.INTERAKT_API_KEY}`
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: phoneNumber,
        type: "Image",
        data: {
          image: {
            url: finalImageUrl,
            caption: `🎟️ Entry Pass
Name: ${user.full_name}
Course: ${user.trading_market}
Amount: ₹${user.amount}
Scan QR or Barcode at entry`
          }
        }
      })
    });

    const data = await response.json();
    console.log("📱 Interakt Response:", data);

    // 🧹 Cleanup
    setTimeout(() => {
      try {
        fs.unlinkSync(path.join(tempDir, `${id}-qr.png`));
        fs.unlinkSync(path.join(tempDir, `${id}-barcode.png`));
        fs.unlinkSync(path.join(tempDir, `${id}-final.png`));
      } catch (err) {
        console.log("Cleanup error:", err.message);
      }
    }, 60000);

    res.json({ success: true, data });

  } catch (err) {
    console.error("❌ Interakt Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 👤 USER PAGE
// ==============================
app.get("/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.send("<h2>❌ Invalid QR</h2>");
    }

    const u = result.rows[0];

    res.send(`
      <div style="text-align:center;font-family:sans-serif">
        <h2>✅ Verified Student</h2>
        <p><strong>Name:</strong> ${u.full_name}</p>
        <p><strong>Email:</strong> ${u.email}</p>
        <p><strong>Phone:</strong> ${u.phone}</p>
      </div>
    `);

  } catch (err) {
    res.send("Error loading user");
  }
});

// ==============================
// 🚀 START SERVER
// ==============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
