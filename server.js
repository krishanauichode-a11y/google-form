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

app.use(session({ secret: "super-secret-key", resave: false, saveUninitialized: true }));

const pool = new Pool({
  user: "postgres.swknmxqcgoobxxjmrspz",
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  database: "postgres",
  password: "xpevVM-*Au%Vd9c",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

const tempDir = path.join(os.tmpdir(), "temp_passes");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
app.use("/temp", express.static(tempDir));

function generateShortId() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const randomBytes = crypto.randomBytes(7);
  let result = "";
  for (let i = 0; i < 7; i++) result += chars[randomBytes[i] % chars.length];
  return result;
}

app.get("/", (req, res) => res.send("✅ Server Running"));

// ==============================
// 🆕 CHECK FORM STATUS API
// ==============================
app.get("/api/form-responses/:ref_id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT TO_CHAR(received_at, 'DD Mon YYYY, HH12:MI AM') as received_at_formatted FROM google_form_responses WHERE ref_id = $1 LIMIT 1`, [req.params.ref_id]);
    res.json({ success: result.rows.length > 0, data: result.rows[0] || null });
  } catch (err) { res.json({ success: false }); }
});

// ==============================
// API SCAN & USER GET (Your Original Code)
// ==============================
app.get("/api/user/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
    res.json(result.rows.length === 0 ? { success: false } : { success: true, data: result.rows[0] });
  } catch (err) { res.json({ success: false }); }
});

app.post("/api/scan", async (req, res) => {
  try {
    const { barcode_id } = req.body;
    if (!barcode_id || barcode_id.length !== 7) return res.status(400).json({ success: false, message: "Invalid barcode ID" });
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [barcode_id]);
    if (userResult.rows.length === 0) return res.json({ success: false, message: "User not found" });
    const user = userResult.rows[0];
    await pool.query(`UPDATE users SET date = TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1`, [barcode_id]);
    await pool.query(`INSERT INTO scans (barcode_id, course_type, device_info) VALUES ($1, $2, $3)`, [barcode_id, user.course_type, req.headers['user-agent']]);
    res.json({ success: true, data: user, message: "Scan logged successfully" });
  } catch (err) { res.status(500).json({ success: false, message: "Scan logging failed" }); }
});

// ==============================
// IMAGE GENERATION (Your Original Code)
// ==============================
async function generateFinalImage(id) {
  try {
    const qrPath = path.join(tempDir, `${id}-qr.png`);
    const barPath = path.join(tempDir, `${id}-barcode.png`);
    const logoPath = path.join(__dirname, 'logo.png'); 
    if (!fs.existsSync(qrPath) || !fs.existsSync(barPath)) throw new Error("QR or Barcode file missing");
    const qrImage = await loadImage(qrPath); const barcodeImg = await loadImage(barPath);
    let logo; if (fs.existsSync(logoPath)) logo = await loadImage(logoPath);
    const scale = 2; const canvas = createCanvas(700 * scale, 900 * scale); const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 700, 900);
    const primaryColor = "#003366"; ctx.lineWidth = 20; ctx.strokeStyle = primaryColor; ctx.strokeRect(10, 10, 680, 880);
    const centerX = 350; let currentY = 40;
    if (logo) {
        const scaleFactor = Math.min(500 / logo.width, 300 / logo.height);
        const drawWidth = logo.width * scaleFactor; const drawHeight = logo.height * scaleFactor;
        ctx.drawImage(logo, centerX - (drawWidth / 2), currentY, drawWidth, drawHeight); currentY += drawHeight + 15; 
    }
    ctx.textAlign = "center"; ctx.fillStyle = primaryColor; ctx.font = "bold 20px Arial"; ctx.fillText("www.tusharbhumkar.com", centerX, currentY); currentY += 30; 
    ctx.beginPath(); ctx.moveTo(50, currentY); ctx.lineTo(650, currentY); ctx.lineWidth = 2; ctx.strokeStyle = "#e0e0e0"; ctx.stroke(); currentY += 70; 
    ctx.fillStyle = primaryColor; ctx.font = "bold 50px Arial"; ctx.fillText("ENTRY PASS", centerX, currentY); currentY += 50; 
    const qrSize = 320; ctx.drawImage(qrImage, centerX - (qrSize / 2), currentY, qrSize, qrSize);
    const barcodeY = currentY + qrSize + 25; ctx.drawImage(barcodeImg, 50, barcodeY, 600, 100);
    ctx.fillStyle = "#000"; ctx.font = "italic 20px Arial"; ctx.fillText("Scan QR or Barcode at Entry", centerX, barcodeY + 130);
    const finalPath = path.join(tempDir, `${id}-final.png`);
    fs.writeFileSync(finalPath, canvas.toBuffer("image/png", { compressionLevel: 9 }));
    return `https://google-form-kebh.onrender.com/temp/${id}-final.png`;
  } catch (err) { console.error("❌ IMAGE ERROR:", err); throw err; }
}

