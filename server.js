const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const session = require("express-session");
const { createCanvas, loadImage } = require("canvas");

const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// 🔐 SESSION (ADMIN LOGIN)
// ==============================
app.use(session({
  secret: "super-secret-key",
  resave: false,
  saveUninitialized: true
}));

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
// ✅ TEMP STORAGE
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
  ctx.font = "bold 28px Arial";
  ctx.fillText("Tushar Bhumkar Institute Pvt Ltd", 130, 60);

  ctx.font = "bold 32px Arial";
  ctx.fillText("ENTRY PASS", 230, 120);

  ctx.drawImage(qr, 200, 160, 300, 300);
  ctx.drawImage(barcode, 50, 500, 600, 180);

  ctx.font = "18px Arial";
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

    const qrBuffer = await QRCode.toBuffer(url);
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,
      scale: 3,
      height: 20,
      includetext: true,
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
// 🔐 ADMIN PROTECTION MIDDLEWARE
// ==============================
function checkAdmin(req, res) {
  const { p } = req.query;

  if (req.session.isAdmin) return true;

  if (p === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return true;
  }

  res.send(`
  <html>
  <body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
    <form method="GET" style="text-align:center;">
      <h2>🔒 Admin Access</h2>
      <input type="password" name="p" placeholder="Enter Password" required style="padding:10px"/>
      <br><br>
      <button type="submit" style="padding:10px 20px">Access</button>
    </form>
  </body>
  </html>
  `);

  return false;
}

// ==============================
// 👤 USER PAGE (PROTECTED)
// ==============================
app.get("/user/:id", async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;

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
  background:#0f2027;
  display:flex;
  justify-content:center;
  align-items:center;
  min-height:100vh;
  font-family:sans-serif;
}
.card {
  background:#fff;
  padding:20px;
  border-radius:15px;
  width:90%;
  max-width:400px;
}
.info {
  display:flex;
  justify-content:space-between;
  margin:8px 0;
}
</style>
</head>
<body>
<div class="card">
<h2>✔ Verified Entry</h2>
<div class="info"><span>Name</span><span>${u.full_name}</span></div>
<div class="info"><span>Email</span><span>${u.email}</span></div>
<div class="info"><span>Phone</span><span>${u.phone}</span></div>
<div class="info"><span>Amount</span><span>₹ ${u.amount}</span></div>
</div>
</body>
</html>
    `);

  } catch (err) {
    console.error(err);
    res.send("Error");
  }
});

// ==============================
// 🚀 START SERVER
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
