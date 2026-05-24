import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default function handler(req, res) {
  res.status(200).json({
    cwd: process.cwd(),
    hasDeviceId: Boolean(process.env.DEVICE_ID),
    hasAccount: Boolean(process.env.SOT_ACCOUNT),
    hasPasswordHash: Boolean(process.env.SOT_PASSWORD_HASH),
    deviceIdPreview: process.env.DEVICE_ID
      ? process.env.DEVICE_ID.slice(0, 5) + "..."
      : null,
    accountPreview: process.env.SOT_ACCOUNT || null
  });
}