// ==============================
// CREATE USER (Your Original Code)
// ==============================
app.post("/create", async (req, res) => {
  try {
    const { fullName, address, email, phone, dob, date, tradingMarket, tradingType, softwareUsed, amount, paymentMode, selfieImage, paymentImage, aadharFrontImage, aadharBackImage, courseType } = req.body;
    const id = generateShortId(); 
    
    // ✅ FIXED: Added $18 to match the 18 columns and 18 values
    await pool.query(
      `INSERT INTO users(
        id, full_name, address, email, phone, dob, date, 
        trading_market, trading_type, source, software_used, 
        amount, payment_mode, selfie_image, payment_image, 
        aadhar_front_image, aadhar_back_image, course_type
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, 
      [
        id, fullName, address, email, phone, dob, date, 
        tradingMarket, tradingType, null, softwareUsed, 
        amount, paymentMode, selfieImage, paymentImage, 
        aadharFrontImage, aadharBackImage, courseType
      ]
    );

    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), await QRCode.toBuffer(`https://google-form-kebh.onrender.com/user/${id}`, { width: 600, margin: 2, errorCorrectionLevel: 'H' }));
    fs.writeFileSync(path.join(tempDir, `${id}-barcode.png`), await bwipjs.toBuffer({ bcid: "code128", text: id, alttext: id, scale: 3, height: 25, includetext: true, textxalign: "center", padding: 10 }));
    await generateFinalImage(id);
    
    res.json({ success: true, id });
  } catch (err) { 
    console.error("❌ CREATE ERROR:", err); 
    res.status(500).json({ error: err.message }); 
  }
});

// ==============================
// EMAIL & INTERAKT (Your Original Code)
// ==============================
app.post("/send-email", async (req, res) => {
  try {
    const { id, email } = req.body; const user = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 587, secure: false, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }, tls: { rejectUnauthorized: false } });
    await transporter.sendMail({ from: `"Tushar Bhumkar Institute" <${process.env.EMAIL_USER}>`, to: email, subject: "🎟️ Your Entry Pass", html: `<h2>Hello ${user.full_name},</h2><p>Your entry pass is ready.</p><img src="${await generateFinalImage(id)}" width="300"/>` });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/share-interakt", async (req, res) => {
  try {
    const { id, phone } = req.body; const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    if (!user) return res.json({ success: false, message: "User not found" });
    const response = await fetch("https://api.interakt.ai/v1/public/message/", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Basic ${process.env.INTERAKT_API_KEY}` }, body: JSON.stringify({ countryCode: "+91", phoneNumber: cleanPhone, type: "Template", template: { name: "entry_pass", languageCode: "en", bodyValues: [String(user.full_name || "User"), "Scan QR or Barcode at entry"], headerValues: [`https://google-form-kebh.onrender.com/temp/${id}-final.png`] } }) });
    res.json({ success: true, data: await response.json() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==============================
// ADMIN CHECK & USER PAGE (Your Original Code + Form Status UI update)
// ==============================
function checkAdmin(req, res) {
  if (req.session.isAdmin) return true;
  if (req.query.p === process.env.ADMIN_PASS) { req.session.isAdmin = true; return true; }
  res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form method="GET" style="text-align:center;"><h2>🔒 Admin Access</h2><input type="password" name="p" placeholder="Enter Password" required style="padding:10px"/><br><br><button type="submit" style="padding:10px 20px">Access</button></form></body></html>`);
  return false;
}

app.get("/user/:id", async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;
    const u = (await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id])).rows[0];
    if (!u) return res.send("<h2>❌ Invalid QR</h2>");
    const getImgSrc = (url) => url || "https://via.placeholder.com/150?text=No+Image";

    res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verified Student</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Poppins',sans-serif}body{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.scanner-box{margin-bottom:20px;text-align:center;width:100%;max-width:500px}
input#scanInput{padding:12px 20px;font-size:18px;width:100%;text-align:center;border:none;border-radius:10px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);outline:none}
input#scanInput::placeholder{color:rgba(255,255,255,0.7)}
.card{width:100%;max-width:1000px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 15px 40px rgba(0,0,0,0.4)}
.card-header{background:linear-gradient(135deg,#00c853,#009624);color:#fff;text-align:center;padding:25px}
.card-header h2{font-size:24px;font-weight:600;margin-bottom:10px}
.badge{background:#fff;color:#00c853;display:inline-block;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600}
.card-body{padding:25px}
.info-container{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}
.info-item{display:flex;flex-direction:column}
.info-label{color:#555;font-weight:500;font-size:14px;margin-bottom:5px}
.info-value{font-weight:600;color:#222;font-size:14px;padding:8px 12px;background:rgba(0,200,83,0.05);border-radius:6px;min-height:40px;word-wrap:break-word}
.images-grid{display:flex;flex-wrap:wrap;gap:15px;justify-content:center;margin-top:20px}
.image-card{text-align:center;width:120px}.image-card div{font-size:12px;margin-bottom:5px;color:#555;font-weight:600}
.image-card a{text-decoration:none;display:block}
.image-card img{width:120px;height:120px;object-fit:cover;border-radius:10px;border:1px solid #ddd;background:#f5f5f5}
.card-footer{text-align:center;padding:20px;font-size:14px;color:#777;border-top:1px solid #eee}
.status{text-align:center;margin-top:20px;font-size:16px;color:#00c853;font-weight:600;padding:12px;border-radius:8px;background:rgba(0,200,83,0.1)}
.error-msg{color:#ff4444;font-size:16px;font-weight:600;display:none;margin-top:20px;padding:12px;border-radius:8px;background:rgba(255,68,68,0.1)}
/* NEW FORM STATUS */
.form-status-box{margin-top:20px;padding:16px;border-radius:10px;text-align:center;font-size:14px}
.form-filled{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.form-pending{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
@media(max-width:767px){.info-container{grid-template-columns:1fr}}
</style></head><body>
<div class="scanner-box"><input type="text" id="scanInput" placeholder="Scan Barcode..." autocomplete="off" spellcheck="false"/></div>
<div class="card">
  <div class="card-header"><h2>TUSHAR BHUMKAR INSTITUTE</h2><h2>Student Entry Pass</h2><div class="badge">✔ VERIFIED</div></div>
  <div class="card-body">
    <div class="info-container">
      <div class="info-item"><div class="info-label">Name</div><div class="info-value" id="u-full_name">${u.full_name}</div></div>
      <div class="info-item"><div class="info-label">Email</div><div class="info-value" id="u-email">${u.email}</div></div>
      <div class="info-item"><div class="info-label">Phone</div><div class="info-value" id="u-phone">${u.phone}</div></div>
      <div class="info-item"><div class="info-label">DOB</div><div class="info-value" id="u-dob">${u.dob}</div></div>
      <div class="info-item"><div class="info-label">Market</div><div class="info-value" id="u-market">${u.trading_market}</div></div>
      <div class="info-item"><div class="info-label">Type</div><div class="info-value" id="u-type">${u.trading_type}</div></div>
      <div class="info-item"><div class="info-label">Software</div><div class="info-value" id="u-software">${u.software_used}</div></div>
      <div class="info-item"><div class="info-label">Paid</div><div class="info-value" id="u-amount">₹ ${u.amount}</div></div>
      <div class="info-item"><div class="info-label">Mode</div><div class="info-value" id="u-mode">${u.payment_mode}</div></div>
      <div class="info-item"><div class="info-label">Course Type</div><div class="info-value" id="u-course">${u.course_type}</div></div>
    </div>
    <div style="margin-top:25px;"><h3 style="margin-bottom:10px;text-align:center;">Verification Documents</h3>
      <div class="images-grid">
        <div class="image-card"><div>Selfie</div><a href="${getImgSrc(u.selfie_image)}" target="_blank"><img id="u-selfie" src="${getImgSrc(u.selfie_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Selfie'"/></a></div>
        <div class="image-card"><div>Payment Proof</div><a href="${getImgSrc(u.payment_image)}" target="_blank"><img id="u-payment" src="${getImgSrc(u.payment_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Payment'"/></a></div>
        <div class="image-card"><div>Aadhar Front</div><a href="${getImgSrc(u.aadhar_front_image)}" target="_blank"><img id="u-aadhar_front" src="${getImgSrc(u.aadhar_front_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div>
        <div class="image-card"><div>Aadhar Back</div><a href="${getImgSrc(u.aadhar_back_image)}" target="_blank"><img id="u-aadhar_back" src="${getImgSrc(u.aadhar_back_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div>
      </div>
    </div>
    <div id="formStatusBox" class="form-status-box form-pending">🔄 Checking KYC Form status...</div>
    <div class="status">✔ Valid Entry Approved</div>
    <div id="error-display" class="error-msg">❌ Invalid ID</div>
  </div>
  <div class="card-footer">Scan QR / Barcode at Entry Gate</div>
</div>
<script>
const input = document.getElementById('scanInput');
setInterval(() => { if (document.activeElement !== input) input.focus(); }, 100);

async function checkFormStatus(userId) {
  try {
    const res = await fetch('/api/form-responses/' + userId);
    const json = await res.json();
    const box = document.getElementById('formStatusBox');
    if (json.success && json.data) {
      box.className = 'form-status-box form-filled';
      box.innerHTML = '✅ KYC Form Filled — ' + json.data.received_at_formatted;
    } else {
      box.className = 'form-status-box form-pending';
      box.innerHTML = '⏳ KYC Form Not Yet Filled';
    }
  } catch (e) { document.getElementById('formStatusBox').innerHTML = 'ℹ️ Status unavailable'; }
}
checkFormStatus('${u.id}');

input.addEventListener('keydown', async function (e) {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault(); const id = input.value.trim(); input.value = '';
    if (id) { window.history.pushState({}, "", "/user/" + id); await loadUserData(id); }
  }
});

async function loadUserData(id) {
  try {
    const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ barcode_id: id }) });
    const json = await res.json();
    if (json.success) {
      const u = json.data; document.getElementById('error-display').style.display = 'none';
      document.getElementById('u-full_name').innerText = u.full_name; document.getElementById('u-email').innerText = u.email;
      document.getElementById('u-phone').innerText = u.phone; document.getElementById('u-dob').innerText = u.dob;
      document.getElementById('u-market').innerText = u.trading_market; document.getElementById('u-type').innerText = u.trading_type;
      document.getElementById('u-software').innerText = u.software_used; document.getElementById('u-amount').innerText = '₹ ' + u.amount;
      document.getElementById('u-mode').innerText = u.payment_mode; document.getElementById('u-course').innerText = u.course_type;
      const up = (i, url, p) => { let img = document.getElementById(i); if(url&&url.length>10){img.src=url;img.parentElement.href=url;}else{img.src=p;img.parentElement.href="#";} };
      up('u-selfie', u.selfie_image, "https://via.placeholder.com/150?text=No+Selfie");
      up('u-payment', u.payment_image, "https://via.placeholder.com/150?text=No+Payment");
      up('u-aadhar_front', u.aadhar_front_image, "https://via.placeholder.com/150?text=No+Aadhar");
      up('u-aadhar_back', u.aadhar_back_image, "https://via.placeholder.com/150?text=No+Aadhar");
      document.querySelector('.status').innerText = "✅ Scan logged - Valid Entry Approved";
      checkFormStatus(id);
    } else { document.getElementById('error-display').style.display = 'block'; document.querySelector('.status').innerText = "❌ Invalid Barcode"; }
  } catch (err) { document.getElementById('error-display').style.display = 'block'; }
}
</script></body></html>`);
  } catch (err) { res.send("Error loading user"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

// DB INIT (Added google_form_responses table)
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (id VARCHAR(7) PRIMARY KEY, full_name VARCHAR(255), address TEXT, email VARCHAR(255), phone VARCHAR(20), dob DATE, date TIMESTAMP, trading_market VARCHAR(100), trading_type VARCHAR(100), source VARCHAR(100), software_used VARCHAR(100), amount NUMERIC, payment_mode VARCHAR(50), selfie_image TEXT, payment_image TEXT, aadhar_front_image TEXT, aadhar_back_image TEXT, course_type VARCHAR(100));`);
    await client.query(`CREATE TABLE IF NOT EXISTS scans (id SERIAL PRIMARY KEY, barcode_id VARCHAR(7) NOT NULL, course_type VARCHAR(255) NOT NULL, scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, device_info TEXT);`);
    await client.query(`CREATE TABLE IF NOT EXISTS google_form_responses (id VARCHAR(7) PRIMARY KEY, ref_id VARCHAR(50), full_name VARCHAR(255), email VARCHAR(255), phone VARCHAR(20), raw_data JSONB, received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
  } catch (err) { console.error("DB Init Error:", err); } finally { client.release(); }
}
initializeDatabase().catch(console.error);
