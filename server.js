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
// 🌐 DATABASE 1: NODE.JS DIRECT POOL
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
// 🌐 DATABASE 2: SECOND SUPABASE (REST API)
// ==================================================================================
const DB2_URL = "https://ufbttlxvzuchacptqkee.supabase.co";
const DB2_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmYnR0bHh2enVjaGFjcHRxa2VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjEyODgsImV4cCI6MjA5MjIzNzI4OH0.wbF4swxoioLEzMWno5OOGLjCq8FkryNDVqyJu048CR0";

// ==================================================================================
// 🌐 DATABASE 3: PHP SUPABASE API (DO NOT TOUCH)
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
// 🔍 UNIFIED USER FINDER (Checks Database 1 & Database 2)
// ==================================================================================
async function findUser(id) {
  // Step 1: Check Database 1 (Node.js Direct Pool)
  try {
    const r = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
    if (r.rows.length > 0) {
      console.log(`✅ Found ${id} in Database 1 (Node.js Pool)`);
      return { ...r.rows[0], _source: "db1" };
    }
  } catch (e) {
    console.error("DB1 error:", e.message);
  }

  // Step 2: Check Database 2 (Second Supabase REST API)
  // Try "users" table first
  try {
    const response = await fetch(`${DB2_URL}/rest/v1/users?id=eq.${id}&select=*`, {
      headers: {
        'apikey': DB2_KEY,
        'Authorization': `Bearer ${DB2_KEY}`
      }
    });
    const data = await response.json();
    if (data.length > 0 && !data.code) {
      console.log(`✅ Found ${id} in Database 2 (users table)`);
      const c = data[0];
      return {
        id: c.id,
        full_name: c.full_name || c.name || '',
        email: c.email || '',
        phone: c.phone || c.mobile || '',
        dob: c.dob || '',
        trading_market: c.trading_market || '',
        trading_type: c.trading_type || '',
        software_used: c.software_used || '',
        amount: c.amount || 0,
        payment_mode: c.payment_mode || '',
        course_type: c.course_type || '',
        created_at: c.created_at || null,
        selfie_image: c.selfie_image || '',
        payment_image: c.payment_image || '',
        aadhar_front_image: c.aadhar_front_image || '',
        aadhar_back_image: c.aadhar_back_image || '',
        _source: "db2_users"
      };
    }
  } catch (e) {
    console.error("DB2 users table error:", e.message);
  }

  // Try "customers" table in Database 2
  try {
    const response = await fetch(`${DB2_URL}/rest/v1/customers?ref_id=eq.${id}&select=*`, {
      headers: {
        'apikey': DB2_KEY,
        'Authorization': `Bearer ${DB2_KEY}`
      }
    });
    const data = await response.json();
    if (data.length > 0 && !data.code) {
      console.log(`✅ Found ${id} in Database 2 (customers table)`);
      const c = data[0];
      return {
        id: c.ref_id || c.id,
        full_name: c.full_name || c.name || '',
        email: c.email || '',
        phone: c.mobile || c.phone || '',
        dob: c.dob || '',
        trading_market: c.trading_market || '',
        trading_type: c.trading_type || '',
        software_used: c.software_used || '',
        amount: c.amount || c.paid_amount || 0,
        payment_mode: c.payment_mode || '',
        course_type: c.course_type || '',
        created_at: c.created_at || c.paid_at || null,
        selfie_image: c.selfie_image || '',
        payment_image: c.payment_image || '',
        aadhar_front_image: c.aadhar_front_image || '',
        aadhar_back_image: c.aadhar_back_image || '',
        _source: "db2_customers"
      };
    }
  } catch (e) {
    console.error("DB2 customers table error:", e.message);
  }

  console.log(`❌ User ${id} NOT found in Database 1 or Database 2`);
  return null;
}

