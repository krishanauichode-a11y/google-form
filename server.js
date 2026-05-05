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
// 📁 TEMP STORAGE (FIXED FOR RENDER)
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
// 🎟️ GENERATE FINAL IMAGE
// ==============================
async function generateFinalImage(id) {
  try {
    const qrPath = path.join(tempDir, `${id}-qr.png`);
    const barPath = path.join(tempDir, `${id}-barcode.png`);

    if (!fs.existsSync(qrPath) || !fs.existsSync(barPath)) {
      throw new Error("QR or Barcode file missing");
    }

    const qr = await loadImage(qrPath);
    const barcode = await loadImage(barcode);

    // HD SCALE
    const scale = 2;
    const canvas = createCanvas(700 * scale, 900 * scale);
    const ctx = canvas.getContext("2d");

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

    // Images
    ctx.drawImage(qr, 200, 160, 300, 300);
    ctx.drawImage(barcode, 50, 500, 600, 180);

    // Footer
    ctx.font = "18px sans-serif";
    ctx.fillText("Scan QR or Barcode at Entry", 160, 750);

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
      amount, paymentMode
    } = req.body;

    const id = generateShortId(); 

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

    const longUrl = `https://google-form-kebh.onrender.com/user/${id}`;

    // HIGH QUALITY QR (Contains full URL to open directly on phone)
    const qrBuffer = await QRCode.toBuffer(longUrl, {
      width: 600, 
      margin: 2,
      errorCorrectionLevel: 'H' 
    });
    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), qrBuffer);

    // ✅ BARCODE (Contains ONLY ID, no URL)
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id,          // 1. Encodes ONLY the 7-char ID
      alttext: id,       // 2. Prints ONLY the 7-char ID
      scale: 3,          // 3. Thick lines for easy scanning
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
// 👤 USER PAGE (PROTECTED & SCANNER ENABLED)
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
  padding:15px;
  overflow-x: hidden;
}

/* SCANNER INPUT BOX */
.scanner-box {
  margin-bottom: 30px;
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
  background:#ffffff;
  border-radius: 24px;
  overflow:hidden;
  box-shadow:0 20px 50px rgba(0,0,0,0.3);
  animation: fadeIn 0.8s ease;
  transition: transform 0.3s ease;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.card:hover {
  transform: translateY(-5px);
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
  padding: 30px;
  flex-shrink: 0;
}

.card-header h2 {
  font-size: 28px;
  font-weight:600;
  margin-bottom: 10px;
}

.badge {
  background:#fff;
  color:#00c853;
  display:inline-block;
  padding:8px 16px;
  border-radius:30px;
  font-size:14px;
  font-weight:600;
  box-shadow: 0 4px 10px rgba(0,0,0,0.1);
}

/* BODY */
.card-body {
  padding:30px;
  overflow-y: auto;
  flex-grow: 1;
}

.info-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  width: 100%;
}

.info-item {
  display: flex;
  flex-direction: column;
}

.info-label {
  color:#555;
  font-weight:500;
  font-size:16px;
  margin-bottom: 5px;
}

.info-value {
  font-weight:600;
  color:#222;
  font-size:16px;
  padding: 8px 12px;
  background-color: rgba(0,200,83,0.05);
  border-radius: 6px;
  transition: background-color 0.3s ease;
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
  flex-shrink: 0;
}

/* STATUS */
.status {
  text-align:center;
  margin-top:15px;
  font-size:16px;
  color:#00c853;
  font-weight:600;
  padding:10px;
  border-radius:8px;
  background-color: rgba(0,200,83,0.1);
}

.error-msg { 
  color: #ff4444; 
  font-size: 18px; 
  font-weight: 600; 
  display: none; 
  margin-top:15px;
  padding:15px;
  border-radius:8px;
  background-color: rgba(255,68,68,0.1);
}

/* DESKTOP OPTIMIZATION */
@media(min-width:768px){
  .scanner-box {
    margin-bottom: 40px;
  }
  
  input#scanInput {
    font-size: 20px;
  }
  
  .card-header {
    padding: 40px;
  }
  
  .card-header h2 {
    font-size: 32px;
  }
  
  .card-body {
    padding: 40px;
  }
  
  .info-container {
    gap: 30px;
  }
  
  .info-label {
    font-size: 18px;
  }
  
  .info-value {
    font-size: 18px;
    padding: 10px 15px;
  }
  
  .status {
    font-size: 18px;
  }
}

/* MOBILE OPTIMIZATION */
@media(max-width:767px){
  .info-container {
    grid-template-columns: 1fr;
    gap: 15px;
  }
  
  .info-item {
    margin-bottom: 0;
  }
  
  .info-label {
    margin-bottom: 5px;
  }
  
  .info-value {
    padding: 10px;
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
      <!-- Grid layout for full width -->
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
        const res = await fetch('/api/user/' + id);
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

        } else {
          error.style.display = 'block';
        }
      } catch (err) {
        console.error(err);
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
