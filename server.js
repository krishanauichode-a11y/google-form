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
const nodemailer = require("nodemailer");
// ADDED os MODULE FOR BETTER FILE HANDLING ON RENDER
const os = require("os"); 

const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// 🔐 SESSION
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
// 📁 TEMP STORAGE (FIXED FOR RENDER)
// ==============================
// Use os.tmpdir() for Render/Heroku compatibility (Read-Write access)
const tempDir = path.join(os.tmpdir(), "temp_passes");

// Ensure folder ALWAYS exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

console.log("📁 Temp directory:", tempDir);

// Serve static files
app.use("/temp", express.static(tempDir));

// ==============================
// 🏠 HOME
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});

// ==============================
// 🎟️ GENERATE FINAL IMAGE (OPTIMIZED)
// ==============================
async function generateFinalImage(id) {
  try {
    const qrPath = path.join(tempDir, `${id}-qr.png`);
    const barPath = path.join(tempDir, `${id}-barcode.png`);

    if (!fs.existsSync(qrPath) || !fs.existsSync(barPath)) {
      throw new Error("QR or Barcode file missing");
    }

    const qr = await loadImage(qrPath);
    const barcode = await loadImage(barPath);

    // 🔥 HD SCALE: 2x scale = 1400x1800 resolution (Excellent Quality)
    const scale = 2;

    const canvas = createCanvas(700 * scale, 900 * scale);
    const ctx = canvas.getContext("2d");

    // 🔥 QUALITY SETTINGS
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 700, 900);

    // Title
    ctx.fillStyle = "#000";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("Tushar Bhumkar Institute Pvt Ltd", 130, 60);

    ctx.font = "bold 32px sans-serif";
    ctx.fillText("ENTRY PASS", 230, 120);

    // Images (Scaled down logically, but canvas is HD)
    ctx.drawImage(qr, 200, 160, 300, 300);
    ctx.drawImage(barcode, 50, 500, 600, 180);

    // Footer
    ctx.font = "18px sans-serif";
    ctx.fillText("Scan QR or Barcode at Entry", 160, 750);

    const finalPath = path.join(tempDir, `${id}-final.png`);

    // 🔥 MAX QUALITY EXPORT + MAX COMPRESSION
    // compressionLevel: 0 = No Compress (Big File)
    // compressionLevel: 9 = Max Compress (Small File, Same Quality)
    const buffer = canvas.toBuffer("image/png", {
      compressionLevel: 9 
    });
    
    fs.writeFileSync(finalPath, buffer);

    return `https://google-form-kebh.onrender.com/temp/${id}-final.png`;

  } catch (err) {
    console.error("❌ IMAGE GENERATION ERROR:", err);
    throw err;
  }
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

    // 🔥 HIGH QUALITY QR (Optimized Size)
    // 600px is sufficient because it's drawn into a 300px box (2x scale)
    const qrBuffer = await QRCode.toBuffer(url, {
      width: 600, 
      margin: 2,
      errorCorrectionLevel: 'H' // High error correction for better scanning
    });
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    // 🔥 HIGH QUALITY BARCODE
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,
      scale: 3, // Reduced from 4 to 3 (Save memory, no visual difference)
      height: 25,
      includetext: true,
      textxalign: "center",
      padding: 10
    });
    fs.writeFileSync(path.join(tempDir, `${id}-barcode.png`), barcodeBuffer);

    await generateFinalImage(id);

    res.json({ success: true, id });

  } catch (err) {
    console.error("❌ CREATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SEND EMAIL
// ==============================
app.post("/send-email", async (req, res) => {
  try {
    const { id, email } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
    const user = result.rows[0];

    const finalImageUrl = await generateFinalImage(id);

    await sendEmail(email, user.full_name, finalImageUrl);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ EMAIL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📧 EMAIL SETUP
// ==============================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendEmail(to, name, imageUrl) {
  return transporter.sendMail({
    from: `"Tushar Bhumkar Institute" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "🎟️ Your Entry Pass",
    html: `
      <h2>Hello ${name},</h2>
      <p>Your entry pass is ready.</p>
      <img src="${imageUrl}" width="300"/>
    `
  });
}


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

    if (result.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const user = result.rows[0];

    // Ensure final image exists
    const finalImageUrl = `https://google-form-kebh.onrender.com/temp/${id}-final.png`;

    const response = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.INTERAKT_API_KEY}`
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: cleanPhone,
        type: "Template",
        template: {
          name: "entry_pass",
          languageCode: "en",
          bodyValues: [
            String(user.full_name || "User"),
            "Scan QR or Barcode at entry"
          ],
          headerValues: [finalImageUrl]
        }
      })
    });

    const data = await response.json();

    res.json({ success: true, data });

  } catch (err) {
    console.error("❌ INTERAKT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 🔐 ADMIN CHECK
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

<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">

<style>
* {
  margin:0;
  padding:0;
  box-sizing:border-box;
  font-family: 'Poppins', sans-serif;
}

body {
  background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
  display:flex;
  justify-content:center;
  align-items:center;
  min-height:100vh;
  padding:15px;
}

.card {
  width:100%;
  max-width:420px;
  background:#ffffff;
  border-radius:20px;
  overflow:hidden;
  box-shadow:0 15px 40px rgba(0,0,0,0.4);
  animation: fadeIn 0.6s ease;
}

@keyframes fadeIn {
  from {opacity:0; transform:translateY(20px);}
  to {opacity:1; transform:translateY(0);}
}

/* HEADER */
.card-header {
  background: linear-gradient(135deg, #00c853, #009624);
  color:#fff;
  text-align:center;
  padding:20px;
}

.card-header h2 {
  font-size:22px;
  font-weight:600;
}

.badge {
  background:#fff;
  color:#00c853;
  display:inline-block;
  padding:5px 12px;
  border-radius:20px;
  font-size:12px;
  margin-top:8px;
  font-weight:600;
}

/* BODY */
.card-body {
  padding:20px;
}

.info {
  display:flex;
  justify-content:space-between;
  padding:10px 0;
  border-bottom:1px solid #eee;
  font-size:14px;
}

.info span:first-child {
  color:#555;
  font-weight:500;
}

.info span:last-child {
  font-weight:600;
  color:#222;
  text-align:right;
  max-width:55%;
  word-wrap:break-word;
}

/* FOOTER */
.card-footer {
  text-align:center;
  padding:15px;
  font-size:12px;
  color:#777;
}

/* STATUS */
.status {
  text-align:center;
  margin-top:10px;
  font-size:13px;
  color:#00c853;
  font-weight:600;
}

/* MOBILE OPTIMIZATION */
@media(max-width:400px){
  .info {
    flex-direction:column;
    gap:3px;
  }

  .info span:last-child {
    text-align:left;
  }
}
</style>
</head>

<body>

<div class="card">

  <div class="card-header">
  <h2>TUSHAR BHUMKAR INSTITUTE</h2>
    <h2>Student Entry Pass</h2>
    <div class="badge">✔ VERIFIED</div>
  </div>

  <div class="card-body">

    <div class="info"><span>Name</span><span>${u.full_name}</span></div>
    <div class="info"><span>Email</span><span>${u.email}</span></div>
    <div class="info"><span>Phone</span><span>${u.phone}</span></div>
    <div class="info"><span>DOB</span><span>${u.dob}</span></div>
    <div class="info"><span>Market</span><span>${u.trading_market}</span></div>
    <div class="info"><span>Type</span><span>${u.trading_type}</span></div>
    <div class="info"><span>Source</span><span>${u.source}</span></div>
    <div class="info"><span>Software</span><span>${u.software_used}</span></div>
    <div class="info"><span>Level</span><span>${u.level}</span></div>
    <div class="info"><span>Paid</span><span>₹ ${u.amount}</span></div>
    <div class="info"><span>Mode</span><span>${u.payment_mode}</span></div>

    <div class="status">✔ Valid Entry Approved</div>

  </div>

  <div class="card-footer">
    Scan QR / Barcode at Entry Gate
  </div>

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
// 🚀 START SERVER
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