// ==================================================================================
// 🆕 STEP 4: TRACKING LINK (DATABASE 3 ONLY - PHP SUPABASE)
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
    console.log(`🔄 Step 4 saved to Database 3 (PHP) for ${ref_id}`);
    return res.redirect(googleFormUrl);
    
  } catch (err) {
    console.error("❌ TRACK ERROR:", err);
    res.status(500).send(`<h2 style="color:red; text-align:center; margin-top:50px;">Debug Error</h2><p style="text-align:center; font-family:monospace; background:#f3f4f6; padding:20px; max-width:600px; margin:20px auto; border-radius:8px;"><strong>Error Message:</strong><br>${err.message}</p>`);
  }
});

// ==================================================================================
// ✅ STEP 5: WEBHOOK (DATABASE 3 ONLY - PHP SUPABASE)
// ==================================================================================
app.post("/webhook/google-form", async (req, res) => {
  try {
    const { ref_id } = req.body;
    if (!ref_id) return res.status(400).json({ error: "Missing ref_id" });
    
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
    
    console.log(`✅ Step 5 saved to Database 3 (PHP) for ref_id: ${ref_id}`);
    res.status(200).json({ success: true });
  } catch (err) { 
    console.error("❌ WEBHOOK ERROR:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// ==================================================================================
// 🔍 FIND REF_ID BY PHONE (DATABASE 3 ONLY - PHP SUPABASE)
// ==================================================================================
app.post("/api/find-ref-by-phone", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Missing phone" });
    
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
      res.json({ success: false, error: "No matching payment found" });
    }
  } catch (err) {
    console.error("Find Phone Error:", err);
    res.status(500).json({ error: err.message });
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
    const u = await findUser(req.params.id);
    res.json(u ? { success: true, data: u } : { success: false }); 
  } catch(e){res.json({success:false});}
});

app.post("/api/scan", async (req, res) => { 
  try { 
    const {barcode_id}=req.body; 
    if(!barcode_id||barcode_id.length!==7) return res.status(400).json({success:false,message:"Invalid ID"}); 
    
    const u = await findUser(barcode_id);
    if(!u) return res.json({success:false,message:"Not found"}); 
    
    // Only log scan to Database 1 if user exists there
    try {
      await pool.query(`UPDATE users SET date = TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') WHERE id=$1`,[barcode_id]); 
      await pool.query(`INSERT INTO scans (barcode_id, course_type, device_info) VALUES ($1,$2,$3)`,[barcode_id,u.course_type,req.headers['user-agent']]); 
    } catch(e) {
      console.log(`Scan log skipped for DB1 (user from ${u._source})`);
    }
    
    res.json({success:true,data:u}); 
  } catch(e){res.status(500).json({success:false});}
});

// ==================================================================================
// IMAGE GENERATION
// ==================================================================================
async function generateFinalImage(id) {
  try {
    const qrPath=path.join(tempDir,`${id}-qr.png`);const barPath=path.join(tempDir,`${id}-barcode.png`);const logoPath=path.join(__dirname,'logo.png');
    if(!fs.existsSync(qrPath)||!fs.existsSync(barPath)) throw new Error("Missing files");
    const qrImage=await loadImage(qrPath);const barcodeImg=await loadImage(barPath);let logo;if(fs.existsSync(logoPath)) logo=await loadImage(logoPath);
    const scale=2;const canvas=createCanvas(700*scale,900*scale);const ctx=canvas.getContext("2d");ctx.scale(scale,scale);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    ctx.fillStyle="#fff";ctx.fillRect(0,0,700,900);const p="#003366";ctx.lineWidth=20;ctx.strokeStyle=p;ctx.strokeRect(10,10,680,880);const cX=350;let cY=40;
    if(logo){const sf=Math.min(500/logo.width,300/logo.height);const dw=logo.width*sf;const dh=logo.height*sf;ctx.drawImage(logo,cX-(dw/2),cY,dw,dh);cY+=dh+15;}
    ctx.textAlign="center";ctx.fillStyle=p;ctx.font="bold 20px Arial";ctx.fillText("www.tusharbhumkar.com",cX,cY);cY+=30;ctx.beginPath();ctx.moveTo(50,cY);ctx.lineTo(650,cY);ctx.lineWidth=2;ctx.strokeStyle="#e0e0e0";ctx.stroke();cY+=70;ctx.fillStyle=p;ctx.font="bold 50px Arial";ctx.fillText("ENTRY PASS",cX,cY);cY+=50;
    const qs=320;ctx.drawImage(qrImage,cX-(qs/2),cY,qs,qs);const bY=cY+qs+25;ctx.drawImage(barcodeImg,50,bY,600,100);ctx.fillStyle="#000";ctx.font="italic 20px Arial";ctx.fillText("Scan QR or Barcode at Entry",cX,bY+130);
    const fp=path.join(tempDir,`${id}-final.png`);fs.writeFileSync(fp,canvas.toBuffer("image/png",{compressionLevel:9}));return `https://google-form-kebh.onrender.com/temp/${id}-final.png`;
  } catch(e){console.error("IMG ERR",e);throw e;}
}

// ==================================================================================
// CREATE & SEND ROUTES
// ==================================================================================
app.post("/create", async (req, res) => { 
  try { 
    const {fullName,address,email,phone,dob,date,tradingMarket,tradingType,softwareUsed,amount,paymentMode,selfieImage,paymentImage,aadharFrontImage,aadharBackImage,courseType}=req.body; 
    const id=generateShortId(); 
    
    await pool.query(`INSERT INTO users(id,full_name,address,email,phone,dob,date,trading_market,trading_type,source,software_used,amount,payment_mode,selfie_image,payment_image,aadhar_front_image,aadhar_back_image,course_type,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_TIMESTAMP)`,[id,fullName,address,email,phone,dob,date,tradingMarket,tradingType,null,softwareUsed,amount,paymentMode,selfieImage,paymentImage,aadharFrontImage,aadharBackImage,courseType]); 
    
    fs.writeFileSync(path.join(tempDir,`${id}-qr.png`),await QRCode.toBuffer(`https://google-form-kebh.onrender.com/pass/${id}`,{width:600,margin:2,errorCorrectionLevel:'H'})); 
    fs.writeFileSync(path.join(tempDir,`${id}-barcode.png`),await bwipjs.toBuffer({bcid:"code128",text:id,alttext:id,scale:3,height:25,includetext:true,textxalign:"center",padding:10})); 
    await generateFinalImage(id); 
    res.json({success:true,id}); 
  } catch(e){res.status(500).json({error:e.message});}
});

app.post("/send-email", async (req, res) => { 
  try { 
    const {id,email}=req.body; 
    const u=(await pool.query("SELECT * FROM users WHERE id=$1",[id])).rows[0]; 
    const t=nodemailer.createTransport({host:"smtp.gmail.com",port:587,secure:false,auth:{user:process.env.EMAIL_USER,pass:process.env.EMAIL_PASS},tls:{rejectUnauthorized:false}}); 
    await t.sendMail({from:`"Tushar Bhumkar Institute" <${process.env.EMAIL_USER}>`,to:email,subject:"🎟️ Your Entry Pass",html:`<h2>Hello ${u.full_name},</h2><p>Your entry pass is ready.</p><img src="${await generateFinalImage(id)}" width="300"/><p><a href="https://google-form-kebh.onrender.com/pass/${id}">Click here to view your pass online</a></p>`}); 
    res.json({success:true}); 
  } catch(e){res.status(500).json({error:e.message});}
});

app.post("/share-interakt", async (req, res) => { 
  try { 
    const {id,phone}=req.body; 
    const cp=phone.replace(/\D/g,"").slice(-10); 
    const u=(await pool.query("SELECT * FROM users WHERE id=$1",[id])).rows[0]; 
    if(!u) return res.json({success:false}); 
    const r=await fetch("https://api.interakt.ai/v1/public/message/",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Basic ${process.env.INTERAKT_API_KEY}`},body:JSON.stringify({countryCode:"+91",phoneNumber:cp,type:"Template",template:{name:"entry_pass",languageCode:"en",bodyValues:[String(u.full_name||"User"),"Scan QR or Barcode at entry"],headerValues:[`https://google-form-kebh.onrender.com/temp/${id}-final.png`]}})}); 
    res.json({success:true,data:await r.json()}); 
  } catch(e){res.status(500).json({error:e.message});}
});

// ==================================================================================
// 📱 PUBLIC PASS VIEW (Checks Database 1 & Database 2 - No login required)
// ==================================================================================
app.get("/pass/:id", async (req, res) => { 
  try { 
    const u = await findUser(req.params.id); 
    
    if (!u) {
      return res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Invalid Pass</title><style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;font-family:sans-serif;background:#f5f5f5}.box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}.icon{font-size:60px;margin-bottom:15px}h2{color:#e53935;margin-bottom:10px}p{color:#666}</style></head><body><div class="box"><div class="icon">❌</div><h2>Invalid Pass</h2><p>This pass ID does not exist in our system.</p></div></body></html>`); 
    }
    
    const formatDate = (d) => d ? new Date(d).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'N/A';
    
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Entry Pass - ${u.full_name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
    body { background: linear-gradient(135deg, #0f2027, #203a43, #2c5364); min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .pass-card { width: 100%; max-width: 480px; background: #fff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
    .pass-header { background: linear-gradient(135deg, #00c853, #009624); color: #fff; text-align: center; padding: 30px 20px; position: relative; }
    .pass-header::after { content: ''; position: absolute; bottom: -15px; left: 0; right: 0; height: 30px; background: #fff; border-radius: 24px 24px 0 0; }
    .pass-header h1 { font-size: 18px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; }
    .pass-header h2 { font-size: 28px; font-weight: 700; margin-top: 5px; }
    .pass-id { display: inline-block; background: rgba(255,255,255,0.25); padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-top: 10px; letter-spacing: 1px; }
    .pass-body { padding: 30px 25px; }
    .user-name { text-align: center; font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 20px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 25px; }
    .info-box { background: #f8f9fa; border-radius: 12px; padding: 12px 14px; }
    .info-box .label { font-size: 11px; color: #888; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .info-box .value { font-size: 14px; color: #222; font-weight: 600; word-wrap: break-word; }
    .divider { height: 1px; background: #e0e0e0; margin: 20px 0; }
    .pass-image { text-align: center; margin-bottom: 20px; }
    .pass-image img { max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); }
    .status-bar { text-align: center; padding: 15px; background: linear-gradient(135deg, #e8f5e9, #c8e6c9); border-radius: 12px; margin-bottom: 15px; }
    .status-bar .status-text { font-size: 15px; font-weight: 600; color: #2e7d32; }
    .pass-footer { text-align: center; padding: 20px; border-top: 1px solid #eee; }
    .pass-footer p { font-size: 12px; color: #999; }
    .course-badge { display: inline-block; background: linear-gradient(135deg, #003366, #00509e); color: #fff; padding: 8px 20px; border-radius: 25px; font-size: 14px; font-weight: 600; }
    @media (max-width: 500px) {
      .info-grid { grid-template-columns: 1fr; }
      .pass-header h2 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="pass-card">
    <div class="pass-header">
      <h1>Tushar Bhumkar Institute</h1>
      <h2>Entry Pass</h2>
      <div class="pass-id">ID: ${u.id}</div>
    </div>
    
    <div class="pass-body">
      <div class="user-name">${u.full_name}</div>
      <div style="text-align:center"><div class="course-badge">${u.course_type || 'Course'}</div></div>
      
      <div style="height: 20px;"></div>
      
      <div class="info-grid">
        <div class="info-box">
          <div class="label">📧 Email</div>
          <div class="value">${u.email || 'N/A'}</div>
        </div>
        <div class="info-box">
          <div class="label">📱 Phone</div>
          <div class="value">${u.phone || 'N/A'}</div>
        </div>
        <div class="info-box">
          <div class="label">📅 DOB</div>
          <div class="value">${u.dob || 'N/A'}</div>
        </div>
        <div class="info-box">
          <div class="label">📊 Market</div>
          <div class="value">${u.trading_market || 'N/A'}</div>
        </div>
        <div class="info-box">
          <div class="label">💲 Amount Paid</div>
          <div class="value" style="color: #2e7d32;">₹ ${u.amount || '0'}</div>
        </div>
        <div class="info-box">
          <div class="label">🕐 Created</div>
          <div class="value">${formatDate(u.created_at)}</div>
        </div>
      </div>
      
      <div class="divider"></div>
      
      <div class="pass-image">
        <img src="https://google-form-kebh.onrender.com/temp/${u.id}-final.png" alt="Entry Pass QR Code" onerror="this.style.display='none'"/>
      </div>
      
      <div class="status-bar">
        <div class="status-text">✅ Valid Entry Pass — Show at Gate</div>
      </div>
    </div>
    
    <div class="pass-footer">
      <p>Scan QR or Barcode at the entry gate</p>
      <p style="margin-top: 8px;">www.tusharbhumkar.com</p>
    </div>
  </div>
</body>
</html>`); 
  } catch(e) { 
    console.error("Pass View Error:", e);
    res.send("Error loading pass"); 
  }
});

// ==================================================================================
// 🔒 ADMIN SCANNER VIEW (Login required)
// ==================================================================================
function checkAdmin(req, res) { 
  if(req.session.isAdmin) return true; 
  if(req.query.p===process.env.ADMIN_PASS){req.session.isAdmin=true;return true;} 
  res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form method="GET" style="text-align:center;"><h2>🔒 Admin Access</h2><input type="password" name="p" placeholder="Enter Password" required style="padding:10px"/><br><br><button type="submit" style="padding:10px 20px">Access</button></form></body></html>`); 
  return false; 
}

app.get("/user/:id", async (req, res) => { 
  try { 
    if(!checkAdmin(req,res)) return; 
    const u=(await pool.query("SELECT * FROM users WHERE id=$1",[req.params.id])).rows[0]; 
    if(!u) return res.send("<h2>❌ Invalid QR</h2>"); 
    const gi=(url)=>url||"https://via.placeholder.com/150?text=No+Image"; 
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verified Student</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Poppins',sans-serif}body{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;padding:20px}.scanner-box{margin-bottom:20px;text-align:center;width:100%;max-width:500px}input#scanInput{padding:12px 20px;font-size:18px;width:100%;text-align:center;border:none;border-radius:10px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);outline:none}input#scanInput::placeholder{color:rgba(255,255,255,0.7)}.card{width:100%;max-width:1000px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 15px 40px rgba(0,0,0,0.4)}.card-header{background:linear-gradient(135deg,#00c853,#009624);color:#fff;text-align:center;padding:25px}.card-header h2{font-size:24px;font-weight:600;margin-bottom:10px}.badge{background:#fff;color:#00c853;display:inline-block;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600}.card-body{padding:25px}.info-container{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.info-item{display:flex;flex-direction:column}.info-label{color:#555;font-weight:500;font-size:14px;margin-bottom:5px}.info-value{font-weight:600;color:#222;font-size:14px;padding:8px 12px;background:rgba(0,200,83,0.05);border-radius:6px;min-height:40px;word-wrap:break-word}.images-grid{display:flex;flex-wrap:wrap;gap:15px;justify-content:center;margin-top:20px}.image-card{text-align:center;width:120px}.image-card div{font-size:12px;margin-bottom:5px;color:#555;font-weight:600}.image-card a{text-decoration:none;display:block}.image-card img{width:120px;height:120px;object-fit:cover;border-radius:10px;border:1px solid #ddd;background:#f5f5f5}.card-footer{text-align:center;padding:20px;font-size:14px;color:#777;border-top:1px solid #eee}.status{text-align:center;margin-top:20px;font-size:16px;color:#00c853;font-weight:600;padding:12px;border-radius:8px;background:rgba(0,200,83,0.1)}.error-msg{color:#ff4444;font-size:16px;font-weight:600;display:none;margin-top:20px;padding:12px;border-radius:8px;background:rgba(255,68,68,0.1)}.form-status-box{margin-top:20px;padding:16px;border-radius:10px;text-align:center;font-size:14px}.form-filled{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.form-pending{background:#fffbeb;border:1px solid #fde68a;color:#92400e}@media(max-width:767px){.info-container{grid-template-columns:1fr}}</style></head><body><div class="scanner-box"><input type="text" id="scanInput" placeholder="Scan Barcode..." autocomplete="off" spellcheck="false"/></div><div class="card"><div class="card-header"><h2>TUSHAR BHUMKAR INSTITUTE</h2><h2>Student Entry Pass</h2><div class="badge">✔ VERIFIED</div></div><div class="card-body"><div class="info-container"><div class="info-item"><div class="info-label">Name</div><div class="info-value" id="u-full_name">${u.full_name}</div></div><div class="info-item"><div class="info-label">Email</div><div class="info-value" id="u-email">${u.email}</div></div><div class="info-item"><div class="info-label">Phone</div><div class="info-value" id="u-phone">${u.phone}</div></div><div class="info-item"><div class="info-label">DOB</div><div class="info-value" id="u-dob">${u.dob}</div></div><div class="info-item"><div class="info-label">Market</div><div class="info-value" id="u-market">${u.trading_market}</div></div><div class="info-item"><div class="info-label">Type</div><div class="info-value" id="u-type">${u.trading_type}</div></div><div class="info-item"><div class="info-label">Software</div><div class="info-value" id="u-software">${u.software_used}</div></div><div class="info-item"><div class="info-label">Paid</div><div class="info-value" id="u-amount">₹ ${u.amount}</div></div><div class="info-item"><div class="info-label">Mode</div><div class="info-value" id="u-mode">${u.payment_mode}</div></div><div class="info-item"><div class="info-label">Course Type</div><div class="info-value" id="u-course">${u.course_type}</div></div><div class="info-item"><div class="info-label">Created At</div><div class="info-value" id="u-created_at">${u.created_at ? new Date(u.created_at).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'N/A'}</div></div></div><div style="margin-top:25px;"><h3 style="margin-bottom:10px;text-align:center;">Verification Documents</h3><div class="images-grid"><div class="image-card"><div>Selfie</div><a href="${gi(u.selfie_image)}" target="_blank"><img id="u-selfie" src="${gi(u.selfie_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Selfie'"/></a></div><div class="image-card"><div>Payment Proof</div><a href="${gi(u.payment_image)}" target="_blank"><img id="u-payment" src="${gi(u.payment_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Payment'"/></a></div><div class="image-card"><div>Aadhar Front</div><a href="${gi(u.aadhar_front_image)}" target="_blank"><img id="u-aadhar_front" src="${gi(u.aadhar_front_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div><div class="image-card"><div>Aadhar Back</div><a href="${gi(u.aadhar_back_image)}" target="_blank"><img id="u-aadhar_back" src="${gi(u.aadhar_back_image)}" onerror="this.src='https://via.placeholder.com/150?text=No+Aadhar'"/></a></div></div></div><div id="formStatusBox" class="form-status-box form-pending">🔄 Checking KYC Form status...</div><div class="status">✔ Valid Entry Approved</div><div id="error-display" class="error-msg">❌ Invalid ID</div></div><div class="card-footer">Scan QR / Barcode at Entry Gate</div></div><script>const input=document.getElementById('scanInput');setInterval(()=>{if(document.activeElement!==input)input.focus();},100);async function checkFormStatus(userId){try{const res=await fetch('/api/form-responses/'+userId);const json=await res.json();const box=document.getElementById('formStatusBox');if(json.success&&json.data){box.className='form-status-box form-filled';box.innerHTML='✅ KYC Form Filled — '+json.data.received_at_formatted;}else{box.className='form-status-box form-pending';box.innerHTML='⏳ KYC Form Not Yet Filled';}}catch(e){document.getElementById('formStatusBox').innerHTML='ℹ️ Status unavailable';}}checkFormStatus('${u.id}');input.addEventListener('keydown',async function(e){if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();const id=input.value.trim();input.value='';if(id){window.history.pushState({},"","/user/"+id);await loadUserData(id);}}});async function loadUserData(id){try{const res=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({barcode_id:id})});const json=await res.json();if(json.success){const u=json.data;document.getElementById('error-display').style.display='none';document.getElementById('u-full_name').innerText=u.full_name;document.getElementById('u-email').innerText=u.email;document.getElementById('u-phone').innerText=u.phone;document.getElementById('u-dob').innerText=u.dob;document.getElementById('u-market').innerText=u.trading_market;document.getElementById('u-type').innerText=u.trading_type;document.getElementById('u-software').innerText=u.software_used;document.getElementById('u-amount').innerText='₹ '+u.amount;document.getElementById('u-mode').innerText=u.payment_mode;document.getElementById('u-course').innerText=u.course_type;document.getElementById('u-created_at').innerText=u.created_at?new Date(u.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'N/A';const up=(i,url,p)=>{let img=document.getElementById(i);if(url&&url.length>10){img.src=url;img.parentElement.href=url;}else{img.src=p;img.parentElement.href="#";}};up('u-selfie',u.selfie_image,"https://via.placeholder.com/150?text=No+Selfie");up('u-payment',u.payment_image,"https://via.placeholder.com/150?text=No+Payment");up('u-aadhar_front',u.aadhar_front_image,"https://via.placeholder.com/150?text=No+Aadhar");up('u-aadhar_back',u.aadhar_back_image,"https://via.placeholder.com/150?text=No+Aadhar");document.querySelector('.status').innerText="✅ Scan logged - Valid Entry Approved";checkFormStatus(id);}else{document.getElementById('error-display').style.display='block';document.querySelector('.status').innerText="❌ Invalid Barcode";}}catch(err){document.getElementById('error-display').style.display='block';}}</script></body></html>`); 
  } catch(e){res.send("Error loading user");}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

// ==================================================================================
// DB INIT (DATABASE 1 ONLY)
// ==================================================================================
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (
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
      amount NUMERIC, 
      payment_mode VARCHAR(50), 
      selfie_image TEXT, 
      payment_image TEXT, 
      aadhar_front_image TEXT, 
      aadhar_back_image TEXT, 
      course_type VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await client.query(`UPDATE users SET created_at = NOW() WHERE created_at IS NULL;`);

    await client.query(`CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY, 
      barcode_id VARCHAR(7) NOT NULL, 
      course_type VARCHAR(255) NOT NULL, 
      scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, 
      device_info TEXT
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS google_form_responses (
      id VARCHAR(7) PRIMARY KEY, 
      ref_id VARCHAR(50), 
      full_name VARCHAR(255), 
      email VARCHAR(255), 
      phone VARCHAR(20), 
      raw_data JSONB, 
      received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    console.log("✅ Node.js DB tables ready.");
  } catch (err) { console.error("DB Init Error:", err); } finally { client.release(); }
}
initializeDatabase().catch(console.error);
