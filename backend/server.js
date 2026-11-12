import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "./config/database.js";
import { phoneNumberSchema } from "./utils/phone.js";
import { requireAdmin, requirePermission } from "./middleware/auth.js";
import { isEmailConfigured, sendAdminPasswordResetCode } from "./services/email.js";
import { recordAdminAudit } from "./models/admin.js";
import { getPublicContactNumbers } from "./controllers/contactNumberController.js";
import adminRoutes from "./routes/adminRoutes.js";
import contactNumberRoutes from "./routes/contactNumberRoutes.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === "replace-with-a-long-random-secret")
  throw new Error("Set a unique JWT_SECRET of at least 32 characters in .env");
const app = express();
app.use(helmet());
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",").map(origin => origin.trim()).filter(Boolean);
app.use(cors({origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error("Origin is not allowed by CORS"));
}}));
app.use(express.json({limit:"100kb"}));
app.use("/api", rateLimit({windowMs:15*60*1000, limit:300}));
app.use("/api/admins",adminRoutes);
const recoveryRequestLimit = rateLimit({
 windowMs:15*60*1000, limit:5, standardHeaders:true, legacyHeaders:false,
 message:{message:"Too many password recovery requests. Please try again later."}
});
const adminLoginLimit = rateLimit({
 windowMs:15*60*1000, limit:10, standardHeaders:true, legacyHeaders:false,
 message:{message:"Too many admin login attempts. Please try again later."}
});
const recoveryVerifyLimit = rateLimit({
 windowMs:15*60*1000, limit:10, standardHeaders:true, legacyHeaders:false,
 message:{message:"Too many verification attempts. Please try again later."}
});

const bookedSlotMessage="Sorry, this time slot is already booked. Please select another slot.";
const unavailableSlotMessage="This time slot is unavailable. Please select another slot.";
function isValidDateString(value){
 if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const [year,month,day]=value.split("-").map(Number);
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day;
}
function isValidTimeString(value){
 if(typeof value!=="string" || !/^\d{2}:\d{2}$/.test(value)) return false;
 const [hour,minute]=value.split(":").map(Number);
 return hour<24 && minute<60;
}
function localToday(){return db.prepare("SELECT date('now','localtime') AS date").get().date;}

const bookingSchema = z.object({
 petName:z.string().trim().min(1).max(80), petType:z.enum(["Dog","Cat"]),
 breed:z.string().max(80).optional().default(""), age:z.string().max(30).optional().default(""),
 size:z.string().max(30).optional().default(""), serviceIds:z.array(z.number().int().positive()).min(1),
 date:z.string().refine(isValidDateString), time:z.string().refine(isValidTimeString),
 fullName:z.string().trim().min(2).max(100), phone:phoneNumberSchema,
 email:z.string().email().optional().or(z.literal("")), notes:z.string().max(1000).optional().default(""),
 paymentMethod:z.enum(["pay_at_shop","mock_online"])
});

app.get("/api/health",(req,res)=>{
 db.prepare("SELECT 1").get();
 res.json({ok:true,service:"A1 Paws API",database:"connected"});
});
app.get("/api/services",(req,res)=>res.json(db.prepare("SELECT id,name,description,price,duration FROM services WHERE active=1 ORDER BY id").all()));
app.get("/api/contacts",getPublicContactNumbers);

function minutes(t){const [h,m]=t.split(":").map(Number);return h*60+m;}
function timeString(m){return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;}
function getSlots(date,duration,excludeBookingId=null){
 const weekday=new Date(`${date}T12:00:00`).getDay();
 const holiday=db.prepare("SELECT date FROM holidays WHERE date=?").get(date);
 const hours=db.prepare("SELECT * FROM business_hours WHERE weekday=?").get(weekday);
 const open=minutes(hours?.open_time||"10:00"), close=minutes(hours?.close_time||"18:00");
 const step=30, now=db.prepare("SELECT date('now','localtime') AS date,time('now','localtime') AS time").get();
 const query=excludeBookingId===null
   ?"SELECT start_time,end_time FROM bookings WHERE appointment_date=? AND status!='cancelled'"
   :"SELECT start_time,end_time FROM bookings WHERE appointment_date=? AND status!='cancelled' AND id!=?";
 const existing=excludeBookingId===null
   ?db.prepare(query).all(date)
   :db.prepare(query).all(date,excludeBookingId);
 const slots=[];
 const closed=!hours || !hours.is_open || Boolean(holiday);
 for(let start=open; start<close; start+=step){
   const end=start+duration;
   const time=timeString(start);
   const conflict=existing.some(b=>start<minutes(b.end_time) && end>minutes(b.start_time));
   const past=date<now.date || (date===now.date && time<=now.time);
   const status=closed || past || end>close
     ?"unavailable"
     :conflict?"booked":"available";
   slots.push({time,status,available:status==="available"});
 }
 return slots;
}
app.get("/api/availability",(req,res)=>{
 const {date,duration}=req.query;
 if(!isValidDateString(date) || !Number.isInteger(Number(duration)) || Number(duration)<1)
   return res.status(400).json({message:"Valid date and duration are required"});
 const weekday=new Date(`${date}T12:00:00`).getDay();
 const hours=db.prepare("SELECT is_open FROM business_hours WHERE weekday=?").get(weekday);
 const holiday=db.prepare("SELECT label FROM holidays WHERE date=?").get(date);
 res.json({slots:getSlots(date,Number(duration)),isClosed:!hours || !hours.is_open || Boolean(holiday),holiday:holiday?.label||null});
});

