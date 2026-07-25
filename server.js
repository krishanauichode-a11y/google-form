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

// ==================================================================================
// 🌐 NODE.JS DATABASE (For Users, Scans, Passes)
// ==================================================================================
const pool = new Pool({
  user: "postgres.swknmxqcgoobxxjmrspz",
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  database: "postgres",
  password: "xpevVM-*Au%Vd9c",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// ==================================================================================
// ⚠️ PHP SUPABASE API CREDENTIALS
// ==================================================================================
const PHP_SUPABASE_URL = "https://uqejdqtwxpvgpolybtkg.supabase.co";
const PHP_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZWpkcXR3eHB2Z3BvbHlidGtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTI2ODEsImV4cCI6MjA5Nzc2ODY4MX0.7kHKkN6DmC1-6wNI8l5Pee-b78N-o7zqBHEKiiCKGX0";

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

// ==================================================================================
// 🆕 STEP 4: TRACKING LINK (Saves to PHP Database via API)
// ==================================================================================
app.get("/track", async (req, res) => {
  try {
    const { ref_id } = req.query;
    if (!ref_id) return res.status(400).send("Missing reference ID");

    await fetch(PHP_SUPABASE_URL + '/rest/v1/client_pipeline', {
      method: 'POST',
      headers: {
        'apikey': PHP_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${PHP_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        ref_id: ref_id,
        step_4_form_opened_at: new Date().toISOString()
      })
    });

    const googleFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLSfoR4hQ7Tg0OTnUN8OeYKlyTzZGSR8T0hS61Brphe7Q-HRVYA/viewform`;
    console.log(`🔄 Step 4 saved to PHP DB via API for ${ref_id}`);
    return res.redirect(googleFormUrl);

  } catch (err) {
    console.error("❌ TRACK ERROR:", err);
    res.status(500).send(`<h2 style="color:red; text-align:center; margin-top:50px;">Debug Error</h2><p style="text-align:center; font-family:monospace; background:#f3f4f6; padding:20px; max-width:600px; margin:20px auto; border-radius:8px;"><strong>Error Message:</strong><br>${err.message}</p>`);
  }
});

// ==================================================================================
// ✅ STEP 5: WEBHOOK (Saves to PHP Database via API)
// ==================================================================================
app.post("/webhook/google-form", async (req, res) => {
  try {
    const { ref_id } = req.body;
    if (!ref_id) return res.status(400).json({ success: false, message: "Missing ref_id" });

    await pool.query(`INSERT INTO google_form_responses (id, ref_id, raw_data, received_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING`, [generateShortId(), ref_id, JSON.stringify(req.body)]);

    await fetch(PHP_SUPABASE_URL + '/rest/v1/client_pipeline', {
      method: 'POST',
      headers: {
        'apikey': PHP_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${PHP_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        ref_id: ref_id,
        step_5_form_submitted_at: new Date().toISOString()
      })
    });

    console.log(`✅ Step 5 saved to PHP DB via API for ref_id: ${ref_id}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================================================================================
// 🔍 FIND REF_ID BY PHONE (Reads from PHP Database via API)
// ==================================================================================
app.post("/api/find-ref-by-phone", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Missing phone" });

    const cleanPhone = phone.replace(/\D/g, "").slice(-10);

    const response = await fetch(`${PHP_SUPABASE_URL}/rest/v1/customers?select=ref_id&mobile=ilike.%25${cleanPhone}%25&payment_status=eq.paid&order=paid_at.desc&limit=1`, {
      headers: {
        'apikey': PHP_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${PHP_SUPABASE_ANON_KEY}`
      }
    });

    const data = await response.json();

    if (data.length > 0) {
      console.log(`✅ Found ref_id ${data[0].ref_id} for phone ${cleanPhone}`);
      res.json({ success: true, ref_id: data[0].ref_id });
    } else {
      console.log(`❌ No payment found for phone ${cleanPhone}`);
      res.json({ success: false, message: "No matching payment found" });
    }
  } catch (err) {
    console.error("Find Phone Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================================================================================
// OTHER API ROUTES
// ==================================================================================
app.get("/api/pipeline/:ref_id", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM client_pipeline WHERE ref_id = $1`, [req.params.ref_id]);
    res.json({ success: r.rows.length > 0, data: r.rows[0] || null });
  } catch (e) { res.json({ success: false }); }
});

app.get("/api/form-responses/:ref_id", async (req, res) => {
  try {
    const r = await pool.query(`SELECT TO_CHAR(received_at, 'DD Mon YYYY, HH12:MI AM') as received_at_formatted FROM google_form_responses WHERE ref_id = $1 LIMIT 1`, [req.params.ref_id]);
    res.json({ success: r.rows.length > 0, data: r.rows[0] || null });
  } catch (e) { res.json({ success: false }); }
});

app.get("/api/user/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
    res.json(r.rows.length === 0 ? { success: false } : { success: true, data: r.rows[0] });
  } catch (e) { res.json({ success: false }); }
});

// ==================================================================================
// ✅ FIXED: SCAN ENDPOINT - Strips scanner garbage chars + consistent 'message' key
// ==================================================================================
app.post("/api/scan", async (req, res) => {
  try {
    let { barcode_id } = req.body;
    console.log("🔍 Raw scan input:", JSON.stringify(barcode_id), "| Type:", typeof barcode_id, "| Length:", barcode_id?.length);

    // STEP 1: Ensure string type (some scanners send numbers)
    barcode_id = String(barcode_id || "");

    // STEP 2: Strip ALL non-alphanumeric characters
    // This removes: STX (0x02), ETX (0x03), CR (\r), LF (\n), TAB, spaces, etc.
    barcode_id = barcode_id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

    console.log("🧹 Cleaned barcode:", JSON.stringify(barcode_id), "| Length:", barcode_id.length);

    // STEP 3: Validate format
    if (!barcode_id || barcode_id.length !== 7) {
      console.log("❌ Invalid barcode format after cleaning. Got length:", barcode_id.length, "Value:", JSON.stringify(barcode_id));
      return res.status(400).json({
        success: false,
        message: `Invalid format (need 7 chars, got ${barcode_id ? barcode_id.length : 0})`
      });
    }

    // STEP 4: Find user
    const ur = await pool.query("SELECT * FROM users WHERE id=$1", [barcode_id]);
    if (ur.rows.length === 0) {
      console.log("❌ User not found in database for barcode:", barcode_id);
      return res.json({ success: false, message: "ID not found in database" });
    }

    const u = ur.rows[0];
    console.log("✅ User found:", u.full_name, "| Course:", u.course_type);

    // STEP 5: Get Kolkata time
    const kolkataTime = await pool.query(
      `SELECT TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'), 'DD/MM/YYYY, HH12:MI:SS AM') AS kolkata_now`
    );
    const kolkataTimeString = kolkataTime.rows[0].kolkata_now;
    console.log("🕐 Kolkata time:", kolkataTimeString);

    // STEP 6: Update user scan date
    const updateResult = await pool.query(`UPDATE users SET date = $1 WHERE id = $2`, [kolkataTimeString, barcode_id]);
    console.log("✅ Users.date updated, rows affected:", updateResult.rowCount);

    // STEP 7: Log scan to scans table
    const courseType = u.course_type || 'Unknown';
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';

    const insertResult = await pool.query(
      `INSERT INTO scans (barcode_id, course_type, device_info, scanned_at)
       VALUES ($1, $2, $3, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))
       RETURNING id, scanned_at`,
      [barcode_id, courseType, deviceInfo]
    );
    console.log("✅ Scan recorded - Scan ID:", insertResult.rows[0]?.id, "at:", insertResult.rows[0]?.scanned_at);

    // STEP 8: Return success
    const returnData = { ...u, date: kolkataTimeString };
    res.json({ success: true, data: returnData, scan_id: insertResult.rows[0]?.id });

  } catch (e) {
    console.error("❌ SCAN ERROR:", e.message, "\nStack:", e.stack);
    res.status(500).json({ success: false, message: "Server error: " + e.message });
  }
});

// ==================================================================================
// IMAGE GENERATION
// ==================================================================================
async function generateFinalImage(id) {
  try {
    const qrPath = path.join(tempDir, `${id}-qr.png`);
    const barPath = path.join(tempDir, `${id}-barcode.png`);
    const logoPath = path.join(__dirname, 'logo.png');

    if (!fs.existsSync(qrPath) || !fs.existsSync(barPath)) throw new Error("Missing QR or Barcode file for " + id);

    const qrImage = await loadImage(qrPath);
    const barcodeImg = await loadImage(barPath);
    let logo;
    if (fs.existsSync(logoPath)) logo = await loadImage(logoPath);

    const scale = 2;
    const canvas = createCanvas(700 * scale, 900 * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 700, 900);

    const p = "#003366";
    ctx.lineWidth = 20;
    ctx.strokeStyle = p;
    ctx.strokeRect(10, 10, 680, 880);

    const cX = 350;
    let cY = 40;

    if (logo) {
      const sf = Math.min(500 / logo.width, 300 / logo.height);
      const dw = logo.width * sf;
      const dh = logo.height * sf;
      ctx.drawImage(logo, cX - (dw / 2), cY, dw, dh);
      cY += dh + 15;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = p;
    ctx.font = "bold 20px Arial";
    ctx.fillText("www.tusharbhumkar.com", cX, cY);
    cY += 30;

    ctx.beginPath();
    ctx.moveTo(50, cY);
    ctx.lineTo(650, cY);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#e0e0e0";
    ctx.stroke();
    cY += 70;

    ctx.fillStyle = p;
    ctx.font = "bold 50px Arial";
    ctx.fillText("ENTRY PASS", cX, cY);
    cY += 50;

    const qs = 320;
    ctx.drawImage(qrImage, cX - (qs / 2), cY, qs, qs);

    const bY = cY + qs + 25;
    ctx.drawImage(barcodeImg, 50, bY, 600, 100);

    ctx.fillStyle = "#000";
    ctx.font = "italic 20px Arial";
    ctx.fillText("Scan QR or Barcode at Entry", cX, bY + 130);

    const fp = path.join(tempDir, `${id}-final.png`);
    fs.writeFileSync(fp, canvas.toBuffer("image/png", { compressionLevel: 9 }));
    return `https://google-form-kebh.onrender.com/temp/${id}-final.png`;
  } catch (e) {
    console.error("IMG ERR", e);
    throw e;
  }
}

// ==================================================================================
// ✅ FIXED: CREATE - Explicitly inserts created_at with Asia/Kolkata time
// ==================================================================================
app.post("/create", async (req, res) => {
  try {
    const { fullName, address, email, phone, dob, date, tradingMarket, tradingType, softwareUsed, amount, paymentMode, selfieImage, paymentImage, aadharFrontImage, aadharBackImage, courseType } = req.body;
    const id = generateShortId();

    await pool.query(
      `INSERT INTO users(id, full_name, address, email, phone, dob, date, trading_market, trading_type, source, software_used, amount, payment_mode, selfie_image, payment_image, aadhar_front_image, aadhar_back_image, course_type, created_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))`,
      [id, fullName, address, email, phone, dob, date, tradingMarket, tradingType, null, softwareUsed, amount, paymentMode, selfieImage, paymentImage, aadharFrontImage, aadharBackImage, courseType]
    );

    fs.writeFileSync(path.join(tempDir, `${id}-qr.png`), await QRCode.toBuffer(`https://google-form-kebh.onrender.com/user/${id}`, { width: 600, margin: 2, errorCorrectionLevel: 'H' }));
    fs.writeFileSync(path.join(tempDir, `${id}-barcode.png`), await bwipjs.toBuffer({ bcid: "code128", text: id, alttext: id, scale: 3, height: 25, includetext: true, textxalign: "center", padding: 10 }));
    await generateFinalImage(id);

    console.log("✅ User created:", id, fullName, "| created_at set to Asia/Kolkata time");
    res.json({ success: true, id });
  } catch (e) {
    console.error("❌ CREATE ERROR:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================================================================================
// ✅ FIXED: SEND EMAIL - Anti-Spam + Embedded Image Buffer + Auto-Regen
// ==================================================================================
app.post("/send-email", async (req, res) => {
  try {
    const { id, email } = req.body;
    const u = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];

    if (!u) return res.status(404).json({ success: false, message: "User not found" });

    const finalImagePath = path.join(tempDir, `${id}-final.png`);
    const qrImagePath = path.join(tempDir, `${id}-qr.png`);
    const barcodeImagePath = path.join(tempDir, `${id}-barcode.png`);

    if (!fs.existsSync(finalImagePath) || !fs.existsSync(qrImagePath) || !fs.existsSync(barcodeImagePath)) {
      console.log(`🔄 Regenerating missing images for ${id}...`);

      if (!fs.existsSync(qrImagePath)) {
        const qrBuffer = await QRCode.toBuffer(`https://google-form-kebh.onrender.com/user/${id}`, { width: 600, margin: 2, errorCorrectionLevel: 'H' });
        fs.writeFileSync(qrImagePath, qrBuffer);
      }

      if (!fs.existsSync(barcodeImagePath)) {
        const barBuffer = await bwipjs.toBuffer({ bcid: "code128", text: id, alttext: id, scale: 3, height: 25, includetext: true, textxalign: "center", padding: 10 });
        fs.writeFileSync(barcodeImagePath, barBuffer);
      }

      await generateFinalImage(id);
    }

    if (!fs.existsSync(finalImagePath)) {
      console.error(`❌ Critical: Failed to generate image for ${id}`);
      return res.status(500).json({ success: false, message: "Failed to generate entry pass image" });
    }

    const imageBuffer = fs.readFileSync(finalImagePath);
    console.log(`✅ Image loaded into memory: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

    const t = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      tls: { rejectUnauthorized: false }
    });

    const mailResult = await t.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      replyTo: process.env.EMAIL_USER,
      subject: `Your Entry Pass - ${u.full_name} - ID: ${id}`,
      text: `Hello ${u.full_name},\n\nYour entry pass is ready!\n\nYour ID: ${id}\nCourse: ${u.course_type || 'N/A'}\n\nPlease show this pass at the entry gate.\n\n- Tushar Bhumkar Institute\nwww.tusharbhumkar.com`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4; padding:20px;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#003366; padding:25px 30px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:bold;">Tushar Bhumkar Institute</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:30px;">
              <h2 style="margin:0 0 10px 0; color:#003366; font-size:20px;">Hello ${u.full_name},</h2>
              <p style="margin:0 0 20px 0; color:#555555; font-size:15px; line-height:1.5;">Your entry pass is ready. Please show this pass at the entry gate.</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:15px 0;">
                    <img src="cid:entrypass" width="280" style="max-width:100%; height:auto; border:1px solid #e0e0e0; border-radius:6px; display:block;" alt="Entry Pass">
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                <tr>
                  <td style="background-color:#f0f7ff; padding:15px; border-radius:6px; border-left:4px solid #003366;">
                    <p style="margin:0 0 5px 0; color:#003366; font-size:14px;"><strong>Your ID:</strong> ${id}</p>
                    <p style="margin:0 0 5px 0; color:#003366; font-size:14px;"><strong>Course:</strong> ${u.course_type || 'N/A'}</p>
                    <p style="margin:0; color:#003366; font-size:14px;"><strong>Instructions:</strong> Scan QR or Barcode at entry</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9f9f9; padding:20px 30px; text-align:center; border-top:1px solid #eeeeee;">
              <p style="margin:0 0 5px 0; color:#999999; font-size:12px;">Tushar Bhumkar Institute</p>
              <p style="margin:0; color:#999999; font-size:12px;">www.tusharbhumkar.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      attachments: [
        {
          filename: 'entry-pass.png',
          content: imageBuffer,
          contentType: 'image/png',
          contentDisposition: 'inline',
          cid: 'entrypass'
        }
      ],
      headers: {
        'X-Priority': '1',
        'X-MS-Priority': 'High',
        'Importance': 'high',
        'X-Mailer': 'TusharBhumkarInstitute/1.0',
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=unsubscribe>`
      }
    });

    console.log(`✅ Email sent successfully to ${email} | ID: ${mailResult.messageId}`);
    res.json({ success: true, messageId: mailResult.messageId });

  } catch (e) {
    console.error("❌ EMAIL ERROR:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================================================================================
// ✅ SHARE VIA INTERAKT (WhatsApp)
// ==================================================================================
app.post("/share-interakt", async (req, res) => {
  try {
    const { id, phone } = req.body;
    const cp = phone.replace(/\D/g, "").slice(-10);
    const u = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];

    if (!u) return res.json({ success: false, message: "User not found" });

    const r = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.INTERAKT_API_KEY}`
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: cp,
        type: "Template",
        template: {
          name: "entry_pass",
          languageCode: "en",
          bodyValues: [String(u.full_name || "User"), "Scan QR or Barcode at entry"],
          headerValues: [`https://google-form-kebh.onrender.com/temp/${id}-final.png`]
        }
      })
    });

    res.json({ success: true, data: await r.json() });
  } catch (e) {
    console.error("❌ INTERAKT ERROR:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================================================================================
// ADMIN & USER VIEW
// ==================================================================================
function checkAdmin(req, res) {
  if (req.session.isAdmin) return true;
  if (req.query.p === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return true;
  }
  res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form method="GET" style="text-align:center;"><h2>🔒 Admin Access</h2><input type="password" name="p" placeholder="Enter Password" required style="padding:10px"/><br><br><button type="submit" style="padding:10px 20px">Access</button></form></body></html>`);
  return false;
}

app.get("/user/:id", async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;
    const u = (await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id])).rows[0];
    if (!u) return res.send("<h2>❌ Invalid QR</h2>");
    const gi = (url) => url || "https://via.placeholder.com/150?text=No+Image";

    const createdAtDisplay = u.created_at ? new Date(u.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A';
    const scanDateDisplay = u.date || 'Never';

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Verified Student</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Poppins',sans-serif }
    body { background:linear-gradient(135deg,#0f2027,#203a43,#2c5364); display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:100vh; padding:20px }
    .scanner-box { margin-bottom:20px; text-align:center; width:100%; max-width:500px }
    input#scanInput { padding:12px 20px; font-size:18px; width:100%; text-align:center; border:none; border-radius:10px; background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.3); outline:none }
    input#scanInput::placeholder { color:rgba(255,255,255,0.7) }
    .card { width:100%; max-width:1000px; background:#fff; border-radius:20px; overflow:hidden; box-shadow:0 15px 40px rgba(0,0,0,0.4) }
    .card-header { background:linear-gradient(135deg,#00c853,#009624); color:#fff; text-align:center; padding:25px }
    .card-header h2 { font-size:24px; font-weight:600; margin-bottom:10px }
    .badge { background:#fff; color:#00c853; display:inline-block; padding:6px 14px; border-radius:20px; font-size:14px; font-weight:600 }
    .card-body { padding:25px }
    .info-container { display:grid; grid-template-columns:repeat(3,1fr); gap:15px }
    .info-item { display:flex; flex-direction:column }
    .info-label { color:#555; font-weight:500; font-size:14px; margin-bottom:5px }
    .info-value { font-weight:600; color:#222; font-size:14px; padding:8px 12px; background:rgba(0,200,83,0.05); border-radius:6px; min-height:40px; word-wrap:break-word }
    .images-grid { display:flex; flex-wrap:wrap; gap:15px; justify-content:center; margin-top:20px }
    .image-card { text-align:center; width:120px }
    .image-card div { font-size:12px; margin-bottom:5px; color:#555; font-weight:600 }
    .image-card a { text-decoration:none; display:block }
    .image-card img { width:120px; height:120px; object-fit:cover; border-radius:10px; border:1px solid #ddd; background:#f5f5f5 }
    .card-footer { text-align:center; padding:20px; font-size:14px; color:#777; border-top:1px solid #eee }
    .status { text-align:center; margin-top:20px; font-size:16px; color:#00c853; font-weight:600; padding:12px; border-radius:8px; background:rgba(0,200,83,0.1) }
    .error-msg { color:#ff4444; font-size:16px; font-weight:600; display:none; margin-top:20px; padding:12px; border-radius:8px; background:rgba(255,68,68,0.1) }
    .form-status-box { margin-top:20px; padding:16px; border-radius:10px; text-align:center; font-size:14px }
    .form-filled { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534 }
    .form-pending { background:#fffbeb; border:1px solid #fde68a; color:#92400e }
    .scan-count { margin-top:10px; font-size:13px; color:#888; text-align:center }
    @media(max-width:767px) { .info-container { grid-template-columns:1fr } }
  </style>
</head>
<body>
  <div class="scanner-box">
    <input type="text" id="scanInput" placeholder="Scan Barcode..." autocomplete="off" spellcheck="false"/>
  </div>
  <div class="card">
    <div class="card-header">
      <h2>TUSHAR BHUMKAR INSTITUTE</h2>
      <h2>Student Entry Pass</h2>
      <div class="badge">✔ VERIFIED</div>
    </div>
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
        <div class="info-item"><div class="info-label">Created At</div><div class="info-value" id="u-created_at">${createdAtDisplay}</div></div>
        <div class="info-item"><div class="info-label">Last Scanned</div><div class="info-value" id="u-scan_date">${scanDateDisplay}</div></div>
        <div class="info-item"><div class="info-label">Scan Count</div><div class="info-value" id="u-scan_count">Loading...</div></div>
      </div>
      <div style="margin-top:25px;">
        <h3 style="margin-bottom:10px;text-align:center;">Verification Documents</h3>
        <div class="images-grid">
          <div class="image-card"><div>Selfie</div><a href="${gi(u.selfie_image)}" target="_blank"><img id="u-selfie" src="${gi(u.selfie_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Selfie'"/></a></div>
          <div class="image-card"><div>Payment Proof</div><a href="${gi(u.payment_image)}" target="_blank"><img id="u-payment" src="${gi(u.payment_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Payment'"/></a></div>
          <div class="image-card"><div>Aadhar Front</div><a href="${gi(u.aadhar_front_image)}" target="_blank"><img id="u-aadhar_front" src="${gi(u.aadhar_front_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div>
          <div class="image-card"><div>Aadhar Back</div><a href="${gi(u.aadhar_back_image)}" target="_blank"><img id="u-aadhar_back" src="${gi(u.aadhar_back_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div>
        </div>
      </div>
      <div id="formStatusBox" class="form-status-box form-pending">🔄 Checking KYC Form status...</div>
      <div class="status" id="statusMsg">✔ Valid Entry Approved</div>
      <div id="error-display" class="error-msg">❌ Invalid ID</div>
    </div>
    <div class="card-footer">Scan QR / Barcode at Entry Gate</div>
  </div>
  <script>
    const input = document.getElementById('scanInput');
    setInterval(() => { if (document.activeElement !== input) input.focus(); }, 100);

    async function getScanCount(userId) {
      try {
        const res = await fetch('/api/scan-count/' + userId);
        const json = await res.json();
        document.getElementById('u-scan_count').innerText = json.success ? (json.count + ' time(s)') : '0 time(s)';
      } catch(e) {
        document.getElementById('u-scan_count').innerText = 'Error';
      }
    }

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
      } catch (e) {
        document.getElementById('formStatusBox').innerHTML = 'ℹ️ Status unavailable';
      }
    }

    checkFormStatus('${u.id}');
    getScanCount('${u.id}');

    input.addEventListener('keydown', async function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        let id = input.value;
        input.value = '';

        if (id) {
          id = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();

          if (id.length === 7) {
            window.history.pushState({}, "", "/user/" + id);
            await loadUserData(id);
          } else {
            document.getElementById('error-display').style.display = 'block';
            document.getElementById('error-display').innerText = '❌ Invalid barcode length (' + id.length + ' chars). Need exactly 7.';
            document.getElementById('statusMsg').innerText = "❌ Invalid Barcode";
            document.getElementById('statusMsg').style.color = "#ff4444";
            document.getElementById('statusMsg').style.background = "rgba(255,68,68,0.1)";
          }
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
          document.getElementById('error-display').style.display = 'none';
          document.getElementById('u-full_name').innerText = u.full_name;
          document.getElementById('u-email').innerText = u.email;
          document.getElementById('u-phone').innerText = u.phone;
          document.getElementById('u-dob').innerText = u.dob;
          document.getElementById('u-market').innerText = u.trading_market;
          document.getElementById('u-type').innerText = u.trading_type;
          document.getElementById('u-software').innerText = u.software_used;
          document.getElementById('u-amount').innerText = '₹ ' + u.amount;
          document.getElementById('u-mode').innerText = u.payment_mode;
          document.getElementById('u-course').innerText = u.course_type;
          document.getElementById('u-scan_date').innerText = u.date || 'Never';

          if (u.created_at) {
            document.getElementById('u-created_at').innerText = new Date(u.created_at).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
            });
          } else {
            document.getElementById('u-created_at').innerText = 'N/A';
          }

          const up = (i, url, p) => {
            let img = document.getElementById(i);
            if (url && url.length > 10) {
              img.src = url;
              img.parentElement.href = url;
            } else {
              img.src = p;
              img.parentElement.href = "#";
            }
          };
          up('u-selfie', u.selfie_image, "https://via.placeholder.com/150?text=No+Selfie");
          up('u-payment', u.payment_image, "https://via.placeholder.com/150?text=No+Payment");
          up('u-aadhar_front', u.aadhar_front_image, "https://via.placeholder.com/150?text=No+Aadhar");
          up('u-aadhar_back', u.aadhar_back_image, "https://via.placeholder.com/150?text=No+Aadhar");

          document.getElementById('statusMsg').innerText = "✅ Scan logged - Valid Entry Approved";
          document.getElementById('statusMsg').style.color = "#00c853";
          document.getElementById('statusMsg').style.background = "rgba(0,200,83,0.1)";
          checkFormStatus(id);
          getScanCount(id);

        } else {
          document.getElementById('error-display').style.display = 'block';
          document.getElementById('error-display').innerText = '❌ ' + (json.message || json.error || 'Invalid Barcode');
          document.getElementById('statusMsg').innerText = "❌ " + (json.message || json.error || 'Invalid Barcode');
          document.getElementById('statusMsg').style.color = "#ff4444";
          document.getElementById('statusMsg').style.background = "rgba(255,68,68,0.1)";
        }
      } catch (err) {
        console.error('Scan error:', err);
        document.getElementById('error-display').style.display = 'block';
        document.getElementById('error-display').innerText = '❌ Network Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`);
  } catch (e) {
    console.error("User page error:", e);
    res.send("Error loading user");
  }
});

// ==================================================================================
// ✅ GET SCAN COUNT ENDPOINT
// ==================================================================================
app.get("/api/scan-count/:barcode_id", async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) as count FROM scans WHERE barcode_id = $1", [req.params.barcode_id]);
    res.json({ success: true, count: result.rows[0].count });
  } catch (e) {
    console.error("Scan count error:", e);
    res.json({ success: false, count: 0 });
  }
});

// ==================================================================================
// ✅ GET ALL SCANS (Admin)
// ==================================================================================
app.get("/api/scans", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name, u.phone, u.course_type FROM scans s LEFT JOIN users u ON s.barcode_id = u.id ORDER BY s.scanned_at DESC LIMIT 100`
    );
    res.json({ success: true, data: result.rows });
  } catch (e) {
    console.error("Scans list error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

// ==================================================================================
// ✅ FIXED: DB INIT - Migrates 'date' column from DATE → VARCHAR(50)
// ==================================================================================
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // 1. Create table if not exists (safe - skips if already exists)
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(7) PRIMARY KEY, full_name VARCHAR(255), address TEXT, email VARCHAR(255), phone VARCHAR(20), dob DATE, date VARCHAR(50), trading_market VARCHAR(100), trading_type VARCHAR(100), source VARCHAR(100), software_used VARCHAR(100), amount NUMERIC, payment_mode VARCHAR(50), selfie_image TEXT, payment_image TEXT, aadhar_back_image TEXT, aadhar_front_image TEXT, course_type VARCHAR(100)
    );`);

    // 2. ✅ CRITICAL FIX: Convert 'date' column from DATE → VARCHAR(50) if it's still DATE type
    // This handles the case where the table was created BEFORE 'date' was changed to VARCHAR
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'date'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'date' AND data_type = 'character varying'
          ) THEN
            ALTER TABLE users ALTER COLUMN date TYPE VARCHAR(50) USING date::text;
            RAISE NOTICE '✅ FIXED: date column converted from DATE to VARCHAR(50)';
          ELSE
            RAISE NOTICE '✅ date column is already VARCHAR(50) - OK';
          END IF;
        END IF;
      END $$;
    `);

    // 3. Add created_at column if missing
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'created_at') THEN
          ALTER TABLE users ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
          UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
          RAISE NOTICE '✅ created_at column added to users table';
        ELSE
          RAISE NOTICE '✅ created_at column already exists in users table';
        END IF;
      END $$;
    `);

    // 4. Scans table
    await client.query(`CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY, barcode_id VARCHAR(7) NOT NULL, course_type VARCHAR(255), scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, device_info TEXT
    );`);

    // 5. Google form responses table
    await client.query(`CREATE TABLE IF NOT EXISTS google_form_responses (
      id VARCHAR(7) PRIMARY KEY, ref_id VARCHAR(50), full_name VARCHAR(255), email VARCHAR(255), phone VARCHAR(20), raw_data JSONB, received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    console.log("✅ Node.js DB tables ready.");

  } catch (err) {
    console.error("DB Init Error:", err);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);
