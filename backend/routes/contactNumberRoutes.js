import { Router } from "express";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import {
  createContactNumber,
  deleteContactNumber,
  getContactNumbers,
  updateContactNumber,
  updateContactNumberStatus,
  updatePrimaryContactNumber
} from "../controllers/contactNumberController.js";

const router = Router();
router.use(requireAdmin, requirePermission("contacts:manage"));
router.get("/", getContactNumbers);
router.post("/", createContactNumber);
router.put("/:id", updateContactNumber);
router.patch("/:id/status", updateContactNumberStatus);
router.patch("/:id/primary", updatePrimaryContactNumber);
router.delete("/:id", deleteContactNumber);

export default router;
