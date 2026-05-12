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
// 📡 API: LOG BARCODE SCANS (MACHINE ENTRY)
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
// 🎟️ GENERATE FINAL IMAGE (BIG LOGO & PROFESSIONAL)
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

    // Center Alignment Helper
    const centerX = 350;

    // --- 3. Header Section (BIG LOGO + Institute Name) ---
    
    // Draw Logo (BIG SIZE: 160x160)
    if (logo) {
        ctx.drawImage(logo, 50, 50, 180, 180); 
    }

    // Institute Name (Positioned right of logo)
    ctx.textAlign = "left";
    ctx.fillStyle = primaryColor;
    ctx.font = "bold 28px Arial"; // Slightly larger font
    ctx.fillText("Tushar Bhumkar Institute", 240, 90);

    // Subtitle
    ctx.font = "22px Arial";
    ctx.fillStyle = "primaryColor";
    ctx.fillText("Pvt. Ltd.", 240, 125);

    // Website (Grey, smaller)
    ctx.font = "18px Arial";
    ctx.fillStyle = "#777";
    ctx.fillText("WWW.TUSHARBHUMKAR.COM", 240, 155);

    // Divider Line
    ctx.beginPath();
    ctx.moveTo(50, 235); // Extended line to cover big logo width
    ctx.lineTo(650, 235);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#e0e0e0";
    ctx.stroke();

    // --- 4. Main Title (ENTRY PASS) ---
    ctx.textAlign = "center";
    
    // Draw the Border Box
    ctx.lineWidth = 2;
    ctx.strokeStyle = primaryColor;
    ctx.strokeRect(centerX - 160, 290 - 50, 320, 60);

    ctx.fillStyle = primaryColor;
    ctx.font = "bold 50px Arial"; 
    ctx.fillText("ENTRY PASS", centerX, 290);

    // --- 5. QR Code ---
    const qrSize = 320; // Slightly larger
    const qrX = centerX - (qrSize / 2);
    ctx.drawImage(qrImage, qrX, 320, qrSize, qrSize);

    // --- 6. Barcode ---
    ctx.drawImage(barcodeImg, 50, 680, 600, 100);

    // --- 7. Instructions (No Footer Text) ---
    ctx.fillStyle = "#000";
    ctx.font = "italic 20px Arial";
    ctx.fillText("Scan QR or Barcode at Entry", centerX, 830);

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
// 👤 CREATE USER
// ==============================
app.post("/create", async (req, res) => {
  try {
    const {
      fullName, address, email, phone, dob, date,
      tradingMarket, tradingType, source,
      softwareUsed, previousCourse, level,
      amount, paymentMode,
      selfieImage, paymentImage,
      courseType
    } = req.body;

    const id = generateShortId(); 

    await pool.query(
      `INSERT INTO users(
        id, full_name, address, email, phone, dob, date,
        trading_market, trading_type, source,
        software_used, previous_course, level,
        amount, payment_mode,
        selfie_image, payment_image,
        course_type
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        id, fullName, address, email, phone, dob, date,
        tradingMarket, tradingType, source,
        softwareUsed, previousCourse, level,
        amount, paymentMode,
        selfieImage, paymentImage,
        courseType
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
// 👤 USER PAGE
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
  flex-direction: column;
  justify-content:center;
  align-items:center;
  min-height:100vh;
  padding:20px;
}

/* SCANNER INPUT BOX */
.scanner-box {
  margin-bottom: 20px;
  text-align: center;
  width: 100%;
  max-width: 500px;
}

input#scanInput {
  padding: 12px 20px;
  font-size: 18px;
  width: 100%;
  text-align: center;
  border: none;
  border-radius: 10px;
  background: rgba(255,255,255,0.2);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.3);
  outline: none;
  transition: all 0.3s ease;
}
input#scanInput:focus {
  background: rgba(255,255,255,0.25);
  border-color: rgba(255,255,255,0.5);
  box-shadow: 0 0 15px rgba(255,255,255,0.2);
}
input#scanInput::placeholder { color: rgba(255,255,255,0.7); }

.card {
  width:100%;
  max-width: 1000px;
  background:#ffffff;
  border-radius: 20px;
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
  padding: 25px;
}

.card-header h2 {
  font-size: 24px;
  font-weight:600;
  margin-bottom: 10px;
}

.badge {
  background:#fff;
  color:#00c853;
  display:inline-block;
  padding:6px 14px;
  border-radius:20px;
  font-size:14px;
  font-weight:600;
}

/* BODY */
.card-body {
  padding:25px;
}

.info-container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  width: 100%;
}

.info-item {
  display: flex;
  flex-direction: column;
}

.info-label {
  color:#555;
  font-weight:500;
  font-size:14px;
  margin-bottom: 5px;
}

.info-value {
  font-weight:600;
  color:#222;
  font-size:14px;
  padding: 8px 12px;
  background-color: rgba(0,200,83,0.05);
  border-radius: 6px;
  transition: background-color 0.3s ease;
  word-wrap: break-word;
  min-height: 40px;
}

.info-item:hover .info-value {
  background-color: rgba(0,200,83,0.1);
}

/* FOOTER */
.card-footer {
  text-align:center;
  padding:20px;
  font-size:14px;
  color:#777;
  border-top: 1px solid #eee;
}

/* STATUS */
.status {
  text-align:center;
  margin-top:20px;
  font-size:16px;
  color:#00c853;
  font-weight:600;
  padding:12px;
  border-radius:8px;
  background-color: rgba(0,200,83,0.1);
}

.error-msg { 
  color: #ff4444; 
  font-size: 16px; 
  font-weight: 600; 
  display: none; 
  margin-top:20px;
  padding:12px;
  border-radius:8px;
  background-color: rgba(255,68,68,0.1);
}

/* DESKTOP OPTIMIZATION */
@media(min-width:768px){
  .scanner-box {
    margin-bottom: 30px;
  }
  
  input#scanInput {
    font-size: 20px;
  }
  
  .card {
    max-width: 1200px;
  }
  
  .card-header {
    padding: 30px;
  }
  
  .card-header h2 {
    font-size: 28px;
  }
  
  .card-body {
    padding: 30px;
  }
  
  .info-container {
    gap: 20px;
  }
  
  .info-label {
    font-size: 16px;
  }
  
  .info-value {
    font-size: 16px;
    padding: 10px 15px;
    min-height: 45px;
  }
  
  .status {
    font-size: 18px;
  }
}

/* MOBILE OPTIMIZATION */
@media(max-width:767px){
  .card {
    max-width: 100%;
  }
  
  .info-container {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  .info-item {
    margin-bottom: 0;
  }
  
  .info-label {
    margin-bottom: 5px;
    font-size: 14px;
  }
  
  .info-value {
    padding: 8px;
    font-size: 14px;
  }
}
</style>
</head>

<body>

  <!-- SCANNER INPUT (Visible for scanning) -->
  <div class="scanner-box">
    <input type="text" id="scanInput" placeholder="Scan Barcode..." autocomplete="off" spellcheck="false" />
  </div>

  <div class="card">

    <div class="card-header">
    <h2>TUSHAR BHUMKAR INSTITUTE</h2>
      <h2>Student Entry Pass</h2>
      <div class="badge">✔ VERIFIED</div>
    </div>

    <div class="card-body">
      <!-- Grid layout with 3 columns -->
      <div class="info-container">
        <div class="info-item">
          <div class="info-label">Name</div>
          <div class="info-value" id="u-full_name">${u.full_name}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Email</div>
          <div class="info-value" id="u-email">${u.email}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Phone</div>
          <div class="info-value" id="u-phone">${u.phone}</div>
        </div>
        
        <div class="info-item">
          <div class="info-label">DOB</div>
          <div class="info-value" id="u-dob">${u.dob}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Market</div>
          <div class="info-value" id="u-market">${u.trading_market}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Type</div>
          <div class="info-value" id="u-type">${u.trading_type}</div>
        </div>
        
        <div class="info-item">
          <div class="info-label">Source</div>
          <div class="info-value" id="u-source">${u.source}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Software</div>
          <div class="info-value" id="u-software">${u.software_used}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Level</div>
          <div class="info-value" id="u-level">${u.level}</div>
        </div>
        
        <div class="info-item">
          <div class="info-label">Paid</div>
          <div class="info-value" id="u-amount">₹ ${u.amount}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Mode</div>
          <div class="info-value" id="u-mode">${u.payment_mode}</div>
        </div>

        <div class="info-item">
          <div class="info-label">Course Type</div>
          <div class="info-value" id="u-course">${u.course_type}</div>
        </div>
      </div>

      <div style="margin-top:25px;">
        <h3 style="margin-bottom:10px;">Verification</h3>

        <div style="display:flex; gap:15px; flex-wrap:wrap; justify-content:center;">
          
          <div style="text-align:center;">
            <div style="font-size:14px; margin-bottom:5px;">Selfie</div>
            <img id="u-selfie" src="${u.selfie_image}" 
                 style="width:120px; height:120px; object-fit:cover; border-radius:10px; border:1px solid #ddd;" />
          </div>

          <div style="text-align:center;">
            <div style="font-size:14px; margin-bottom:5px;">Payment</div>
            <img id="u-payment" src="${u.payment_image}" 
                 style="width:120px; height:120px; object-fit:cover; border-radius:10px; border:1px solid #ddd;" />
          </div>

        </div>
      </div>

      <div class="status">✔ Valid Entry Approved</div>
      <div id="error-display" class="error-msg">❌ Invalid ID</div>

    </div>

    <div class="card-footer">
      Scan QR / Barcode at Entry Gate
    </div>

  </div>

  <script>
    const input = document.getElementById('scanInput');
    const error = document.getElementById('error-display');

    // ✅ CRITICAL FIX: Force Focus Loop
    // This runs every 100ms to ensure focus is ALWAYS on the input
    setInterval(() => {
      if (document.activeElement !== input) {
        input.focus();
      }
    }, 100);

    // Listen for Enter key (Scan Complete)
    input.addEventListener('keydown', async function (e) {
      // Supports Enter or Tab keys at end of scan
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); // Prevent tab from moving focus
        
        const id = input.value.trim();
        input.value = ''; // Clear input immediately
        
        if (id) {
          // Update URL without reloading (pushState)
          window.history.pushState({ id: id }, "", "/user/" + id);
          
          // Fetch new data
          await loadUserData(id);
        }
      }
    });

    async function loadUserData(id) {
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode_id: id })
        });
        
        const json = await res.json();

        if (json.success) {
          const u = json.data;
          error.style.display = 'none';
          
          // Update DOM elements with new data
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
          document.getElementById('u-selfie').src = u.selfie_image;
          document.getElementById('u-payment').src = u.payment_image;
          document.getElementById('u-course').innerText = u.course_type;

          // Update status message
          document.querySelector('.status').innerText = "✅ Scan logged - Valid Entry Approved";
          
        } else {
          error.style.display = 'block';
          document.querySelector('.status').innerText = "❌ Invalid Barcode";
        }
      } catch (err) {
        console.error(err);
        error.style.display = 'block';
        document.querySelector('.status').innerText = "❌ Scan Error";
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

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        barcode_id VARCHAR(7) NOT NULL,
        course_type VARCHAR(255) NOT NULL,
        scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        device_info TEXT
      );
    `);
    console.log("✅ Scans table initialized");
  } catch (err) {
    console.error("❌ Table initialization error:", err);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);
