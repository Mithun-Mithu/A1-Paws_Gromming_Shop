import { Router } from "express";
import { requireAdmin, requireRole } from "../middleware/auth.js";
import {
  createAdmin,
  deleteAdmin,
  getAdmin,
  getAdminAudit,
  getAdmins,
  updateAdmin,
  updateAdminStatus
} from "../controllers/adminController.js";

const router=Router();
router.use(requireAdmin,requireRole("super_admin"));
router.get("/audit",getAdminAudit);
router.get("/",getAdmins);
router.post("/",createAdmin);
router.get("/:id",getAdmin);
router.put("/:id",updateAdmin);
router.patch("/:id/status",updateAdminStatus);
router.delete("/:id",deleteAdmin);

export default router;