app.post("/api/bookings",(req,res)=>{
 const parsed=bookingSchema.safeParse(req.body);
 if(!parsed.success) {
   const phoneError=parsed.error.issues.find(issue=>issue.path[0]==="phone");
   return res.status(400).json({
     message:phoneError?.message||"Please check the booking details",
     errors:parsed.error.flatten()
   });
 }
 const v=parsed.data;
 if(v.date < localToday()) return res.status(400).json({message:"Past dates cannot be booked"});
 const ids=[...new Set(v.serviceIds)];
 if(ids.length!==v.serviceIds.length) return res.status(400).json({message:"Duplicate services are not allowed"});
 const selected= db.prepare(`SELECT id,name,price,duration FROM services WHERE active=1 AND id IN (${ids.map(()=>"?").join(",")})`).all(...ids);
 if(selected.length!==ids.length) return res.status(400).json({message:"One or more services are unavailable"});
 const totalPrice=selected.reduce((s,x)=>s+x.price,0), totalDuration=selected.reduce((s,x)=>s+x.duration,0);
 const start=minutes(v.time), end=start+totalDuration, endTime=timeString(end);
 const reference="A1P-"+randomUUID().slice(0,8).toUpperCase();
 const paymentStatus=v.paymentMethod==="mock_online"?"mock_paid":"pending";
 const create=db.transaction(()=>{
   const slot=getSlots(v.date,totalDuration).find(s=>s.time===v.time);
   if(!slot || !slot.available){
     const error=new Error(slot?.status==="booked"?bookedSlotMessage:unavailableSlotMessage);
     error.code="A1_SLOT_CONFLICT";
     throw error;
   }
   let customer=db.prepare("SELECT id FROM customers WHERE phone=?").get(v.phone);
   if(customer) db.prepare("UPDATE customers SET full_name=?,email=? WHERE id=?").run(v.fullName,v.email||null,customer.id);
   else {const r=db.prepare("INSERT INTO customers(full_name,phone,email) VALUES(?,?,?)").run(v.fullName,v.phone,v.email||null); customer={id:r.lastInsertRowid};}
   const p=db.prepare("INSERT INTO pets(customer_id,name,type,breed,age,size) VALUES(?,?,?,?,?,?)").run(customer.id,v.petName,v.petType,v.breed,v.age,v.size);
   const b=db.prepare(`INSERT INTO bookings(reference,customer_id,pet_id,appointment_date,start_time,end_time,total_price,total_duration,
     additional_charges,discount_amount,final_amount,payment_method,payment_status,notes)
     VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?)`).run(reference,customer.id,p.lastInsertRowid,v.date,v.time,endTime,totalPrice,totalDuration,totalPrice,v.paymentMethod,paymentStatus,v.notes);
   const ins=db.prepare("INSERT INTO booking_services(booking_id,service_id,service_name,price,duration) VALUES(?,?,?,?,?)");
   selected.forEach(s=>ins.run(b.lastInsertRowid,s.id,s.name,s.price,s.duration));
   db.prepare("INSERT INTO payments(booking_id,provider,amount,status) VALUES(?,?,?,?)")
     .run(b.lastInsertRowid,v.paymentMethod==="mock_online"?"mock":"shop",totalPrice,paymentStatus);
   return b.lastInsertRowid;
 });
 try {
   const id=create.immediate();
   res.status(201).json({id,reference,customerName:v.fullName,petName:v.petName,date:v.date,time:v.time,totalPrice,totalDuration,paymentMethod:v.paymentMethod,paymentStatus,status:"pending",services:selected});
 } catch(err) {
   if(err.code==="A1_SLOT_CONFLICT" || err.code==="SQLITE_CONSTRAINT_UNIQUE")
     return res.status(409).json({message:err.code==="A1_SLOT_CONFLICT"?err.message:bookedSlotMessage});
   throw err;
 }
});

app.get("/api/bookings/:reference",(req,res)=>{
 const b=db.prepare(`SELECT b.*,c.full_name,c.phone,c.email,p.name AS pet_name,p.type AS pet_type
 FROM bookings b JOIN customers c ON c.id=b.customer_id JOIN pets p ON p.id=b.pet_id WHERE b.reference=?`).get(req.params.reference);
 if(!b) return res.status(404).json({message:"Booking not found"});
 b.services=db.prepare("SELECT service_name,price,duration FROM booking_services WHERE booking_id=?").all(b.id);
 res.json(b);
});

