import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Gmail connection failed:", error.message);
  } else {
    console.log("✅ Gmail connected and ready to send emails");
  }
});

export async function sendEmail(userId, userEmail, runningBill, limit) {
  console.log(`📧 Preparing email to: ${userEmail}`);

  const exceeded = (runningBill - limit).toFixed(2);

  const mailOptions = {
    from: `"EnergyGuard" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `⚠️ Bill Limit Exceeded — EnergyGuard`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; padding: 40px;">
        <div style="max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 30px; text-align: center;">

          <!-- Brand -->
          <h1 style="color: #2c3e50; margin-bottom: 6px;">⚡ EnergyGuard</h1>
          <p style="color: #888; font-size: 14px; margin-bottom: 25px;">Electricity Usage Monitoring System</p>

          <!-- Title -->
          <h2 style="color: #333; margin-bottom: 12px;">⚠️ Bill Limit Exceeded</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
            Your electricity bill this month has crossed the limit you set.
            Please review your usage to keep your bill under control.
          </p>

          <!-- Running Bill Box -->
          <div style="display: inline-block; background: #2c3e50; color: #fff; font-size: 32px; font-weight: bold; padding: 14px 32px; border-radius: 10px; margin-bottom: 8px; letter-spacing: 1px;">
            ₹${runningBill}
          </div>
          <p style="color: #999; font-size: 13px; margin: 4px 0 24px;">Current Running Bill</p>

          <!-- Limit + Exceeded Row -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
            <tr>
              <!-- Set Limit -->
              <td style="width: 48%; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; text-align: center;">
                <p style="margin: 0 0 6px; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 1px;">🎯 Set Limit</p>
                <p style="margin: 0; font-size: 22px; font-weight: 700; color: #2c3e50;">₹${limit}</p>
              </td>

              <td style="width: 4%;"></td>

              <!-- Exceeded By -->
              <td style="width: 48%; background: #fff5f5; border: 1px solid #fecaca; border-radius: 10px; padding: 16px; text-align: center;">
                <p style="margin: 0 0 6px; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 1px;">📈 Exceeded By</p>
                <p style="margin: 0; font-size: 22px; font-weight: 700; color: #dc2626;">₹${exceeded}</p>
              </td>
            </tr>
          </table>

          <!-- Tips -->
          <div style="background: #f9fafb; border-radius: 10px; padding: 18px 20px; text-align: left; margin-bottom: 28px;">
            <p style="margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #444;">💡 Tips to reduce your usage</p>
            <p style="margin: 5px 0; font-size: 13px; color: #555;">🔆 Turn off lights and fans when not in use</p>
            <p style="margin: 5px 0; font-size: 13px; color: #555;">❄️ Set AC temperature to 24°C or higher</p>
            <p style="margin: 5px 0; font-size: 13px; color: #555;">🔌 Unplug devices that are on standby</p>
            <p style="margin: 5px 0; font-size: 13px; color: #555;">☀️ Use natural light during daytime hours</p>
          </div>

          <!-- Footer -->
          <hr style="border: none; height: 1px; background: #eee; margin: 20px 0;">
          <p style="color: #888; font-size: 13px;">
            If you did not set a limit, you can safely ignore this email.<br>
            &copy; ${new Date().getFullYear()} <b>EnergyGuard</b>. All rights reserved.
          </p>

        </div>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email SENT successfully to ${userEmail}`);
    console.log(`📨 Message ID: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ Email FAILED to ${userEmail}`);
    console.error(`   Reason: ${error.message}`);
  }
}
