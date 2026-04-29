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
  const qr = await loadImage(path.join(tempDir, `${id}-qr.png`));
  const barcode = await loadImage(path.join(tempDir, `${id}-barcode.png`));

  const canvas = createCanvas(700, 900);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 700, 900);

  ctx.fillStyle = "#000";
  ctx.font = "bold 34px Arial";
  ctx.fillText("ENTRY PASS", 220, 60);

  ctx.drawImage(qr, 200, 120, 300, 300);
  ctx.drawImage(barcode, 50, 480, 600, 180); // bigger barcode

  ctx.font = "20px Arial";
  ctx.fillText("Scan QR or Barcode", 200, 750);

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

    // QR → full URL
    const qrBuffer = await QRCode.toBuffer(url);
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    // Barcode → SHORT URL (fix scanning)
  const barcodeBuffer = await bwipjs.toBuffer({
  bcid: "code128",
  text: id,              // ✅ ONLY ID (important)
  scale: 3,              // not too dense
  height: 18,            // taller = better scanning
  includetext: true,     // shows ID below barcode
  textxalign: "center",
  padding: 10
});
    fs.writeFileSync(path.join(tempDir, `${id}-barcode.png`), barcodeBuffer);

    res.json({ success: true, id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📲 SHARE INTERAKT
// ==============================
app.post("/share-interakt", async (req, res) => {
  try {
    const { id, phone } = req.body;

    const cleanPhone = phone.replace(/\D/g, "").slice(-10);

    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [id]
    );

    const user = result.rows[0];

    const finalImageUrl = await generateFinalImage(id);

    const response = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.INTERAKT_API_KEY}`
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: cleanPhone,
        type: "Image",
        data: {
          mediaUrl: finalImageUrl,
          caption: `🎟️ Entry Pass
Name: ${user.full_name}
Scan QR or Barcode at entry`
        }
      })
    });

    const data = await response.json();
    res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 👤 USER PAGE (PRO UI)
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
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verified Student</title>

<style>
body {
  margin:0;
  font-family:sans-serif;
  background:linear-gradient(135deg,#1e3c72,#2a5298);
  display:flex;
  justify-content:center;
  align-items:center;
  height:100vh;
}

.card {
  background:#fff;
  width:90%;
  max-width:400px;
  padding:20px;
  border-radius:15px;
  box-shadow:0 10px 30px rgba(0,0,0,0.3);
}

.title {
  text-align:center;
  font-size:22px;
  color:green;
  margin-bottom:10px;
}

.info {
  margin:8px 0;
  font-size:14px;
}

.info strong {
  width:130px;
  display:inline-block;
}

.badge {
  text-align:center;
  background:green;
  color:#fff;
  padding:5px;
  border-radius:20px;
  margin-bottom:10px;
}
</style>
</head>

<body>

<div class="card">
<div class="badge">✔ Verified</div>
<div class="title">Student Pass</div>
 <div class ="info"><strong>Name:</strong> ${user.full_name}</div>
        <div class ="info"><strong>Email:</strong> ${user.email}</div>
        <div class ="info"><strong>Phone:</strong> ${user.phone}</div>
        <div class ="info"><strong>Address:</strong> ${user.address}</div>
        <div class ="info"><strong>Date of Birth:</strong> ${user.dob}</div>
        <div class ="info"><strong>Trading Market:</strong> ${user.trading_market}</div>
        <div class ="info"><strong>Trading Type:</strong> ${user.trading_type}</div>
        <div class ="info"><strong>Source:</strong> ${user.source}</div>
        <div class ="info"><strong>Software Used:</strong> ${user.software_used}</div>
        <div class ="info"><strong>Previous Course:</strong> ${user.previous_course}</div>
        <div class ="info"><strong>Level:</strong> ${user.level}</div>
        <div class ="info"><strong>Amount Paid:</strong> ${user.amount}</div>
        <div class ="info"><strong>Payment Mode:</strong> ${user.payment_mode}</div>
<hr>
<p style="text-align:center;font-size:12px;">Scan QR / Barcode again</p>
</div>
</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.send("Error loading user");
  }
});

// ==============================
// 🚀 START
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
