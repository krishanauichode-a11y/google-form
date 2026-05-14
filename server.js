const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const crypto = require("crypto");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const session = require("express-session");
const { createCanvas, loadImage } = require("canvas");
const nodemailer = require("nodemailer");
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
// 📁 TEMP STORAGE
// ==============================
const tempDir = path.join(os.tmpdir(), "temp_passes");

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

console.log("📁 Temp directory:", tempDir);

app.use("/temp", express.static(tempDir));

// ==============================
// 🔢 SHORT ID GENERATOR
// ==============================
function generateShortId() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const randomBytes = crypto.randomBytes(7);
  let result = "";
  for (let i = 0; i < 7; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

// ==============================
// 🏠 HOME
// ==============================
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});

// ==============================
// 📡 API: GET USER DATA (JSON)
// ==============================
app.get("/api/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false });
    }

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

// ==============================
// 📡 API: LOG BARCODE SCANS (MACHINE ENTRY) - TIMEZONE FIX
// ==============================
app.post("/api/scan", async (req, res) => {
  try {
    const { barcode_id } = req.body;
    
    if (!barcode_id || barcode_id.length !== 7) {
      return res.status(400).json({ success: false, message: "Invalid barcode ID" });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [barcode_id]
    );

    if (userResult.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const user = userResult.rows[0];

    // ✅ FIX: Asia/Kolkata Time, No Milliseconds, No Timezone Offset
    // Format: 2026-05-13 14:47:05
    await pool.query(
      `UPDATE users 
       SET date = TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') 
       WHERE id = $1`,
      [barcode_id]
    );

    // Log the scan in the 'scans' history table
    await pool.query(
      `INSERT INTO scans (barcode_id, course_type, device_info) 
       VALUES ($1, $2, $3)`,
      [
        barcode_id, 
        user.course_type, 
        req.headers['user-agent'] 
      ]
    );

    res.json({ 
      success: true, 
      data: user,
      message: "Scan logged successfully"
    });

  } catch (err) {
    console.error("❌ SCAN LOG ERROR:", err);
    res.status(500).json({ success: false, message: "Scan logging failed" });
  }
});

// ==============================
// 🎟️ GENERATE FINAL IMAGE (REDUCED MIDDLE GAP)
// ==============================
async function generateFinalImage(id) {
  try {
    const qrPath = path.join(tempDir, `${id}-qr.png`);
    const barPath = path.join(tempDir, `${id}-barcode.png`);
    
    // LOGO PATH: Points to ROOT folder
    const logoPath = path.join(__dirname, 'logo.png'); 

    if (!fs.existsSync(qrPath) || !fs.existsSync(barPath)) {
      throw new Error("QR or Barcode file missing");
    }

    // Load images
    const qrImage = await loadImage(qrPath);
    const barcodeImg = await loadImage(barPath);
    
    // Load Logo
    let logo;
    if (fs.existsSync(logoPath)) {
      logo = await loadImage(logoPath);
    }

    // HD SCALE
    const scale = 2;
    const canvas = createCanvas(700 * scale, 900 * scale);
    const ctx = canvas.getContext("2d");

    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // --- 1. Background ---
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 700, 900);

    // --- 2. PROFESSIONAL BORDER (Navy Blue) ---
    const primaryColor = "#003366"; // Navy Blue
    ctx.lineWidth = 20; 
    ctx.strokeStyle = primaryColor;
    ctx.strokeRect(10, 10, 680, 880);

    const centerX = 350;
    let currentY = 40; // Vertical tracker

    // --- 3. LOGO (BIGGER SIZE - Aspect Ratio Fixed) ---
    if (logo) {
        // INCREASED SIZE: 300px wide, 200px high max
        const maxLogoWidth = 500; 
        const maxLogoHeight = 300;

        // Calculate scale to fit inside the box without stretching
        const scaleFactor = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height);
        
        const drawWidth = logo.width * scaleFactor;
        const drawHeight = logo.height * scaleFactor;
        
        // Center X calculation
        const logoX = centerX - (drawWidth / 2);

        ctx.drawImage(logo, logoX, currentY, drawWidth, drawHeight);
        
        // Move Y down below the logo + 15px padding
        currentY += drawHeight + 15; 
    }

    // --- 4. Website Text ---
    ctx.textAlign = "center";
    ctx.fillStyle = primaryColor;
    ctx.font = "bold 20px Arial";
    ctx.fillText("www.tusharbhumkar.com", centerX, currentY);
    currentY += 30; 

    // --- 5. Divider Line ---
    ctx.beginPath();
    ctx.moveTo(50, currentY);
    ctx.lineTo(650, currentY);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#e0e0e0";
    ctx.stroke();
    
    // --- GAP: Big gap between Website/Divider and Entry Pass ---
    currentY += 70; 

    // --- 6. Main Title (ENTRY PASS) ---
    ctx.textAlign = "center";
    ctx.fillStyle = primaryColor;
    ctx.font = "bold 50px Arial"; 
    ctx.fillText("ENTRY PASS", centerX, currentY);
    currentY += 50; 

    // --- 7. QR Code ---
    const qrSize = 320; 
    const qrX = centerX - (qrSize / 2);
    ctx.drawImage(qrImage, qrX, currentY, qrSize, qrSize);

    // --- 8. Barcode (REDUCED GAP - Moved Closer to QR) ---
    // Calculate the bottom of the QR code
    const qrBottom = currentY + qrSize;
    
    // Add a small gap (e.g., 25px)
    const smallGap = 25; 
    const barcodeY = qrBottom + smallGap;

    ctx.drawImage(barcodeImg, 50, barcodeY, 600, 100);

    // --- 9. Instructions ---
    ctx.fillStyle = "#000";
    ctx.font = "italic 20px Arial";
    ctx.fillText("Scan QR or Barcode at Entry", centerX, barcodeY + 130);

    const finalPath = path.join(tempDir, `${id}-final.png`);

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
// 👤 CREATE USER (UPDATED WITH PAN & AADHAR)
// ==============================
app.post("/create", async (req, res) => {
  try {
    const {
      fullName, address, email, phone, dob, date,
      tradingMarket, tradingType, source,
      softwareUsed, previousCourse, level,
      amount, paymentMode,
      selfieImage, paymentImage,
      courseType,
      panCardImage,       // ✅ NEW
      aadharCardImage     // ✅ NEW
    } = req.body;

    const id = generateShortId(); 

    // Updated SQL with 2 new fields ($19, $20)
    await pool.query(
      `INSERT INTO users(
        id, full_name, address, email, phone, dob, date,
        trading_market, trading_type, source,
        software_used, previous_course, level,
        amount, payment_mode,
        selfie_image, payment_image,
        course_type, 
        pan_card_image, 
        aadhar_card_image
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        id, fullName, address, email, phone, dob, date,
        tradingMarket, tradingType, source,
        softwareUsed, previousCourse, level,
        amount, paymentMode,
        selfieImage, paymentImage,
        courseType,
        panCardImage,   // ✅ NEW
        aadharCardImage // ✅ NEW
      ]
    );

    const longUrl = `https://google-form-kebh.onrender.com/user/${id}`;

    const qrBuffer = await QRCode.toBuffer(longUrl, {
      width: 600, 
      margin: 2,
      errorCorrectionLevel: 'H' 
    });
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,
      alttext: id,
      scale: 3,
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
// 👤 USER PAGE (FULL PAGE - NO SCROLL LAYOUT)
// ==============================
app.get("/user/:id", async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;

    const result = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.send("<h2 style='color:white;text-align:center;font-family:sans-serif;margin-top:50px'>❌ Invalid QR</h2>");
    }

    const u = result.rows[0];

    // Helper to handle empty images
    const getImgSrc = (url) => url || "https://via.placeholder.com/150?text=No+Image";

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Entry Pass Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

<style>
  /* ==============================
     1. RESET & BASE STYLES
     ============================== */
  * { box-sizing: border-box; outline: none; -webkit-tap-highlight-color: transparent; }
  
  body {
    margin: 0;
    padding: 0;
    font-family: 'Inter', sans-serif;
    /* ✅ FORCE FULL HEIGHT & NO BROWSER SCROLL */
    height: 100vh;
    width: 100vw;
    overflow: hidden; 
    background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
    color: #333;
    display: flex;
    flex-direction: column;
  }

  /* Hide Scrollbar for Chrome/Safari/Opera */
  .no-scrollbar::-webkit-scrollbar { display: none; }
  /* Hide Scrollbar for IE, Edge and Firefox */
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  /* ==============================
     2. SCANNER BAR (TOP FIXED)
     ============================== */
  .scanner-bar {
    height: 60px;
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 20px;
    z-index: 100;
    flex-shrink: 0;
  }

  #scanInput {
    width: 100%;
    max-width: 500px;
    padding: 10px 20px;
    border-radius: 30px;
    border: 1px solid rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.1);
    color: #fff;
    font-size: 16px;
    text-align: center;
    transition: all 0.3s ease;
  }
  #scanInput:focus {
    background: rgba(255,255,255,0.2);
    border-color: #00c853;
    box-shadow: 0 0 15px rgba(0, 200, 83, 0.4);
  }
  #scanInput::placeholder { color: rgba(255,255,255,0.6); }

  /* ==============================
     3. MAIN CARD (FITS SCREEN)
     ============================== */
  .app-container {
    flex: 1; /* Takes remaining height */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    overflow: hidden;
  }

  .card {
    width: 100%;
    max-width: 1200px;
    height: 100%;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.4s ease-out;
    position: relative;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ==============================
     4. HEADER & FOOTER (FIXED HEIGHT)
     ============================== */
  .card-header {
    background: linear-gradient(135deg, #00c853, #009624);
    color: white;
    padding: 15px 25px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .header-titles h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .header-titles h2 {
    margin: 2px 0 0 0;
    font-size: 12px;
    font-weight: 400;
    opacity: 0.9;
    text-transform: uppercase;
  }

  .verified-badge {
    background: #fff;
    color: #00c853;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  }

  .card-footer {
    background: #f8f9fa;
    padding: 10px 20px;
    text-align: center;
    font-size: 12px;
    color: #666;
    border-top: 1px solid #eee;
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .status-msg {
    font-weight: 600;
  }

  /* ==============================
     5. CONTENT AREA (SCROLLABLE INTERNAL)
     ============================== */
  .card-body {
    flex: 1; /* Pushes footer down */
    display: flex;
    overflow: hidden; /* Prevent card overflow */
    padding: 0;
  }

  /* --- LEFT PANEL: DATA (60%) --- */
  .data-panel {
    flex: 6;
    padding: 20px;
    overflow-y: auto; /* Internal Scroll */
    border-right: 1px solid #eee;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 15px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
  }

  .info-label {
    font-size: 11px;
    text-transform: uppercase;
    color: #888;
    font-weight: 600;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
  }

  .info-value {
    font-size: 14px;
    font-weight: 500;
    color: #222;
    background: #f4f6f8;
    padding: 8px 12px;
    border-radius: 6px;
    border-left: 3px solid #00c853;
    word-wrap: break-word;
    transition: background 0.2s;
  }
  .info-value:hover { background: #eef2f5; }

  /* --- RIGHT PANEL: IMAGES (40%) --- */
  .images-panel {
    flex: 4;
    background: #fafafa;
    padding: 20px;
    overflow-y: auto; /* Internal Scroll */
    display: grid;
    grid-template-columns: 1fr 1fr; /* 2x2 Grid */
    grid-auto-rows: max-content;
    gap: 15px;
    align-content: start;
  }

  .img-card {
    background: #fff;
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    text-align: center;
    transition: transform 0.2s;
  }
  .img-card:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.1); }

  .img-card-label {
    font-size: 11px;
    color: #666;
    margin-bottom: 5px;
    font-weight: 600;
  }

  .img-wrapper {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid #eee;
    background: #eee;
    position: relative;
  }

  .img-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
  }
  .img-card:hover img { transform: scale(1.05); }

  /* ==============================
     6. RESPONSIVE MOBILE LAYOUT
     ============================== */
  @media (max-width: 768px) {
    .card-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
    .verified-badge { align-self: flex-end; margin-top: -35px; }
    
    .card-body {
      flex-direction: column; /* Stack panels on mobile */
    }

    .data-panel {
      flex: 1; /* Share space */
      border-right: none;
      border-bottom: 1px solid #eee;
    }

    .images-panel {
      flex: 1; /* Share space */
      grid-template-columns: repeat(2, 1fr); /* Keep 2x2 grid */
      padding: 15px;
      gap: 10px;
    }

    .img-card-label { font-size: 10px; }
    
    .header-titles h1 { font-size: 18px; }
    .header-titles h2 { font-size: 10px; }
  }
</style>
</head>

<body>

  <!-- 1. SCANNER INPUT (Fixed Top) -->
  <div class="scanner-bar">
    <input type="text" id="scanInput" placeholder="Scan Barcode / Enter ID..." autocomplete="off" spellcheck="false" />
  </div>

  <!-- 2. MAIN CONTAINER -->
  <div class="app-container">
    <div class="card">
      
      <!-- HEADER -->
      <div class="card-header">
        <div class="header-titles">
          <h1>TUSHAR BHUMKAR INSTITUTE</h1>
          <h2>Student Entry Verification</h2>
        </div>
        <div class="verified-badge">✔ VERIFIED</div>
      </div>

      <!-- BODY: SPLIT LAYOUT -->
      <div class="card-body no-scrollbar">
        
        <!-- LEFT: INFO GRID -->
        <div class="data-panel no-scrollbar">
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Full Name</span>
              <span class="info-value" id="u-full_name">${u.full_name}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Phone</span>
              <span class="info-value" id="u-phone">${u.phone}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Email</span>
              <span class="info-value" id="u-email">${u.email}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Course</span>
              <span class="info-value" id="u-course">${u.course_type}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Market</span>
              <span class="info-value" id="u-market">${u.trading_market}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Type</span>
              <span class="info-value" id="u-type">${u.trading_type}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Amount Paid</span>
              <span class="info-value" id="u-amount">₹ ${u.amount}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Payment Mode</span>
              <span class="info-value" id="u-mode">${u.payment_mode}</span>
            </div>
            <div class="info-item">
              <span class="info-label">DOB</span>
              <span class="info-value" id="u-dob">${u.dob}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Software</span>
              <span class="info-value" id="u-software">${u.software_used}</span>
            </div>
          </div>
        </div>

        <!-- RIGHT: IMAGES (2x2 Grid) -->
        <div class="images-panel no-scrollbar">
          
          <!-- Selfie -->
          <div class="img-card">
            <div class="img-card-label">SELFIE</div>
            <a href="${getImgSrc(u.selfie_image)}" target="_blank">
              <div class="img-wrapper">
                <img id="u-selfie" src="${getImgSrc(u.selfie_image)}" 
                     onerror="this.src='https://via.placeholder.com/150?text=No+Image'" />
              </div>
            </a>
          </div>

          <!-- Payment -->
          <div class="img-card">
            <div class="img-card-label">PAYMENT PROOF</div>
            <a href="${getImgSrc(u.payment_image)}" target="_blank">
              <div class="img-wrapper">
                <img id="u-payment" src="${getImgSrc(u.payment_image)}" 
                     onerror="this.src='https://via.placeholder.com/150?text=No+Image'" />
              </div>
            </a>
          </div>

          <!-- PAN -->
          <div class="img-card">
            <div class="img-card-label">PAN CARD</div>
            <a href="${getImgSrc(u.pan_card_image)}" target="_blank">
              <div class="img-wrapper">
                <img id="u-pan" src="${getImgSrc(u.pan_card_image)}" 
                     onerror="this.src='https://via.placeholder.com/150?text=No+Pan'" />
              </div>
            </a>
          </div>

          <!-- AADHAR -->
          <div class="img-card">
            <div class="img-card-label">AADHAR CARD</div>
            <a href="${getImgSrc(u.aadhar_card_image)}" target="_blank">
              <div class="img-wrapper">
                <img id="u-aadhar" src="${getImgSrc(u.aadhar_card_image)}" 
                     onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'" />
              </div>
            </a>
          </div>

        </div>
      </div>

      <!-- FOOTER -->
      <div class="card-footer">
        <span>System Status: <span style="color:#00c853">● Online</span></span>
        <span class="status-msg" id="status-msg">Ready to Scan</span>
      </div>

    </div>
  </div>

  <!-- LOGIC -->
  <script>
    const input = document.getElementById('scanInput');
    const statusMsg = document.getElementById('status-msg');
    const dataPanel = document.querySelector('.data-panel');
    const imagesPanel = document.querySelector('.images-panel');

    // Force Focus Loop
    setInterval(() => {
      if (document.activeElement !== input) {
        input.focus();
      }
    }, 100);

    input.addEventListener('keydown', async function (e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const id = input.value.trim();
        input.value = '';
        
        if (id) {
          window.history.pushState({ id: id }, "", "/user/" + id);
          await loadUserData(id);
        }
      }
    });

    async function loadUserData(id) {
      // Visual Feedback
      statusMsg.innerText = "Scanning...";
      statusMsg.style.color = "#e67e22";

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode_id: id })
        });
        
        const json = await res.json();

        if (json.success) {
          const u = json.data;
          
          // Update Text Fields
          document.getElementById('u-full_name').innerText = u.full_name;
          document.getElementById('u-email').innerText = u.email;
          document.getElementById('u-phone').innerText = u.phone;
          document.getElementById('u-dob').innerText = u.dob;
          document.getElementById('u-market').innerText = u.trading_market;
          document.getElementById('u-type').innerText = u.trading_type;
          document.getElementById('u-source').innerText = u.source;
          document.getElementById('u-software').innerText = u.software_used;
          document.getElementById('u-level').innerText = u.level;
          document.getElementById('u-amount').innerText = '₹ ' + u.amount;
          document.getElementById('u-mode').innerText = u.payment_mode;
          document.getElementById('u-course').innerText = u.course_type;

          // Safe Image Update
          const updateImage = (id, url) => {
            const img = document.getElementById(id);
            const link = img.parentElement.parentElement;
            if (url && url.length > 10) {
                img.src = url;
                link.href = url;
                img.style.opacity = "1";
            } else {
                img.src = "https://via.placeholder.com/150?text=No+Image";
                link.href = "#";
                img.style.opacity = "0.5";
            }
          };

          updateImage('u-selfie', u.selfie_image);
          updateImage('u-payment', u.payment_image);
          updateImage('u-pan', u.pan_card_image);
          updateImage('u-aadhar', u.aadhar_card_image);

          statusMsg.innerText = "✅ " + u.full_name + " - Entry Approved";
          statusMsg.style.color = "#00c853";

          // Subtle flash effect on success
          document.querySelector('.card').animate([
            { boxShadow: '0 0 0 0 rgba(0, 200, 83, 0.7)' },
            { boxShadow: '0 0 0 20px rgba(0, 200, 83, 0)' }
          ], { duration: 500 });

        } else {
          statusMsg.innerText = "❌ Invalid ID or User Not Found";
          statusMsg.style.color = "#e74c3c";
        }
      } catch (err) {
        console.error(err);
        statusMsg.innerText = "❌ Connection Error";
        statusMsg.style.color = "#e74c3c";
      }
    }
  </script>

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

// ==============================
// 🗄️ INITIALIZE DATABASE TABLES (UPDATED)
// ==============================
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // 1. Ensure 'users' table exists with correct columns
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(7) PRIMARY KEY,
        full_name VARCHAR(255),
        address TEXT,
        email VARCHAR(255),
        phone VARCHAR(20),
        dob DATE,
        date TIMESTAMP,
        trading_market VARCHAR(100),
        trading_type VARCHAR(100),
        source VARCHAR(100),
        software_used VARCHAR(100),
        previous_course VARCHAR(100),
        level VARCHAR(100),
        amount NUMERIC,
        payment_mode VARCHAR(50),
        selfie_image TEXT, 
        payment_image TEXT, 
        course_type VARCHAR(100),
        pan_card_image TEXT,
        aadhar_card_image TEXT
      );
    `);
    console.log("✅ Users table checked/initialized");

    // 2. Ensure 'scans' table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        barcode_id VARCHAR(7) NOT NULL,
        course_type VARCHAR(255) NOT NULL,
        scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        device_info TEXT
      );
    `);
    console.log("✅ Scans table checked/initialized");

  } catch (err) {
    console.error("❌ Table initialization error:", err);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);
