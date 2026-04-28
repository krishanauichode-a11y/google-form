const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Database connection
const pool = new Pool({
  user: "postgres.ufbttlxvzuchacptqkee",
  host: "aws-1-ap-south-1.pooler.supabase.com",
  database: "postgres",
  password: "1lqW1fYbCxK4jgr9",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// Test route
app.get("/", (req, res) => {
  res.send("✅ Server Running");
});

// Create user with QR/Barcode
app.post("/create", async (req, res) => {
  try {
    const payload = req.body;
    const id = uuidv4();

    // Insert into database
    await pool.query(
      `INSERT INTO users(
        id, full_name, address, email, phone, dob, date,
        trading_market, trading_type, source,
        software_used, previous_course, level,
        amount, payment_mode
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, payload.fullName, payload.address, payload.email, payload.phone,
        payload.dob, new Date().toISOString(), payload.tradingMarket,
        payload.tradingType, payload.source, payload.softwareUsed,
        payload.previousCourse, payload.level, payload.amount, payload.paymentMode
      ]
    );

    // Generate QR and Barcode
    const url = `https://google-form-kebh.onrender.com/user/${id}`;
    const qr = await QRCode.toDataURL(url);
    
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: id.substring(0, 12),
      scale: 2,
      height: 10,
      includetext: false,
      textxalign: "center"
    });

    // Save files
    ensureTempDir();
    const qrPath = saveTempFile(id, "qr", qr);
    const barcodePath = saveTempFile(id, "barcode", barcodeBuffer);

    res.json({
      success: true,
      id,
      url,
      qr,
      barcode: barcodeBuffer.toString("base64"),
      qrPath,
      barcodePath
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Share via Interakt
app.post("/share-interakt", async (req, res) => {
  try {
    const { id } = req.body;
    const user = await getUser(id);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const interaktNumber = user.phone.startsWith("+") ? user.phone : `+91${user.phone}`;
    const baseUrl = req.protocol + '://' + req.get('host');
    const qrUrl = `${baseUrl}/media/${id}/qr`;
    const barcodeUrl = `${baseUrl}/media/${id}/barcode`;

    // Send QR
    await sendInteraktMessage(interaktNumber, "student_qr", qrUrl);
    // Send Barcode
    await sendInteraktMessage(interaktNumber, "student_barcode", barcodeUrl);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Interakt Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// User details page
app.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getUser(id);
    
    if (!user) {
      return res.send("<h2>❌ Invalid QR Code</h2>");
    }

    res.send(`
      <div style="text-align:center; font-family:sans-serif; padding:20px;">
        <h2>✅ Verified Student</h2>
        <p><strong>Name:</strong> ${user.full_name}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Phone:</strong> ${user.phone}</p>
        <p><strong>Address:</strong> ${user.address}</p>
        <p><strong>Date of Birth:</strong> ${user.dob}</p>
        <p><strong>Trading Market:</strong> ${user.trading_market}</p>
        <p><strong>Trading Type:</strong> ${user.trading_type}</p>
        <p><strong>Source:</strong> ${user.source}</p>
        <p><strong>Software Used:</strong> ${user.software_used}</p>
        <p><strong>Previous Course:</strong> ${user.previous_course}</p>
        <p><strong>Level:</strong> ${user.level}</p>
        <p><strong>Amount Paid:</strong> ${user.amount}</p>
        <p><strong>Payment Mode:</strong> ${user.payment_mode}</p>
        <hr>
        <p><small>Scan this QR/Barcode again to reload</small></p>
      </div>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error loading user");
  }
});

// Serve media files
app.get("/media/:id/:type", (req, res) => {
  const { id, type } = req.params;
  const filePath = path.join(__dirname, "temp", `${id}-${type}.png`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Helper functions
function ensureTempDir() {
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
}

function saveTempFile(id, type, data) {
  const filePath = path.join(__dirname, "temp", `${id}-${type}.png`);
  fs.writeFileSync(filePath, data);
  return filePath;
}

async function getUser(id) {
  const result = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
  return result.rows[0];
}

async function sendInteraktMessage(phone, template, mediaUrl) {
  const response = await fetch("https://api.interakt.io/v1/YOUR_WORKSPACE_ID/whatsapp/sendTemplateMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer ODRvSkhXcG9HcXYtTkRFODlrZ0NBa0lBeERxRFFJX2ZlWEItbE5ucjFQWTo="
    },
    body: JSON.stringify({
      whatsappNumber: phone,
      templateName: template,
      languageCode: "en",
      header: { type: "media", mediaUrl }
    })
  });
  
  return response.ok;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