app.post("/api/admin/login",adminLoginLimit,async(req,res)=>{
 const schema=z.object({email:z.string().trim().email(),password:z.string().min(1)});
 const p=schema.safeParse(req.body); if(!p.success) return res.status(400).json({message:"Enter a valid email and password"});
 const admin=db.prepare("SELECT * FROM admins WHERE email=? COLLATE NOCASE AND status='active'").get(p.data.email);
 if(!admin || !(await bcrypt.compare(p.data.password,admin.password_hash))) return res.status(401).json({message:"Incorrect email or password"});
 const token=jwt.sign({id:admin.id,email:admin.email,role:admin.role,version:admin.token_version},process.env.JWT_SECRET,{expiresIn:"8h"});
 recordAdminAudit(admin.id,"admin.login",admin.id,{role:admin.role});
 res.json({token,email:admin.email,fullName:admin.full_name,role:admin.role});
});

const genericRecoveryMessage = "If an administrator account matches that email, a verification code will be sent shortly.";
const recoveryEmailSchema = z.object({email:z.string().trim().email().max(254).transform(value=>value.toLowerCase())});
const otpHash = (otp,salt) => createHmac("sha256",process.env.JWT_SECRET).update(`${salt}:${otp}`).digest("hex");
const resetTokenHash = token => createHash("sha256").update(token).digest("hex");

app.post("/api/admin/forgot-password",recoveryRequestLimit,async(req,res)=>{
 const parsed=recoveryEmailSchema.safeParse(req.body);
 if(!parsed.success) return res.status(400).json({message:"Enter a valid email address"});
 if(!isEmailConfigured()) return res.status(503).json({message:"Password recovery email is temporarily unavailable. Contact the site administrator."});

 const admin=db.prepare("SELECT id,email FROM admins WHERE email=? COLLATE NOCASE AND status='active'").get(parsed.data.email);
 if(admin){
   const issueCode=db.transaction(()=>{
     const now=Date.now();
     const previous=db.prepare("SELECT last_sent_at FROM admin_password_resets WHERE admin_id=?").get(admin.id);
     if(previous && now-previous.last_sent_at<60_000) return null;
     const otp=String(randomInt(100000,1000000));
     const salt=randomBytes(16).toString("hex");
     const hash=otpHash(otp,salt);
     db.prepare(`INSERT INTO admin_password_resets(admin_id,otp_hash,otp_salt,expires_at,last_sent_at,attempts,reset_token_hash,reset_expires_at)
       VALUES(?,?,?,?,?,0,NULL,NULL)
       ON CONFLICT(admin_id) DO UPDATE SET otp_hash=excluded.otp_hash,otp_salt=excluded.otp_salt,
       expires_at=excluded.expires_at,last_sent_at=excluded.last_sent_at,attempts=0,reset_token_hash=NULL,reset_expires_at=NULL`)
       .run(admin.id,hash,salt,now+5*60_000,now);
     return {otp,hash};
   });
   const issued=issueCode();
   if(issued){
     void sendAdminPasswordResetCode(admin.email,issued.otp).catch(error=>{
       db.prepare(`UPDATE admin_password_resets SET otp_hash=NULL,otp_salt=NULL,expires_at=NULL,
         reset_token_hash=NULL,reset_expires_at=NULL WHERE admin_id=? AND otp_hash=?`).run(admin.id,issued.hash);
       console.error("Admin password recovery email delivery failed",error.code||"SMTP_ERROR");
     });
   }
 }
 res.status(202).json({message:genericRecoveryMessage});
});

app.post("/api/admin/verify-otp",recoveryVerifyLimit,(req,res)=>{
 const parsed=z.object({email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),otp:z.string().regex(/^\d{6}$/)}).safeParse(req.body);
 if(!parsed.success) return res.status(400).json({message:"Enter the registered email and 6-digit verification code"});
 const admin=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE AND status='active'").get(parsed.data.email);
 const challenge=admin&&db.prepare("SELECT * FROM admin_password_resets WHERE admin_id=?").get(admin.id);
 if(!challenge || !challenge.otp_hash || !challenge.otp_salt || challenge.attempts>=5 || challenge.expires_at<=Date.now())
   return res.status(400).json({message:"The verification code is invalid or expired. Request a new code."});

 const expected=Buffer.from(challenge.otp_hash,"hex");
 const actual=Buffer.from(otpHash(parsed.data.otp,challenge.otp_salt),"hex");
 if(expected.length!==actual.length || !timingSafeEqual(expected,actual)){
   db.prepare(`UPDATE admin_password_resets SET attempts=attempts+1,
     otp_hash=CASE WHEN attempts+1>=5 THEN NULL ELSE otp_hash END,
     otp_salt=CASE WHEN attempts+1>=5 THEN NULL ELSE otp_salt END
     WHERE admin_id=? AND attempts<5`).run(admin.id);
   return res.status(400).json({message:"The verification code is invalid or expired. Request a new code."});
 }

 const resetToken=randomBytes(32).toString("base64url");
 const consumed=db.prepare(`UPDATE admin_password_resets SET otp_hash=NULL,otp_salt=NULL,expires_at=NULL,
   reset_token_hash=?,reset_expires_at=? WHERE admin_id=? AND otp_hash=? AND otp_salt=? AND attempts<5 AND expires_at>?`)
   .run(resetTokenHash(resetToken),Date.now()+10*60_000,admin.id,challenge.otp_hash,challenge.otp_salt,Date.now());
 if(!consumed.changes) return res.status(400).json({message:"The verification code is invalid or expired. Request a new code."});
 res.json({resetToken});
});

app.post("/api/admin/reset-password",recoveryVerifyLimit,async(req,res)=>{
 const parsed=z.object({
   resetToken:z.string().min(40).max(100),
   password:z.string().min(12).max(128)
     .regex(/[a-z]/,"Password must contain a lowercase letter")
     .regex(/[A-Z]/,"Password must contain an uppercase letter")
     .regex(/\d/,"Password must contain a number")
     .regex(/[^A-Za-z0-9]/,"Password must contain a symbol")
 }).safeParse(req.body);
 if(!parsed.success) return res.status(400).json({message:parsed.error.issues[0]?.message||"Choose a stronger password"});

 const passwordHash=await bcrypt.hash(parsed.data.password,12);
 const tokenHash=resetTokenHash(parsed.data.resetToken);
 const reset=db.transaction(()=>{
   const row=db.prepare("SELECT admin_id FROM admin_password_resets WHERE reset_token_hash=? AND reset_expires_at>?").get(tokenHash,Date.now());
   if(!row) return false;
   const updated=db.prepare("UPDATE admins SET password_hash=?,token_version=token_version+1 WHERE id=? AND status='active'").run(passwordHash,row.admin_id);
   if(!updated.changes) return false;
   db.prepare("DELETE FROM admin_password_resets WHERE admin_id=?").run(row.admin_id);
   recordAdminAudit(row.admin_id,"admin.password_reset",row.admin_id,{method:"email_otp"});
   return true;
 });
 if(!reset()) return res.status(400).json({message:"This password reset link is invalid or expired. Start again."});
 res.json({message:"Password updated successfully. Please sign in with your new password."});
});

app.use("/api/admin/contact-numbers",contactNumberRoutes);
app.use("/api/admin",requireAdmin);
app.get("/api/admin/dashboard",requirePermission("dashboard:read"),(req,res)=>{
 const scalar=(query,...params)=>db.prepare(query).get(...params).n;
 const staffScope=req.admin.role==="staff";
 const countStatus=status=>staffScope
   ? scalar("SELECT COUNT(*) n FROM bookings WHERE assigned_admin_id=? AND status=?",req.admin.id,status)
   : scalar("SELECT COUNT(*) n FROM bookings WHERE status=?",status);
 const total=staffScope
   ? scalar("SELECT COUNT(*) n FROM bookings WHERE assigned_admin_id=?",req.admin.id)
   : scalar("SELECT COUNT(*) n FROM bookings");
 const today=staffScope
   ? scalar("SELECT COUNT(*) n FROM bookings WHERE assigned_admin_id=? AND appointment_date=date('now','localtime') AND status!='cancelled'",req.admin.id)
   : scalar("SELECT COUNT(*) n FROM bookings WHERE appointment_date=date('now','localtime') AND status!='cancelled'");
 const upcoming=staffScope
   ? scalar("SELECT COUNT(*) n FROM bookings WHERE assigned_admin_id=? AND appointment_date>=date('now','localtime') AND status IN ('pending','confirmed')",req.admin.id)
   : scalar("SELECT COUNT(*) n FROM bookings WHERE appointment_date>=date('now','localtime') AND status IN ('pending','confirmed')");
 const revenue=staffScope
   ? scalar(`SELECT COALESCE(SUM(final_amount),0) n FROM bookings b WHERE assigned_admin_id=? AND status='completed'
     AND COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status) IN ('paid','mock_paid')`,req.admin.id)
   : scalar(`SELECT COALESCE(SUM(final_amount),0) n FROM bookings b WHERE status='completed'
     AND COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status) IN ('paid','mock_paid')`);
 const pendingPayments=staffScope
   ? scalar(`SELECT COALESCE(SUM(final_amount),0) n FROM bookings b WHERE assigned_admin_id=? AND status!='cancelled'
     AND COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status)='pending'`,req.admin.id)
   : scalar(`SELECT COALESCE(SUM(final_amount),0) n FROM bookings b WHERE status!='cancelled'
     AND COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status)='pending'`);
 res.json({
 total,pending:countStatus("pending"),confirmed:countStatus("confirmed"),
 today,upcoming,completed:countStatus("completed"),cancelled:countStatus("cancelled"),revenue,pendingPayments,
 currentAdmin:{id:req.admin.id,fullName:req.admin.fullName,email:req.admin.email,role:req.admin.role}
 });
});
function includeBookingServices(rows){
 if(!rows.length) return rows;
 const ids=rows.map(row=>row.id);
 const services=db.prepare(`SELECT booking_id,service_name,price,duration FROM booking_services
   WHERE booking_id IN (${ids.map(()=>"?").join(",")}) ORDER BY booking_id,service_id`).all(...ids);
 const byBooking=new Map();
 services.forEach(service=>{
   if(!byBooking.has(service.booking_id)) byBooking.set(service.booking_id,[]);
   byBooking.get(service.booking_id).push({
     name:service.service_name,price:service.price,duration:service.duration
   });
 });
 return rows.map(row=>({...row,services:byBooking.get(row.id)||[]}));
}
app.get("/api/admin/bookings",requirePermission("bookings:read"),(req,res)=>{
 const staffScope=req.admin.role==="staff";
 const rows=db.prepare(`SELECT b.id,b.reference,b.appointment_date,b.start_time,b.end_time,b.total_price,
 b.additional_charges,b.discount_amount,b.final_amount,b.total_duration,b.payment_method,b.notes,b.created_at,b.status,
 COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status) AS payment_status,
 (SELECT pay.provider FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1) AS payment_provider,
 (SELECT pay.amount FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1) AS payment_amount,
 b.assigned_admin_id,assigned.full_name AS assigned_name,c.full_name,c.phone,c.email,
 p.name AS pet_name,p.type AS pet_type,p.breed,p.age,p.size
 FROM bookings b JOIN customers c ON c.id=b.customer_id JOIN pets p ON p.id=b.pet_id
 LEFT JOIN admins assigned ON assigned.id=b.assigned_admin_id
 ${staffScope?"WHERE b.assigned_admin_id=?":""}
 ORDER BY b.appointment_date ASC,b.start_time ASC`).all(...(staffScope?[req.admin.id]:[]));
 res.json(includeBookingServices(rows));
});
app.get("/api/admin/customers",requirePermission("customers:read"),(req,res)=>{
 const staffScope=req.admin.role==="staff";
 const rows=db.prepare(`SELECT c.id,c.full_name,c.phone,c.email,
   ${staffScope
     ?"COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM bookings pet_assignment WHERE pet_assignment.pet_id=p.id AND pet_assignment.assigned_admin_id=?) THEN p.id END)"
     :"COUNT(DISTINCT p.id)"} AS pet_count,
   ${staffScope
     ?"COUNT(DISTINCT CASE WHEN b.assigned_admin_id=? THEN b.id END)"
     :"COUNT(DISTINCT b.id)"} AS booking_count
   FROM customers c LEFT JOIN pets p ON p.customer_id=c.id
   LEFT JOIN bookings b ON b.customer_id=c.id
   WHERE ${staffScope?"EXISTS(SELECT 1 FROM bookings assigned WHERE assigned.customer_id=c.id AND assigned.assigned_admin_id=?)":"1=1"}
   GROUP BY c.id ORDER BY c.full_name`).all(...(staffScope?[req.admin.id,req.admin.id,req.admin.id]:[]));
 res.json(rows);
});
app.get("/api/admin/pets",requirePermission("pets:read"),(req,res)=>{
 const staffScope=req.admin.role==="staff";
 const rows=db.prepare(`SELECT p.id,p.name,p.type,p.breed,p.age,p.size,
   c.full_name AS customer_name,c.phone FROM pets p
   JOIN customers c ON c.id=p.customer_id
   WHERE ${staffScope?"EXISTS(SELECT 1 FROM bookings assigned WHERE assigned.pet_id=p.id AND assigned.assigned_admin_id=?)":"1=1"}
   ORDER BY p.name`).all(...(staffScope?[req.admin.id]:[]));
 res.json(rows);
});
app.patch("/api/admin/customers/:id",requirePermission("customers:manage"),(req,res)=>{
 const parsed=z.object({
   fullName:z.string().trim().min(2).max(100),
   phone:phoneNumberSchema,
   email:z.string().trim().email().max(254).or(z.literal("")).transform(value=>value||null)
 }).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Invalid customer details"});
 const result=db.prepare("UPDATE customers SET full_name=?,phone=?,email=? WHERE id=?")
   .run(parsed.data.fullName,parsed.data.phone,parsed.data.email,id.data);
 if(!result.changes) return res.status(404).json({message:"Customer not found"});
 recordAdminAudit(req.admin.id,"customer.updated",null,{customerId:id.data});
 res.json({ok:true});
});
app.patch("/api/admin/pets/:id",requirePermission("pets:manage"),(req,res)=>{
 const parsed=z.object({
   name:z.string().trim().min(1).max(80),
   type:z.string().trim().min(1).max(40),
   breed:z.string().trim().max(80),
   age:z.string().trim().max(30),
   size:z.string().trim().max(30)
 }).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Invalid pet details"});
 const result=db.prepare("UPDATE pets SET name=?,type=?,breed=?,age=?,size=? WHERE id=?")
   .run(parsed.data.name,parsed.data.type,parsed.data.breed,parsed.data.age,parsed.data.size,id.data);
 if(!result.changes) return res.status(404).json({message:"Pet not found"});
 recordAdminAudit(req.admin.id,"pet.updated",null,{petId:id.data});
 res.json({ok:true});
});
app.patch("/api/admin/bookings/:id/status",requirePermission("bookings:update"),(req,res)=>{
 const p=z.object({status:z.enum(["pending","confirmed","completed","cancelled"])}).safeParse(req.body);
 if(!p.success) return res.status(400).json({message:"Invalid status"});
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success) return res.status(400).json({message:"Invalid booking ID"});
 const booking=db.prepare("SELECT id,reference,assigned_admin_id FROM bookings WHERE id=?").get(id.data);
 if(!booking) return res.status(404).json({message:"Booking not found"});
 if(req.admin.role==="staff" && booking.assigned_admin_id!==req.admin.id) return res.status(403).json({message:"You can only update appointments assigned to you"});
 const result=db.prepare("UPDATE bookings SET status=? WHERE id=?").run(p.data.status,id.data);
 if(!result.changes) return res.status(404).json({message:"Booking not found"});
 recordAdminAudit(req.admin.id,"booking.status_updated",null,{reference:booking.reference,status:p.data.status});
 res.json({ok:true});
});
app.patch("/api/admin/bookings/:id/reschedule",requirePermission("bookings:update"),(req,res)=>{
 const parsed=z.object({
   date:z.string().refine(isValidDateString),
   time:z.string().refine(isValidTimeString)
 }).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Enter a valid appointment date and time"});
 if(parsed.data.date<localToday()) return res.status(400).json({message:"Past dates cannot be booked"});
 const booking=db.prepare("SELECT id,reference,assigned_admin_id,total_duration,status,appointment_date,start_time FROM bookings WHERE id=?").get(id.data);
 if(!booking) return res.status(404).json({message:"Appointment not found"});
 if(req.admin.role==="staff" && booking.assigned_admin_id!==req.admin.id)
   return res.status(403).json({message:"You can only reschedule appointments assigned to you"});
 if(["cancelled","completed"].includes(booking.status))
   return res.status(400).json({message:"Cancelled or completed appointments cannot be rescheduled"});
 const reschedule=db.transaction(()=>{
   const slot=getSlots(parsed.data.date,booking.total_duration,booking.id).find(item=>item.time===parsed.data.time);
   if(!slot || !slot.available){
     const error=new Error(slot?.status==="booked"?bookedSlotMessage:unavailableSlotMessage);
     error.code="A1_SLOT_CONFLICT";
     throw error;
   }
   const endTime=timeString(minutes(parsed.data.time)+booking.total_duration);
   db.prepare("UPDATE bookings SET appointment_date=?,start_time=?,end_time=? WHERE id=?")
     .run(parsed.data.date,parsed.data.time,endTime,booking.id);
 });
 try {
   reschedule.immediate();
 } catch(error) {
   if(error.code==="A1_SLOT_CONFLICT")
     return res.status(409).json({message:error.message});
   throw error;
 }
 recordAdminAudit(req.admin.id,"booking.rescheduled",null,{
   reference:booking.reference,
   fromDate:booking.appointment_date,fromTime:booking.start_time,
   toDate:parsed.data.date,toTime:parsed.data.time
 });
 res.json({ok:true});
});
app.patch("/api/admin/bookings/:id/payment",requirePermission("payments:update"),(req,res)=>{
 const parsed=z.object({status:z.enum(["pending","paid","failed","refunded","mock_paid"])}).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Invalid payment status"});
 const booking=db.prepare("SELECT id,reference,assigned_admin_id,payment_method,final_amount FROM bookings WHERE id=?").get(id.data);
 if(!booking) return res.status(404).json({message:"Appointment not found"});
 if(req.admin.role==="staff")
   return res.status(403).json({message:"You do not have permission to update payment status"});
 const update=db.transaction(()=>{
   db.prepare("UPDATE bookings SET payment_status=? WHERE id=?").run(parsed.data.status,booking.id);
   const payment=db.prepare("SELECT id FROM payments WHERE booking_id=? ORDER BY id DESC LIMIT 1").get(booking.id);
   if(payment) db.prepare("UPDATE payments SET status=? WHERE id=?").run(parsed.data.status,payment.id);
   else db.prepare("INSERT INTO payments(booking_id,provider,amount,status) VALUES(?,?,?,?)")
     .run(booking.id,booking.payment_method==="mock_online"?"mock":"shop",booking.final_amount,parsed.data.status);
 });
 update.immediate();
 recordAdminAudit(req.admin.id,"booking.payment_status_updated",null,{
   reference:booking.reference,paymentStatus:parsed.data.status
 });
 res.json({ok:true,paymentStatus:parsed.data.status});
});
app.patch("/api/admin/bookings/:id/amounts",requirePermission("bookings:update"),(req,res)=>{
 const parsed=z.object({
   additionalCharges:z.number().int().min(0).max(1000000000),
   discountAmount:z.number().int().min(0).max(1000000000)
 }).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Enter valid charge and discount amounts"});
 if(req.admin.role==="staff") return res.status(403).json({message:"You do not have permission to change appointment amounts"});
 const booking=db.prepare("SELECT id,reference,total_price FROM bookings WHERE id=?").get(id.data);
 if(!booking) return res.status(404).json({message:"Appointment not found"});
 const finalAmount=booking.total_price+parsed.data.additionalCharges-parsed.data.discountAmount;
 if(finalAmount<0) return res.status(400).json({message:"Discount cannot exceed the service total plus additional charges"});
 const update=db.transaction(()=>{
   db.prepare(`UPDATE bookings SET additional_charges=?,discount_amount=?,final_amount=? WHERE id=?`)
     .run(parsed.data.additionalCharges,parsed.data.discountAmount,finalAmount,booking.id);
   const payment=db.prepare("SELECT id,status FROM payments WHERE booking_id=? ORDER BY id DESC LIMIT 1").get(booking.id);
   if(payment?.status==="pending") db.prepare("UPDATE payments SET amount=? WHERE id=?").run(finalAmount,payment.id);
 });
 update.immediate();
 recordAdminAudit(req.admin.id,"booking.amounts_updated",null,{
   reference:booking.reference,additionalCharges:parsed.data.additionalCharges,
   discountAmount:parsed.data.discountAmount,finalAmount
 });
 res.json({ok:true,finalAmount});
});
app.get("/api/admin/assignees",requirePermission("bookings:assign"),(req,res)=>{
 res.json(db.prepare("SELECT id,full_name AS fullName,email FROM admins WHERE role='staff' AND status='active' ORDER BY full_name").all());
});
app.patch("/api/admin/bookings/:id/assignee",requirePermission("bookings:assign"),(req,res)=>{
 const parsed=z.object({adminId:z.number().int().positive().nullable()}).safeParse(req.body);
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 if(!id.success || !parsed.success) return res.status(400).json({message:"Invalid booking assignment"});
 const booking=db.prepare("SELECT id,reference FROM bookings WHERE id=?").get(id.data);
 if(!booking) return res.status(404).json({message:"Booking not found"});
 let assignee=null;
 if(parsed.data.adminId!==null) {
   assignee=db.prepare("SELECT id,full_name FROM admins WHERE id=? AND role='staff' AND status='active'").get(parsed.data.adminId);
   if(!assignee) return res.status(400).json({message:"Select an active staff account"});
 }
 db.prepare("UPDATE bookings SET assigned_admin_id=? WHERE id=?").run(parsed.data.adminId,id.data);
 recordAdminAudit(req.admin.id,"booking.assigned",null,{reference:booking.reference,assignedAdmin:assignee?.full_name||null});
 res.json({ok:true,assignedAdminId:parsed.data.adminId});
});
app.get("/api/admin/services",requirePermission("services:read"),(req,res)=>res.json(db.prepare("SELECT * FROM services ORDER BY id").all()));
app.post("/api/admin/services",requirePermission("services:manage"),(req,res)=>{
 const p=z.object({name:z.string().trim().min(2),description:z.string().max(300).default(""),price:z.number().int().min(0),duration:z.number().int().min(5),active:z.boolean().default(true)}).safeParse(req.body);
 if(!p.success) return res.status(400).json({message:"Invalid service details"});
 const r=db.prepare("INSERT INTO services(name,description,price,duration,active) VALUES(?,?,?,?,?)").run(p.data.name,p.data.description,p.data.price,p.data.duration,p.data.active?1:0);
 recordAdminAudit(req.admin.id,"service.created",null,{serviceId:r.lastInsertRowid,name:p.data.name});
 res.status(201).json({id:r.lastInsertRowid});
});
app.patch("/api/admin/services/:id",requirePermission("services:manage"),(req,res)=>{
 const p=z.object({name:z.string().trim().min(2),description:z.string().max(300),price:z.number().int().min(0),duration:z.number().int().min(5),active:z.boolean()}).safeParse(req.body);
 if(!p.success) return res.status(400).json({message:"Invalid service details"});
 const r=db.prepare("UPDATE services SET name=?,description=?,price=?,duration=?,active=? WHERE id=?").run(p.data.name,p.data.description,p.data.price,p.data.duration,p.data.active?1:0,req.params.id);
 if(!r.changes) return res.status(404).json({message:"Service not found"});
 recordAdminAudit(req.admin.id,"service.updated",null,{serviceId:Number(req.params.id),name:p.data.name});
 res.json({ok:true});
});
function addDays(date,days){
 const [year,month,day]=date.split("-").map(Number);
 return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
}
function csvCell(value){
 const text=String(value??"");
 const safe=/^[\t\r=+\-@]/.test(text.trimStart())?`'${text}`:text;
 return `"${safe.replaceAll('"','""')}"`;
}
app.get("/api/admin/bookings.csv",requirePermission("bookings:export"),(req,res)=>{
 const parsed=z.object({
   scope:z.enum(["all","today","week","month","range"]).default("all"),
   from:z.string().optional(),to:z.string().optional()
 }).safeParse(req.query);
 if(!parsed.success) return res.status(400).json({message:"Invalid export filter"});
 const {scope}=parsed.data;
 const today=localToday();
 let from=null,to=null;
 if(scope==="today") from=to=today;
 if(scope==="week"){
   const weekday=new Date(`${today}T12:00:00Z`).getUTCDay();
   from=addDays(today,-((weekday+6)%7));
   to=addDays(from,6);
 }
 if(scope==="month"){
   from=`${today.slice(0,7)}-01`;
   const [year,month]=today.split("-").map(Number);
   to=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 }
 if(scope==="range"){
   if(!isValidDateString(parsed.data.from) || !isValidDateString(parsed.data.to) || parsed.data.from>parsed.data.to)
     return res.status(400).json({message:"Select a valid start and end date"});
   from=parsed.data.from;
   to=parsed.data.to;
 }
 const conditions=[],params=[];
 if(from){conditions.push("b.appointment_date>=?");params.push(from);}
 if(to){conditions.push("b.appointment_date<=?");params.push(to);}
 const rows=db.prepare(`SELECT b.id,b.reference,b.appointment_date,b.start_time,b.status,b.total_price,
   b.additional_charges,b.discount_amount,b.final_amount,b.payment_method,b.created_at,b.notes,
   COALESCE((SELECT pay.status FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1),b.payment_status) AS payment_status,
   (SELECT pay.provider FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1) AS payment_provider,
   (SELECT pay.amount FROM payments pay WHERE pay.booking_id=b.id ORDER BY pay.id DESC LIMIT 1) AS payment_amount,
   c.full_name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,
   p.name AS pet_name,p.type AS pet_type,p.breed AS pet_breed,p.age AS pet_age,p.size AS pet_size
   FROM bookings b JOIN customers c ON c.id=b.customer_id JOIN pets p ON p.id=b.pet_id
   ${conditions.length?`WHERE ${conditions.join(" AND ")}`:""}
   ORDER BY b.appointment_date,b.start_time`).all(...params);
 const bookings=includeBookingServices(rows);
 const columns=[
   "Appointment ID","Booking Reference","Customer Name","Customer Phone","Customer Email",
   "Pet Name","Pet Type","Pet Breed","Pet Age","Pet Size","Selected Services",
   "Individual Service Costs (INR)","Appointment Date","Appointment Time",
   "Booking Created Date","Booking Created Time","Service Total (INR)",
   "Additional Charges (INR)","Discount Amount (INR)","Final Amount (INR)",
   "Payment Method","Payment Provider","Payment Amount (INR)","Payment Status",
   "Appointment Status","Notes"
 ];
 const records=bookings.map(booking=>{
   const createdAt=booking.created_at||"";
   const services=booking.services.map(service=>service.name).join("; ");
   const serviceCosts=booking.services.map(service=>`${service.name}: ${service.price} INR (${service.duration} min)`).join("; ");
   return [
     booking.id,booking.reference,booking.customer_name,booking.customer_phone,booking.customer_email,
     booking.pet_name,booking.pet_type,booking.pet_breed,booking.pet_age,booking.pet_size,services,
     serviceCosts,booking.appointment_date,booking.start_time,createdAt.slice(0,10),createdAt.slice(11,19),
     booking.total_price,booking.additional_charges,booking.discount_amount,booking.final_amount,
     booking.payment_method,booking.payment_provider,booking.payment_amount,booking.payment_status,
     booking.status,booking.notes
   ];
 });
 const csv="\uFEFF"+[columns,...records].map(row=>row.map(csvCell).join(",")).join("\r\n");
 res.setHeader("Content-Type","text/csv; charset=utf-8");
 res.setHeader("Content-Disposition",`attachment; filename="A1_Paws_Appointments_${today}.csv"`);
 res.send(csv);
});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({message:"Internal server error"});});
const port=process.env.PORT||5000;
app.listen(port,()=>console.log(`A1 Paws API running at http://localhost:${port}`));
